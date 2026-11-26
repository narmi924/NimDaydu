import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { connectLocal } from '../../lib/connection';
import { HighlightedText } from '../../lib/CaptionReader';
import { exportCaptions } from '../../lib/export';
import { OverlayCaptions, overlayRows } from '../../lib/overlay';
import { SERVICE, applyTranslation, readSettings, timestamp, type Caption, type Settings, type Source } from '../../lib/types';
import '../../lib/base.css';
import './style.css';

type RecordInfo = { sessionId: string; startedAt: string; source: Source; count?: number; searchTerms?: string[] };
type Recording = RecordInfo & { captions: Caption[] };

async function request(path: string, init: RequestInit = {}) {
  const { token } = await connectLocal();
  const response = await fetch(SERVICE + path, { ...init, headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : '无法读取本机服务。');
  }
  return response;
}

async function openFloating() {
  const api = (window as Window & { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } }).documentPictureInPicture;
  if (!api) throw new Error('这个浏览器无法打开置顶字幕窗。');
  const pip = await api.requestWindow({ width: 530, height: 190 });
  const body = pip.document.body;
  body.style.cssText = 'background:#171717;color:white;font:18px/1.4 system-ui;padding:.4em;overflow:auto';
  const data = new OverlayCaptions();
  let settings = readSettings((await browser.storage.local.get('settings')).settings as Partial<Settings>);
  const ready = await browser.runtime.sendMessage({ target: 'background', type: 'openFloating' });
  if (ready?.error) { pip.close(); throw new Error(ready.error); }
  const port = browser.runtime.connect({ name: 'nimdaydu-overlay' });
  body.textContent = '等待实时字幕';
  function render() {
    body.style.fontSize = settings.fontSize + 'px';
    const mode = settings.translationMode === 'off' ? 'original' : settings.viewMode;
    const rows = overlayRows(data.captions, data.preview, mode, data.drafts).slice(-3);
    if (!rows.length && !data.state.idleStopAt) { body.textContent = '等待实时字幕'; return; }
    body.replaceChildren(...rows.map(row => {
      const div = pip.document.createElement('div');
      if (row.zh) div.append(row.zh);
      if (row.en) {
        if (row.zh) div.append(pip.document.createElement('br'));
        div.append(row.en);
      }
      return div;
    }));
    if (data.state.idleStopAt) {
      const button = pip.document.createElement('button');
      button.textContent = '即将自动结束 · 继续听';
      button.onclick = () => { void browser.runtime.sendMessage({ target: 'offscreen', type: 'continueListening' }); };
      body.append(button);
    }
    body.scrollTop = body.scrollHeight;
  }
  port.onMessage.addListener(message => { data.apply(message); render(); });
  function preferences(changes: { settings?: { newValue?: unknown } }, area: string) {
    if (area === 'local' && changes.settings) {
      settings = readSettings(changes.settings.newValue as Partial<Settings>);
      render();
    }
  }
  browser.storage.onChanged.addListener(preferences);
  pip.addEventListener('pagehide', () => {
    browser.storage.onChanged.removeListener(preferences);
    port.disconnect();
  }, { once: true });
}

