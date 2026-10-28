import { browser } from 'wxt/browser';
import { readSettings, type Settings } from '../lib/types';
import { DEFAULT_OVERLAY_VIEW, OverlayCaptions, clampView, overlayRows, overlayVisible, type OverlayOverride, type OverlayRow, type OverlayView } from '../lib/overlay';

// After this long without anything new, the box turns more transparent.
const QUIET_MS = 10000;
const STYLE = `
.lane{display:flex;justify-content:center;width:100vw}
.box{pointer-events:auto;position:relative;left:var(--shift,0);box-sizing:border-box;width:min(88vw,calc(var(--size) * 34px));
  padding:4px 16px 10px;border-radius:8px;background:rgba(0,0,0,.5);
  color:#fff;text-align:left;cursor:grab;user-select:none;transition:background .4s;
  font-family:system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.box.dragging{cursor:grabbing}
.box.quiet{background:rgba(0,0,0,.3)}
.grip{height:10px;margin:0 -16px 2px;cursor:ns-resize;display:flex;justify-content:center;align-items:center}
.grip:before{content:'';width:36px;height:3px;border-radius:2px;background:rgba(255,255,255,.28)}
.list{max-height:calc(var(--height) * 1px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.item+.item{margin-top:7px}
p{margin:0;overflow-wrap:anywhere;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.zh{font-size:calc(var(--size) * 1px);line-height:1.45;font-weight:500}
.zh.pending{color:rgba(255,255,255,.4)}
.item.live .zh:not(.draft){visibility:hidden}
.zh.draft{color:rgba(255,255,255,.68)}
.en{font-size:calc(var(--size) * .76px);line-height:1.4;color:rgba(255,255,255,.84)}
.en.only{font-size:calc(var(--size) * 1px);line-height:1.45;color:#fff}
.item.live .en{color:rgba(255,255,255,.62)}
.item.live .en.only{color:rgba(255,255,255,.75)}
.caret{display:inline-block;width:2px;height:.95em;margin-left:4px;vertical-align:-1px;background:rgba(255,255,255,.6);animation:blink 1.2s ease-in-out infinite}
@keyframes blink{50%{opacity:.2}}
.status{font-size:12px;color:rgba(255,255,255,.6);padding:4px 0}
.status:empty{display:none}
.tools{position:absolute;top:-30px;right:0;display:flex;gap:4px;opacity:0;transition:opacity .15s}
.box:hover .tools,.box:focus-within .tools{opacity:1}
button{all:unset;cursor:pointer;font:600 11px/1 system-ui,sans-serif;color:#fff;background:rgba(12,13,16,.78);padding:6px 8px;border-radius:6px}
button:hover{background:rgba(48,50,58,.92)}
button:focus-visible{outline:2px solid #8ab4f8}
@media (prefers-reduced-motion:reduce){.caret{animation:none}}`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

type Item = { root: HTMLDivElement; zh: HTMLParagraphElement; en: HTMLParagraphElement; caret: HTMLSpanElement };

