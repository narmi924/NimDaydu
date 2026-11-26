import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { browser } from 'wxt/browser';
import { applyTranslation, draftKey, isActive, mergeCaption, mergePreview, readSettings, DEFAULT_SETTINGS, timestamp,
  type Caption, type CaptureState, type DraftTranslations, type EnglishPreview, type Settings, type Source } from '../../lib/types';
import type { TranslationStatus } from '../../lib/translation';
import { connectLocal, type Connection } from '../../lib/connection';
import { IS_MAC, SETUP_SCRIPT } from '../../lib/platform';
import { readableCaptions, groupParagraphs, previewUnits } from '../../lib/reader';
import { LiveRows, ParagraphRow } from '../../lib/CaptionReader';
import { exportCaptions, subtitleText } from '../../lib/export';
import { exportDiagnostics } from '../../lib/export-diagnostics';
import Icon from '../../lib/Icon';

import { useUiLanguage } from '../../lib/useUiLanguage';
import { messagesFor } from '../../lib/ui-messages';
import { localizeNotice } from '../../lib/ui-notices';

const phaseLabels = { idle: 'idle', starting: 'starting', capturing: 'listening', paused: 'paused', stopping: 'stopping', stopped: 'stopped', error: 'captureError' } as const;
const sourceLabels = { '网页': 'webPage', '测试网页': 'sampleSource', '哔哩哔哩': 'bilibili', 'Desktop': 'desktopAudio' } as const;