function Library() {
  const [records, setRecords] = useState<RecordInfo[]>([]);
  const [record, setRecord] = useState<Recording>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [hit, setHit] = useState(0);
  const terms = useMemo(() => records.find(r => r.sessionId === record?.sessionId)?.searchTerms || [query.trim().toLowerCase()].filter(Boolean),
    [records, record?.sessionId, query]);
  const hits = useMemo(() => (record?.captions || []).flatMap((c, index) =>
    terms.some(term => [c.text, c.translation, c.recognizedText].some(t => t?.toLowerCase().includes(term))) ? [index] : []),
    [record?.captions, terms]);
  const pageSize = 100;
  const pages = Math.ceil((record?.captions.length || 0) / pageSize);
  useEffect(() => { setPage(0); setHit(0); }, [record?.sessionId, query]);
  function jump(index: number) {
    if (!hits.length) return;
    const next = (index + hits.length) % hits.length;
    const position = hits[next]!;
    setHit(next); setPage(Math.floor(position / pageSize));
    requestAnimationFrame(() => document.getElementById('caption-' + position)?.scrollIntoView({ block: 'center' }));
  }
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<File>();
  const [url, setUrl] = useState('');
  const player = useRef<HTMLVideoElement>(null);
  const current = useRef<AbortController | undefined>(undefined);
  async function playFrom(start: number) {
    const video = player.current;
    if (!video) return;
    video.currentTime = start;
    try { await video.play(); }
    catch (err) { if (!(err instanceof DOMException && err.name === 'AbortError')) fail(err); }
  }
  const version = useRef(0);
  const fail = (err: unknown) => setStatus(err instanceof Error ? err.message : '操作失败。');
  async function list(q: string) {
    const id = ++version.current;
    const data = await (await request('/records?q=' + encodeURIComponent(q))).json();
    if (version.current === id) setRecords(data);
  }
  useEffect(() => { const timer = setTimeout(() => void list(query).catch(fail), 200); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!media) { setUrl(''); return; }
    const src = URL.createObjectURL(media); setUrl(src); return () => URL.revokeObjectURL(src);
  }, [media]);
  useEffect(() => () => current.current?.abort(), []);

  async function transcribe() {
    if (!media || busy) return;
    setBusy(true); setStatus('正在读取文件…');
    const controller = new AbortController(); current.current = controller;
    try {
      const settings = readSettings((await browser.storage.local.get('settings')).settings as Partial<Settings>);
      const args = new URLSearchParams({ title: media.name, bilingual: String(settings.translationMode === 'offline'), save: String(settings.autoSave) });
      const response = await request('/import?' + args, { method: 'POST', body: media, signal: controller.signal });
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      const source = { title: media.name, site: 'Local file', tabId: -1, windowId: -1 };
      let saved: Recording = { sessionId: '', startedAt: new Date().toISOString(), source, captions: [] };
      setRecord(saved);
      let pending = '', done = false, missing = 0;
      for (;;) {
        const packet = await reader.read(); if (packet.done) break;
        pending += packet.value;
        const lines = pending.split('\n'); pending = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'error') throw new Error(event.message);
          saved = { ...saved, sessionId: event.sessionId };
          if (event.type === 'caption') saved.captions = [...saved.captions, event];
          if (event.type === 'translation') saved.captions = applyTranslation(saved.captions, event);
          if (event.type === 'warning') missing++;
          if (event.type === 'done') { done = true; missing = event.missingTranslations || 0; }
        }
        setRecord(saved); setStatus('已转录 ' + saved.captions.length + ' 条' + (missing ? '，部分中文未译出。' : ''));
      }
      if (!done) throw new Error('转录中断，已经返回的字幕可以导出。');
      setStatus(missing ? `英文转录完成，${missing} 条缺少中文。` : '转录完成'); await list(query);
    } catch (err) { if (controller.signal.aborted) setStatus('已停止文件转录。'); else fail(err); }
    finally { current.current = undefined; setBusy(false); }
  }

  return <><h1>字幕记录</h1>
    <section><h2>历史记录</h2><input type="search" value={query} placeholder="搜索日期、来源或字幕" onChange={e => setQuery(e.target.value)}/>
      <select aria-label="选择记录" disabled={busy} value={records.some(r => r.sessionId === record?.sessionId) ? record?.sessionId : ''} onChange={e => {
        const id = e.target.value; if (!id) return;
        void request('/records/' + id).then(r => r.json()).then(saved => { setRecord(saved); setMedia(undefined); setStatus(''); }).catch(fail);
      }}><option value="">选择记录（{records.length}）</option>{records.map(r => <option key={r.sessionId} value={r.sessionId}>{r.startedAt.slice(0, 16)} · {r.source.title}</option>)}</select></section>
    <section><h2>本地音视频</h2>
      <input type="file" accept="audio/*,video/*,.mkv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; setMedia(file); if (file?.name !== record?.source.title) setRecord(undefined); }}/>
      <button disabled={!media || busy} onClick={() => void transcribe()}>{record ? '重新转录文件' : '转录文件'}</button>
      {busy && <button onClick={() => current.current?.abort()}>停止</button>}
      {url && <video controls src={url} ref={player}/>}</section>
    <section className="actions"><button onClick={() => void openFloating().catch(fail)}>打开实时置顶字幕</button>
      {record && (['srt', 'md', 'txt', 'json'] as const).map(f => <button key={f} onClick={() => exportCaptions(record.captions, { phase: 'stopped', sessionId: record.sessionId, source: record.source, startedAt: Date.parse(record.startedAt) }, f)}>导出 {f.toUpperCase()}</button>)}</section>
    <p role="status">{status}</p>{record && <section><h2>{record.source.title}</h2>
      {hits.length > 0 && <nav aria-label="字幕匹配"><button onClick={() => jump(hit - 1)}>上一条匹配</button>
        <button onClick={() => jump(hit)}>定位第 {hit + 1} / {hits.length} 条匹配</button><button onClick={() => jump(hit + 1)}>下一条匹配</button></nav>}
      {pages > 1 && <nav aria-label="字幕分页"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button>
        {page + 1} / {pages}<button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}
      {record.captions.slice(page * pageSize, (page + 1) * pageSize).map((c, index) => <article key={c.id} id={'caption-' + (page * pageSize + index)}>
      {url ? <button onClick={() => void playFrom(c.start)}>{timestamp(c.start)}</button> : <time>{timestamp(c.start)}</time>}
      <p><HighlightedText text={c.text} terms={terms}/><br/><HighlightedText text={c.translation || ''} terms={terms}/></p>
      {c.recognizedText && terms.some(t => c.recognizedText!.toLowerCase().includes(t) && !c.text.toLowerCase().includes(t)) &&
        <small>原识别 · <HighlightedText text={c.recognizedText} terms={terms}/></small>}</article>)}</section>}</>;
}
createRoot(document.getElementById('root')!).render(<Library/>);