/** A draggable, semi-transparent caption list on the captured page: settled lines and live English. */
function mountOverlay() {
  const host = document.createElement('nimdaydu-captions');
  // The top layer keeps it above a fullscreen meeting or video player.
  host.setAttribute('popover', 'manual');
  // Full-width and anchored at its bottom edge, so it grows upwards.
  host.style.cssText = 'position:fixed;inset:auto;left:0;margin:0;padding:0;border:0;background:transparent;overflow:visible;'
    + 'pointer-events:none;width:100vw;max-width:none;transform:translateY(-100%);color-scheme:normal';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLE);
  root.adoptedStyleSheets = [sheet];
  const box = element('div', 'box');
  const tools = element('div', 'tools');
  const smaller = element('button', '', 'A−'); smaller.title = '缩小字幕';
  const larger = element('button', '', 'A+'); larger.title = '放大字幕';
  const close = element('button', '', '×'); close.title = '隐藏悬浮字幕（Alt+Shift+O 重新显示）';
  tools.append(smaller, larger, close);
  const grip = element('div', 'grip'); grip.title = '上下拖动调整高度';
  const list = element('div', 'list');
  const status = element('p', 'status');
  box.append(tools, grip, list, status);
  box.title = '拖动可移动位置，双击回到底部';
  const lane = element('div', 'lane');
  lane.append(box);
  root.append(lane);

  const data = new OverlayCaptions();
  const items = new Map<string, Item>();
  let settings: Settings = readSettings(undefined);
  let view: OverlayView = DEFAULT_OVERLAY_VIEW;
  let override: OverlayOverride;
  let sessionId: string | undefined;
  let alive = true;
  let following = true;
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  let retries = 0;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  let resize: { y: number; height: number } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const size = () => Math.round(settings.fontSize * 1.25 * view.scale);
  // About three sentences (Chinese and English) plus a live line.
  const height = () => view.height || Math.round(size() * 8.8 + 30);
  const opened = () => host.matches(':popover-open');
  const show = (restack = false) => {
    if (!host.isConnected) document.documentElement.append(host);
    if (restack && opened()) host.hidePopover();
    if (!opened()) host.showPopover();
  };
  const hide = () => { if (host.isConnected && opened()) host.hidePopover(); };

  const place = () => {
    box.style.setProperty('--size', String(size()));
    box.style.setProperty('--height', String(Math.min(height(), Math.round(innerHeight * .8))));
    box.style.setProperty('--shift', `${(view.x - .5) * 100}vw`);
    host.style.top = `${view.y * 100}vh`;
    if (!opened()) return;
    // Keep the whole caption inside the window, whatever its current size.
    const rect = box.getBoundingClientRect();
    const margin = 8;
    const dx = rect.left < margin ? margin - rect.left : rect.right > innerWidth - margin ? Math.min(0, innerWidth - margin - rect.right) : 0;
    const dy = rect.top < margin ? margin - rect.top : 0;
    if (!dx && !dy) return;
    view = { ...view, x: view.x + dx / innerWidth, y: view.y + dy / innerHeight };
    box.style.setProperty('--shift', `${(view.x - .5) * 100}vw`);
    host.style.top = `${view.y * 100}vh`;
  };

  /** Keyed update: a settled line keeps its element, so late Chinese fills its own slot. */
  function renderItems(rows: OverlayRow[], englishOnly: boolean) {
    const wanted = new Set(rows.map(row => row.key));
    for (const [key, item] of items) if (!wanted.has(key)) { item.root.remove(); items.delete(key); }
    let previous: Element | null = null;
    rows.forEach((row, index) => {
      let item = items.get(row.key);
      if (!item) {
        const zh = element('p', 'zh'); zh.lang = 'zh-CN';
        const en = element('p', 'en'); en.lang = 'en';
        const caret = element('span', 'caret');
        const itemRoot = element('div', 'item');
        itemRoot.append(zh, en);
        item = { root: itemRoot, zh, en, caret };
        items.set(row.key, item);
      }
      item.root.className = row.live ? 'item live' : 'item';
      const zhText = row.zh ?? (row.pending || row.live ? '…' : '');
      if (item.zh.textContent !== zhText) item.zh.textContent = zhText;
      item.zh.className = row.draft ? 'zh draft' : row.zh ? 'zh' : 'zh pending';
      item.zh.hidden = englishOnly || (row.zh === undefined && !row.pending && !row.live);
      const enText = row.en ?? '';
      if (item.en.firstChild?.nodeValue !== enText) item.en.textContent = enText;
      item.en.className = englishOnly ? 'en only' : 'en';
      item.en.hidden = row.en === undefined;
      if (row.live && index === rows.length - 1) item.en.append(item.caret); else item.caret.remove();
      const expected: ChildNode | null = previous ? previous.nextSibling : list.firstChild;
      if (item.root !== expected) list.insertBefore(item.root, expected);
      previous = item.root;
    });
  }

  function render(restack = false) {
    if (!alive) return;
    if (data.state.sessionId !== sessionId) { sessionId = data.state.sessionId; override = undefined; following = true; }
    if (!overlayVisible(settings.overlay, data.state.phase, Boolean(document.fullscreenElement), override)) { hide(); return; }
    const mode = settings.translationMode === 'off' ? 'original' : settings.viewMode;
    const rows = overlayRows(data.captions, data.preview, mode, data.drafts);
    renderItems(rows, mode === 'original');
    status.textContent = rows.length ? '' : data.state.phase === 'paused' ? 'NimDaydu · 已暂停' : 'NimDaydu · 等待语音';
    box.classList.toggle('quiet', Date.now() - data.updatedAt > QUIET_MS);
    show(restack);
    place();
    if (following) list.scrollTop = list.scrollHeight;
  }

  function teardown() {
    alive = false;
    clearInterval(timer);
    hide(); host.remove(); port?.disconnect();
  }

  function connect() {
    if (!alive) return;
    try {
      port = browser.runtime.connect({ name: 'nimdaydu-overlay' });
    } catch { teardown(); return; } // The extension was reloaded; this copy is orphaned.
    port.onMessage.addListener(message => { retries = 0; data.apply(message); render(); });
    port.onDisconnect.addListener(() => {
      port = undefined;
      void browser.runtime.lastError;
      // No capture page yet, or it was closed: try again with backoff.
      if (alive) setTimeout(connect, Math.min(15000, 1000 * 2 ** retries++));
    });
  }

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    box.addEventListener(type, event => event.stopPropagation());
  }
  // Reading back pauses following; scrolling to the bottom resumes it.
  list.addEventListener('scroll', () => { following = list.scrollHeight - list.scrollTop - list.clientHeight < 6; });
  const save = () => void browser.storage.local.set({ overlayView: view }).catch(() => {});
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    resize = { y: event.clientY, height: Math.min(height(), Math.round(innerHeight * .8)) };
    grip.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
  });
  grip.addEventListener('pointermove', event => {
    if (!resize) return;
    // Anchored at the bottom: dragging the top edge up makes it taller.
    view = { ...view, height: Math.max(size() * 3, Math.min(Math.round(innerHeight * .8), resize.height + resize.y - event.clientY)) };
    place();
    if (following) list.scrollTop = list.scrollHeight;
  });
  grip.addEventListener('pointerup', () => { if (!resize) return; resize = undefined; save(); });
  box.addEventListener('pointerdown', event => {
    if ((event.target as Element).closest('button') || event.button !== 0 || resize) return;
    // Leave the list's own scrollbar usable.
    if (event.target === list && event.offsetX >= list.clientWidth) return;
    drag = { x: event.clientX, y: event.clientY, left: view.x, top: view.y };
    box.setPointerCapture(event.pointerId); box.classList.add('dragging'); event.preventDefault();
  });
  box.addEventListener('pointermove', event => {
    if (!drag) return;
    view = clampView({ ...view, x: drag.left + (event.clientX - drag.x) / innerWidth, y: drag.top + (event.clientY - drag.y) / innerHeight });
    place();
  });
  box.addEventListener('pointerup', () => { if (!drag) return; drag = undefined; box.classList.remove('dragging'); save(); });
  box.addEventListener('dblclick', () => { view = { ...DEFAULT_OVERLAY_VIEW, scale: view.scale, height: view.height }; place(); save(); });
  smaller.addEventListener('click', () => { view = clampView({ ...view, scale: view.scale - .1 }); place(); save(); });
  larger.addEventListener('click', () => { view = clampView({ ...view, scale: view.scale + .1 }); place(); save(); });
  close.addEventListener('click', () => { override = 'hidden'; render(); });

  document.addEventListener('fullscreenchange', () => render(true));
  timer = setInterval(() => { if (alive && opened()) box.classList.toggle('quiet', Date.now() - data.updatedAt > QUIET_MS); }, 1000);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !alive) return;
    if (changes.settings) {
      const next = readSettings(changes.settings.newValue as Partial<Settings> | undefined);
      if (next.overlay !== settings.overlay) override = undefined;
      settings = next;
    }
    if (changes.overlayView && !drag && !resize) view = clampView(changes.overlayView.newValue as Partial<OverlayView>);
    render();
  });
  void browser.storage.local.get(['settings', 'overlayView']).then(stored => {
    settings = readSettings(stored.settings as Partial<Settings> | undefined);
    view = clampView(stored.overlayView as Partial<OverlayView> | undefined);
    connect();
  }).catch(teardown);

  // The shortcut and the panel button show or hide it on this page right now.
  return (action: 'show' | 'toggle') => {
    override = action === 'show' || !opened() ? 'shown' : 'hidden';
    if (override === 'shown') following = true;
    render();
  };
}

export default defineContentScript({
  registration: 'runtime',
  // Do not post WXT's start-up message into the meeting page itself.
  noScriptStartedPostMessage: true,
  main() {
    const scope = window as typeof window & { __nimdayduOverlay?: (action: 'show' | 'toggle') => void };
    scope.__nimdayduOverlay ??= mountOverlay();
  },
});