export default function App() {
  const language = useUiLanguage('liveCaptions');
  const t = messagesFor(language);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<Source>();
  const [state, setState] = useState<CaptureState>({ phase: 'idle' });
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [preview, setPreview] = useState<EnglishPreview>();
  const [drafts, setDrafts] = useState<DraftTranslations>({});
  const [connection, setConnection] = useState<Connection>();
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [translationFailed, setTranslationFailed] = useState(false);
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus>({ pending: 0, failed: 0, retrying: 0, running: false });
  const [repairing, setRepairing] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState(0);
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState(true);
  const [editId, setEditId] = useState('');
  const [alias, setAlias] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState('line');
  const [editing, setEditing] = useState(false);
  const editCaption = captions.find(c => c.id === editId);
  async function commitTerm(undo = false) {
    if (!editCaption) return;
    setEditing(true);
    try {
      const result = await sendOffscreen({ type: 'editTerm', sessionId: editCaption.sessionId,
        edit: { id: editCaption.id, alias, replacement, scope: undo ? 'undo' : scope } });
      if (!result?.ok) throw new Error(result?.error || '纠词失败。');
      setEditId('');
    } catch (error) { setNotice(error instanceof Error ? error.message : '纠词失败。'); }
    finally { setEditing(false); }
  }
  const [pageEnd, setPageEnd] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  const settingsRef = useRef(settings);
  const stateRef = useRef(state);
  const connectionRef = useRef(connection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  settingsRef.current = settings; stateRef.current = state;
  connectionRef.current = connection;

  const sendOffscreen = useCallback((message: Record<string, unknown>) => browser.runtime.sendMessage({ target: 'offscreen', ...message }), []);
  const showServiceStatus = useCallback((status?: TranslationStatus) => {
    if (!status) return;
    setTranslationStatus(status); setTranslationFailed(status.failed > 0);
  }, []);

  const connect = useCallback(async () => {
    try {
      const next = await connectLocal();
      const saved = readSettings((await browser.storage.local.get('settings')).settings as Partial<Settings> | undefined);
      settingsRef.current = saved; connectionRef.current = next;
      setSettings(saved); setConnection(next); setConnectionError('');
      return next;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '本机连接失败。');
      return undefined;
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    const listener = (message: any) => {
      if (message?.target !== 'ui') return;
      if (message.type === 'source') setSource(message.source);
      else if (message.type === 'capabilities' && connectionRef.current) {
        const updated = { ...connectionRef.current, ...message.capabilities };
        connectionRef.current = updated; setConnection(updated);
      }
      else if (message.type === 'state') {
        const next: CaptureState = message.state;
        if (next.phase === 'starting') {
          setCaptions([]); setPreview(undefined); setDrafts({}); setFollowing(true);
          setTranslationFailed(false);
        }
        stateRef.current = next; setState(next);
      } else if (message.type === 'caption' && message.caption.final) {
        if (message.caption.sessionId !== stateRef.current.sessionId) return;
        setCaptions(previous => mergeCaption(previous, message.caption));
        if (message.preview) setPreview(previous => mergePreview(previous, message.preview, stateRef.current.sessionId));
      } else if (message.type === 'preview' && message.preview) {
        setPreview(previous => mergePreview(previous, message.preview, stateRef.current.sessionId));
      } else if (message.type === 'translation') {
        setCaptions(previous => applyTranslation(previous, message));
        setNotice(previous => previous === '英文已可使用，中文模型正在加载。' ? '' : previous);
      }
      else if (message.type === 'translationStatus') showServiceStatus(message.status);
      else if (message.type === 'draft' && message.sessionId === stateRef.current.sessionId) setDrafts(previous => ({ ...previous, [message.key]: message.text }));
      else if (message.type === 'cleared') { setCaptions([]); setPreview(undefined); setDrafts({}); }
    };
    const storageListener = (changes: any, area: string) => {
      if (area !== 'local' || !changes.settings?.newValue) return;
      const next = readSettings(changes.settings.newValue);
      if (next.translationMode !== settingsRef.current.translationMode || next.token !== settingsRef.current.token) {
        setTranslationFailed(false); setNotice('');
        setTranslationStatus({ pending: 0, failed: 0, retrying: 0, running: false });
        void connect();
      }
      settingsRef.current = next; setSettings(next);
    };
    browser.runtime.onMessage.addListener(listener);
    browser.storage.onChanged.addListener(storageListener);
    void (async () => {
      const initial = readSettings((await browser.storage.local.get('settings')).settings as Partial<Settings> | undefined);
      if (!mounted) return;
      settingsRef.current = initial; setSettings(initial);
      const [selection, snapshot] = await Promise.all([
        browser.runtime.sendMessage({ target: 'background', type: 'source' }),
        browser.runtime.sendMessage({ target: 'background', type: 'snapshot' }),
      ]);
      if (!mounted) return;
      setSource(selection?.source);
      if (snapshot?.state) { stateRef.current = snapshot.state; setState(snapshot.state); setCaptions(snapshot.captions || []); setPreview(snapshot.preview); setDrafts(snapshot.drafts || {}); showServiceStatus(snapshot.translationStatus); }
      await connect();
    })().catch(() => { if (mounted) { setChecking(false); setConnectionError('请重新打开侧栏。'); } });

    const lease = setInterval(() => { void sendOffscreen({ type: 'lease' }).catch(() => {}); }, 2000);
    const retry = setInterval(() => { if (!connectionRef.current && !isActive(stateRef.current.phase)) void connect(); }, 10000);
    return () => {
      mounted = false; clearInterval(lease); clearInterval(retry);
      browser.runtime.onMessage.removeListener(listener); browser.storage.onChanged.removeListener(storageListener);
    };
  }, [connect, sendOffscreen, showServiceStatus]);

  useEffect(() => {
    const update = () => setElapsed(state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0);
    update();
    if (!isActive(state.phase)) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state.phase, state.startedAt]);

  useEffect(() => {
    if (following && (captions.length || preview?.text) && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [captions, preview, following]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  async function start() {
    setWorking(true); setNotice(''); setTranslationFailed(false);
    try {
      const next = await connect();
      if (!next) return;
      const mode = settingsRef.current.translationMode;
      if (mode === 'offline' && next.translationState === 'failed') setNotice(`中文模型未能加载，可运行 ${SETUP_SCRIPT} 修复。英文可继续转录。`);
      else if (mode === 'offline' && next.translationState === 'loading') setNotice('英文已可使用，中文模型正在加载。');
      const result = await browser.runtime.sendMessage({ target: 'background', type: 'start', token: next.token,
        sentenceHold: settingsRef.current.sentenceHold });
      if (result?.error) setNotice(result.error);
    } catch (error) { setNotice(error instanceof Error ? error.message : '启动失败。'); }
    finally { setWorking(false); }
  }

  function startDesktop() {
    setMenu(false);
    const paired = connectionRef.current;
    if (!paired) { setNotice('请先连接本机服务。'); return; }
    void browser.runtime.sendMessage({ target: 'background', type: 'startDesktop', token: paired.token })
      .then(result => { if (!result?.ok) setNotice(result?.error || '桌面音频启动失败。'); }).catch(() => setNotice('桌面音频启动失败。'));
  }

  async function toggleOverlay() {
    const result = await browser.runtime.sendMessage({ target: 'background', type: 'overlay' }).catch(() => undefined);
    if (!result?.ok) setNotice('请先在声音所在的网页点一次工具栏里的 NimDaydu 图标，再打开悬浮字幕。');
  }

  async function control(type: 'pause' | 'resume' | 'stop' | 'clear') {
    setWorking(true); setMenu(false);
    try { const result = await sendOffscreen({ type }); if (result?.error) setNotice(result.error); }
    catch { setNotice('字幕服务无法响应，请重新打开侧栏。'); }
    finally { setWorking(false); }
  }

  async function repairTranslation() {
    setRepairing(true); setNotice('');
    // Retain successful captions and the audio session. Only repair this queue.
    try {
      await connect();
      await sendOffscreen({ type: 'retryTranslation' });
    } catch { setNotice('翻译暂未恢复，请在设置中检查本机模型和连接。英文字幕仍保留。'); }
    finally { setRepairing(false); }
  }

  const mode = settings.translationMode === 'off' ? 'original' : settings.viewMode;
  const readable = useMemo(() => readableCaptions(captions, mode, translationFailed), [captions, mode, translationFailed]);
  const visible = useMemo(() => search.trim() ? readable.filter(c => `${c.text} ${c.recognizedText || ''} ${c.translation || ''}`.toLowerCase().includes(search.trim().toLowerCase())) : readable, [readable, search]);
  const paragraphs = useMemo(() => groupParagraphs(visible), [visible]);
  const end = Math.min(pageEnd ?? paragraphs.length, paragraphs.length);
  const page = paragraphs.slice(Math.max(0, end - 60), end);
  function jumpHit(direction: number) {
    if (!visible.length) return;
    const i = (hit + direction + visible.length) % visible.length;
    setHit(i); setFollowing(false);
    const caption = visible[i]!;
    const group = paragraphs.findIndex(p => p.captions.includes(caption));
    setPageEnd(Math.min(paragraphs.length, (Math.floor(group / 60) + 1) * 60));
    requestAnimationFrame(() => scrollRef.current?.querySelector(`[data-caption-id="${CSS.escape(caption.id)}"]`)?.scrollIntoView({ block: 'center' }));
  }
  const active = isActive(state.phase);
  useEffect(() => {
    setPageEnd(search.trim() ? 60 : undefined);
    if (search.trim() && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search, state.sessionId]);
  const currentSource = active ? state.source : source || state.source;
  const waitingTranslation = !translationFailed && mode !== 'original' && captions.some(c => c.translationRevision !== c.revision);
  // Rows already show live English and reserved Chinese slots; a status line
  // that comes and goes at the bottom would only make the list jump.
  const pendingLabel = mode !== 'translated' ? '' : waitingTranslation ? t('translatingEllipsis') : active && state.pending ? t('assemblingTranslation') : '';
  const translationMessage = translationStatus.failed > 0 ? t('translationsToRetry', translationStatus.failed)
    : translationStatus.retrying > 0 ? t('translationRetrying') : '';
  const noticeText = notice || state.saveError || state.message;
  const site = currentSource?.site || '网页';
  const sourceLabel = Object.hasOwn(sourceLabels, site) ? t(sourceLabels[site as keyof typeof sourceLabels]) : site;
  const sourceTitle = currentSource?.title === '当前网页' ? t('currentTab')
    : site === 'Desktop' && currentSource?.title === '桌面音频' ? t('desktopAudio') : currentSource?.title;
  // Chinese-only mode shows live rows only once they have early Chinese.
  const visiblePreview = !search.trim() && Boolean(preview?.text)
    && (mode !== 'translated' || previewUnits(preview).some(unit => drafts[draftKey(unit)]));

  return <div className="app" style={{ '--caption-size': `${settings.fontSize}px` } as CSSProperties}>
    <header className="header">
      <h1>NimDaydu</h1>
      <div className="header-actions">
        <button className="icon-button" title={t('toggleOverlay') + ` (${IS_MAC ? 'Option' : 'Alt'}+Shift+O)`} aria-label={t('toggleOverlay')} onClick={() => void toggleOverlay()}><Icon name="overlay"/></button>
        <button className="icon-button" title={t('settings')} aria-label={t('settings')} onClick={() => void browser.runtime.openOptionsPage()}><Icon name="settings"/></button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-button" title={t('more')} aria-label={t('more')} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(v => !v)}><Icon name="more"/></button>
          {menu && <div className="menu" role="menu">
            <button role="menuitem" disabled={active || !connection} onClick={startDesktop}>{t('desktopCapture')}</button>
            <button role="menuitem" onClick={() => { setSearching(true); setMenu(false); }}>{t('searchCaptions')}</button>
            <button role="menuitem" aria-label={t('exportTxt')} disabled={!captions.length} onClick={() => { exportCaptions(captions, state, 'txt', language); setMenu(false); }}>{t('exportFormat', 'TXT')}</button>
            <button role="menuitem" aria-label={t('exportJson')} disabled={!captions.length} onClick={() => { exportCaptions(captions, state, 'json', language); setMenu(false); }}>{t('exportFormat', 'JSON')}</button>
            {(['srt', 'md'] as const).map(format => <button key={format} role="menuitem" disabled={!captions.length} onClick={() => { exportCaptions(captions, state, format, language); setMenu(false); }}>{t('exportFormat', format === 'md' ? 'Markdown' : 'SRT')}</button>)}
            <button role="menuitem" disabled={!captions.length} onClick={() => { void navigator.clipboard.writeText(subtitleText(visible, 'md')).catch(() => setNotice('复制失败，请使用导出。')); setMenu(false); }}>{t('copyBilingual')}</button>
            <button role="menuitem" onClick={() => { void browser.tabs.create({ url: browser.runtime.getURL('/library.html' as never) }); setMenu(false); }}>{t('historyAndFiles')}</button>
            <button role="menuitem" onClick={() => { void exportDiagnostics(translationStatus); setMenu(false); }}>{t('exportDiagnostics')}</button>
            <div className="menu-divider"/>
            <button role="menuitem" disabled={active || !captions.length} onClick={() => void control('clear')}>{t('clearCaptions')}</button>
          </div>}
        </div>
      </div>
    </header>
    <section className="session" aria-label={t('currentSource')}>
      <div className="source"><span className="site">{sourceLabel}</span><span className="source-title" title={sourceTitle}>{sourceTitle || t('selectSource')}</span></div>
      <div className="session-meta"><span className={`status-dot ${state.phase}`}/><span>{state.phase === 'capturing' && state.recovering ? t('catchingUp') : t(phaseLabels[state.phase])}</span>{state.startedAt && <time>{timestamp(elapsed)}</time>}<span className="languages">{t('languagePair')}</span></div>
    </section>
    {(noticeText || translationMessage) && <div className="notice" role="status"><p>{noticeText ? localizeNotice(language, noticeText) : `${translationMessage} ${t(active ? 'englishContinues' : 'englishKept')}`}</p>{translationStatus.failed > 0 && <button className="text-button" disabled={repairing} onClick={() => void repairTranslation()}>{repairing ? t('recovering') : t('retryTranslation')}</button>}{notice && <button className="icon-button small" aria-label={t('dismissNotice')} onClick={() => setNotice('')}><Icon name="close" size={14}/></button>}</div>}
    {editCaption && <form className="term-form" onSubmit={e => { e.preventDefault(); void commitTerm(); }}>
      <p>{editCaption.recognizedText || editCaption.text}</p>
      <label>{t('heardAs')}<input required maxLength={100} value={alias} onChange={e => setAlias(e.target.value)}/></label>
      <label>{t('replaceWith')}<input required maxLength={100} value={replacement} onChange={e => setReplacement(e.target.value)}/></label>
      <select aria-label={t('correctionScope')} value={scope} onChange={e => setScope(e.target.value)}><option value="line">{t('thisLine')}</option><option value="session">{t('wholeSession')}</option><option value="remember">{t('rememberCorrection')}</option></select>
      <button disabled={editing}>{t('apply')}</button><button type="button" disabled={editing} onClick={() => void commitTerm(true)}>{t('undoCorrection')}</button><button type="button" onClick={() => setEditId('')}>{t('close')}</button></form>}
    {searching && <div className="search-row"><Icon name="search" size={16}/><input aria-label={t('searchCaptions')} placeholder={t('searchCaptions')} value={search} autoFocus onChange={e => { setSearch(e.target.value); setHit(0); setFollowing(false); }} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setSearch(''); } }}/>{search && visible.length > 0 && <><span>{Math.min(hit + 1, visible.length)}/{visible.length}</span><button aria-label={t('previousMatch')} onClick={() => jumpHit(-1)}>↑</button><button aria-label={t('nextMatch')} onClick={() => jumpHit(1)}>↓</button></>}<button className="icon-button small" aria-label={t('closeSearch')} onClick={() => { setSearching(false); setSearch(''); }}><Icon name="close" size={14}/></button></div>}
    <div className="transcript" aria-label={t('bilingualCaptions')} ref={scrollRef} onScroll={() => {
      const element = scrollRef.current;
      if (element) setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 70);
    }}>
      {end > 60 && <button className="text-button" onClick={() => { setFollowing(false); setPageEnd(end - 60); scrollRef.current?.scrollTo(0, 0); }}>{t('earlierParagraphs')}</button>}
      {page.map(paragraph => <ParagraphRow key={paragraph.id} paragraph={paragraph} mode={mode} language={language} match={search} onEdit={id => { setEditId(id); setAlias(window.getSelection()?.toString().trim() || ''); setReplacement(''); setScope('line'); }}/>)}
      {end < paragraphs.length && <button className="text-button" onClick={() => setPageEnd(Math.min(paragraphs.length, end + 60))}>{t('laterParagraphs')}</button>}
      {visiblePreview && end === paragraphs.length && <LiveRows preview={preview} mode={mode} language={language} drafts={drafts}/>}
      {!visible.length && !visiblePreview && <div className="empty-state">
        {!active && !search && connection && <button className="text-button" onClick={() => void browser.tabs.create({ url: `http://127.0.0.1:8765/sample/?lang=${language}` })}>{t('playSample')}</button>}
        <p className="empty-title">{search ? t('noMatches') : active ? mode === 'translated' ? t('waitingTranslation') : t('waitingSpeech') : checking ? t('connectingService') : connectionError ? t('serviceDisconnected') : t('startToSeeCaptions')}</p>
        {!search && <p>{active ? mode === 'translated' ? t('waitTranslationHelp') : t('captionHelp') : connectionError ? localizeNotice(language, connectionError) : t('startHelp')}</p>}
        {!active && connectionError && <button className="text-button" onClick={() => { setChecking(true); void connect(); }}>{t('reconnect')}</button>}
      </div>}
      {pendingLabel && !search && <div className="pending" role="status"><span className="pending-dot"/>{pendingLabel}</div>}
    </div>
    {!following && (readable.length > 0 || visiblePreview) && <button className="back-to-live" onClick={() => { setSearch(''); setPageEnd(undefined); setFollowing(true); }}><Icon name="arrow" size={14}/>{t('latest')}</button>}
    {state.idleStopAt && state.phase === 'capturing' && <div className="notice" role="status">{t('idleCountdown', Math.max(0, Math.ceil((state.idleStopAt - Date.now()) / 1000)))}
      <button onClick={() => void sendOffscreen({ type: 'continueListening' })}>{t('keepListening')}</button><button onClick={() => void control('stop')}>{t('end')}</button></div>}
    <footer className="controls">
      {!active ? <button className="button primary" onClick={() => void start()} disabled={working || checking || !source}><Icon name="play" size={16}/>{working ? t('connecting') : t('start')}</button>
        : <><button className="button primary" onClick={() => void control(state.phase === 'paused' ? 'resume' : 'pause')} disabled={working || state.phase === 'starting' || state.phase === 'stopping'}><Icon name={state.phase === 'paused' ? 'play' : 'pause'} size={16}/>{state.phase === 'paused' ? t('resume') : t('pause')}</button><button className="button stop" onClick={() => void control('stop')} disabled={working || state.phase === 'starting' || state.phase === 'stopping'}><Icon name="stop" size={16}/>{t('end')}</button></>}
    </footer>
  </div>;
}
