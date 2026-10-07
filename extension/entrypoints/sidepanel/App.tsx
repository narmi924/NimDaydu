import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { browser } from 'wxt/browser';
import { applyTranslation, isActive, mergeCaption, readSettings, DEFAULT_SETTINGS, timestamp,
  type Caption, type CaptureState, type Settings, type Source, type ViewMode } from '../../lib/types';
import { serviceTranslate, LocalTranslator, TranslationQueue } from '../../lib/translation';
import { connectLocal, type Connection } from '../../lib/connection';
import { readableCaptions, groupParagraphs, type Paragraph } from '../../lib/reader';
import { exportCaptions } from '../../lib/export';
import Icon from '../../lib/Icon';

const PHASE_LABELS = { idle: '未开始', starting: '连接中', capturing: '正在聆听', paused: '已暂停', stopping: '正在结束', stopped: '已结束', error: '已断开' };

const ParagraphRow = memo(function ParagraphRow({ paragraph, mode }: { paragraph: Paragraph; mode: ViewMode }) {
  const translated = paragraph.captions.map(c => c.translation).filter(Boolean).join('');
  return <article className="paragraph">
    <div className="paragraph-meta"><time>{timestamp(paragraph.captions[0]!.start)}</time>{paragraph.captions.some(c => c.incomplete) && <span>语句未完</span>}</div>
    {mode !== 'original' && translated && <p className="chinese" lang="zh-CN">{translated}</p>}
    {(mode !== 'translated' || !translated) && <p className={mode === 'original' || !translated ? 'english only' : 'english'} lang="en">{paragraph.captions.map(c => c.text).join(' ')}</p>}
  </article>;
});

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<Source>();
  const [state, setState] = useState<CaptureState>({ phase: 'idle' });
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [connection, setConnection] = useState<Connection>();
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [translationFailed, setTranslationFailed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const settingsRef = useRef(settings);
  const captionsRef = useRef(captions);
  const stateRef = useRef(state);
  const connectionRef = useRef(connection);
  const errorRef = useRef(false);
  const ownerRef = useRef(false);
  const viewId = useRef(crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const translatorRef = useRef<LocalTranslator | null>(null);
  const queueRef = useRef<TranslationQueue | null>(null);
  settingsRef.current = settings; captionsRef.current = captions; stateRef.current = state;
  connectionRef.current = connection;
  translatorRef.current ??= new LocalTranslator();

  const sendOffscreen = useCallback((message: Record<string, unknown>) => browser.runtime.sendMessage({ target: 'offscreen', ...message }), []);
  const canTranslate = useCallback(() => {
    if (errorRef.current) return false;
    switch (settingsRef.current.translationMode) {
      case 'offline': return Boolean(connectionRef.current?.offlineTranslationReady);
      case 'deepseek': return Boolean(connectionRef.current?.deepseekConfigured);
      case 'local': return Boolean(translatorRef.current?.ready);
      default: return false;
    }
  }, []);

  if (!queueRef.current) queueRef.current = new TranslationQueue(async caption => {
    const config = settingsRef.current;
    if (config.translationMode === 'local') return translatorRef.current!.translate(caption.text);
    if (config.translationMode === 'offline') return serviceTranslate(caption.text, config.token, [], 'offline');
    if (config.translationMode === 'deepseek') {
      const context = captionsRef.current.filter(c => c.final && c.start < caption.start).slice(-2).map(c => c.text);
      return serviceTranslate(caption.text, config.token, context, 'deepseek');
    }
    throw new Error('翻译已关闭');
  }, (caption, text) => {
    void sendOffscreen({ type: 'translation', viewId: viewId.current, sessionId: caption.sessionId, id: caption.id, revision: caption.revision, text });
  }, error => {
    errorRef.current = true; setTranslationFailed(true);
    setNotice(error instanceof Error ? error.message : '翻译暂不可用，英文字幕已保留。');
  });

  const queueCaption = useCallback((caption: Caption) => {
    if (!ownerRef.current || !canTranslate() || caption.translationRevision === caption.revision) return;
    queueRef.current!.enqueue(caption);
  }, [canTranslate]);

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
          setCaptions([]); queueRef.current!.reset(); setFollowing(true);
          errorRef.current = false; setTranslationFailed(false);
        }
        setState(next);
      } else if (message.type === 'caption' && message.caption.final) {
        setCaptions(previous => mergeCaption(previous, message.caption)); queueCaption(message.caption);
      } else if (message.type === 'translation') setCaptions(previous => applyTranslation(previous, message));
      else if (message.type === 'cleared') { setCaptions([]); queueRef.current!.reset(); }
    };
    const storageListener = (changes: any, area: string) => {
      if (area !== 'local' || !changes.settings?.newValue) return;
      const next = readSettings(changes.settings.newValue);
      if (next.translationMode !== settingsRef.current.translationMode || next.token !== settingsRef.current.token) {
        queueRef.current!.reset(); ownerRef.current = false;
        errorRef.current = false; setTranslationFailed(false); setNotice('');
        void connect();
        if (next.translationMode === 'local' && !translatorRef.current!.ready) {
          void translatorRef.current!.availability().then(availability => {
            if (availability === 'available') return translatorRef.current!.prepare(() => {});
            setNotice('Chrome 语言包尚未就绪。可在设置中准备，或切回本机离线翻译。');
          }).catch(() => setNotice('Chrome 本地翻译不可用，请在设置中切回本机离线翻译。'));
        }
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
      if (snapshot?.state) { setState(snapshot.state); setCaptions(snapshot.captions || []); }
      await connect();
      if (initial.translationMode === 'local' && await translatorRef.current!.availability() === 'available') {
        await translatorRef.current!.prepare(() => {});
      }
    })().catch(() => { if (mounted) { setChecking(false); setConnectionError('请重新打开侧栏。'); } });

    const lease = setInterval(() => {
      void sendOffscreen({ type: 'lease', viewId: viewId.current, canTranslate: canTranslate() }).then(result => {
        const becameOwner = !ownerRef.current && result?.owner;
        if (ownerRef.current && !result?.owner) queueRef.current!.reset();
        ownerRef.current = Boolean(result?.owner);
        if (becameOwner) captionsRef.current.forEach(queueCaption);
      }).catch(() => {});
    }, 2000);
    const retry = setInterval(() => { if (!connectionRef.current && !isActive(stateRef.current.phase)) void connect(); }, 10000);
    return () => {
      mounted = false; clearInterval(lease); clearInterval(retry);
      browser.runtime.onMessage.removeListener(listener); browser.storage.onChanged.removeListener(storageListener);
      queueRef.current!.reset(); translatorRef.current?.destroy();
    };
  }, [canTranslate, connect, queueCaption, sendOffscreen]);

  useEffect(() => {
    const update = () => setElapsed(state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0);
    update();
    if (!isActive(state.phase)) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state.phase, state.startedAt]);

  useEffect(() => {
    if (following && captions.length && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [captions, following]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  async function start() {
    const localPreparation = settingsRef.current.translationMode === 'local'
      ? translatorRef.current!.prepare(() => {}) : Promise.resolve();
    setWorking(true); setNotice(''); errorRef.current = false; setTranslationFailed(false);
    try {
      await localPreparation;
      const next = await connect();
      if (!next) return;
      const mode = settingsRef.current.translationMode;
      if (mode === 'offline' && !next.offlineTranslationReady) throw new Error('本机翻译模型未就绪，请运行 setup.ps1 后重启服务。');
      if (mode === 'deepseek' && !next.deepseekConfigured) throw new Error('DeepSeek 尚未配置，请在设置中检查。');
      ownerRef.current = canTranslate();
      const result = await browser.runtime.sendMessage({ target: 'background', type: 'start', token: next.token,
        viewId: viewId.current, canTranslate: ownerRef.current, sentenceHold: settingsRef.current.sentenceHold });
      if (result?.error) setNotice(result.error);
    } catch (error) { setNotice(error instanceof Error ? error.message : '启动失败。'); }
    finally { setWorking(false); }
  }

  async function control(type: 'pause' | 'resume' | 'stop' | 'clear') {
    setWorking(true); setMenu(false);
    try { const result = await sendOffscreen({ type }); if (result?.error) setNotice(result.error); }
    catch { setNotice('字幕服务无法响应，请重新打开侧栏。'); }
    finally { setWorking(false); }
  }

  const mode = settings.translationMode === 'off' ? 'original' : settings.viewMode;
  const readable = useMemo(() => readableCaptions(captions, mode !== 'original', translationFailed), [captions, mode, translationFailed]);
  const visible = useMemo(() => search.trim() ? readable.filter(c => `${c.text} ${c.translation || ''}`.toLowerCase().includes(search.trim().toLowerCase())) : readable, [readable, search]);
  const paragraphs = useMemo(() => groupParagraphs(visible), [visible]);
  const active = isActive(state.phase);
  const currentSource = active ? state.source : source || state.source;
  const waitingTranslation = captions.length > readable.length;
  const pendingLabel = waitingTranslation ? '正在翻译…' : active && state.pending ? '正在整理下一句…' : '';

  return <div className="app" style={{ '--caption-size': `${settings.fontSize}px` } as CSSProperties}>
    <header className="header">
      <h1>NimDaydu</h1>
      <div className="header-actions">
        <button className="icon-button" title="设置" aria-label="设置" onClick={() => void browser.runtime.openOptionsPage()}><Icon name="settings"/></button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-button" title="更多" aria-label="更多" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(v => !v)}><Icon name="more"/></button>
          {menu && <div className="menu" role="menu">
            <button role="menuitem" onClick={() => { setSearching(true); setMenu(false); }}>搜索字幕</button>
            <button role="menuitem" aria-label="导出双语 TXT" disabled={!captions.length} onClick={() => { exportCaptions(captions, state, 'txt'); setMenu(false); }}>导出 TXT</button>
            <button role="menuitem" aria-label="导出字幕 JSON" disabled={!captions.length} onClick={() => { exportCaptions(captions, state, 'json'); setMenu(false); }}>导出 JSON</button>
            <div className="menu-divider"/>
            <button role="menuitem" disabled={active || !captions.length} onClick={() => void control('clear')}>清空字幕</button>
          </div>}
        </div>
      </div>
    </header>
    <section className="session" aria-label="当前来源">
      <div className="source"><span className="site">{currentSource?.site || '网页'}</span><span className="source-title" title={currentSource?.title}>{currentSource?.title || '在声音所在标签页点击插件图标'}</span></div>
      <div className="session-meta"><span className={`status-dot ${state.phase}`}/><span>{PHASE_LABELS[state.phase]}</span>{state.startedAt && <time>{timestamp(elapsed)}</time>}<span className="languages">EN → 中文</span></div>
    </section>
    {(notice || state.message) && <div className="notice" role="status"><p>{notice || state.message}</p>{notice && <button className="icon-button small" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14}/></button>}</div>}
    {searching && <div className="search-row"><Icon name="search" size={16}/><input aria-label="搜索字幕" placeholder="搜索字幕" value={search} autoFocus onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setSearch(''); } }}/><button className="icon-button small" aria-label="关闭搜索" onClick={() => { setSearching(false); setSearch(''); }}><Icon name="close" size={14}/></button></div>}
    <div className="transcript" aria-label="双语字幕" ref={scrollRef} onScroll={() => {
      const element = scrollRef.current;
      if (element) setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 70);
    }}>
      {paragraphs.map(paragraph => <ParagraphRow key={paragraph.id} paragraph={paragraph} mode={mode}/>)}
      {!visible.length && <div className="empty-state">
        <p className="empty-title">{search ? '没有匹配的字幕' : active ? '等待完整语句' : checking ? '正在连接本机服务' : connectionError ? '本机服务未连接' : '开始后显示双语字幕'}</p>
        {!search && <p>{active ? '句子整理和翻译完成后会显示在这里。' : connectionError || '播放网页中的声音，然后点击开始。'}</p>}
        {!active && connectionError && <button className="text-button" onClick={() => { setChecking(true); void connect(); }}>重新连接</button>}
      </div>}
      {pendingLabel && !search && <div className="pending" role="status"><span className="pending-dot"/>{pendingLabel}</div>}
    </div>
    {!following && readable.length > 0 && <button className="back-to-live" onClick={() => { setSearch(''); setFollowing(true); }}><Icon name="arrow" size={14}/>回到最新</button>}
    <footer className="controls">
      {!active ? <button className="button primary" onClick={() => void start()} disabled={working || checking || !source}><Icon name="play" size={16}/>{working ? '连接中…' : '开始'}</button>
        : <><button className="button primary" onClick={() => void control(state.phase === 'paused' ? 'resume' : 'pause')} disabled={working || state.phase === 'starting' || state.phase === 'stopping'}><Icon name={state.phase === 'paused' ? 'play' : 'pause'} size={16}/>{state.phase === 'paused' ? '继续' : '暂停'}</button><button className="button stop" onClick={() => void control('stop')} disabled={working || state.phase === 'starting' || state.phase === 'stopping'}><Icon name="stop" size={16}/>结束</button></>}
    </footer>
  </div>;
}
