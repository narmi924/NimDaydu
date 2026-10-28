import { browser } from 'wxt/browser';
import { readSettings, type Settings, type Snapshot, type Source } from '../lib/types';
import { identifySource } from '../lib/source';

export default defineBackground(() => {
  let source: Source | undefined;
  let creating: Promise<void> | undefined;
  let starting = false;

  async function offscreenSnapshot(): Promise<Snapshot> {
    // createDocument resolving does not prove the module listener is ready.
    // Never interpret a missing reply as an idle session.
    for (let attempt = 0; attempt < 12; attempt++) {
      let cancelTimeout = () => {};
      try {
        const result = await Promise.race([
          browser.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
          new Promise<undefined>(resolve => {
            const timeout = setTimeout(() => resolve(undefined), 200);
            cancelTimeout = () => clearTimeout(timeout);
          }),
        ]);
        if (result?.state && ['idle', 'starting', 'capturing', 'paused', 'stopping', 'stopped', 'error'].includes(result.state.phase)
          && Array.isArray(result.captions)) return result as Snapshot;
      } catch { /* A just-created document may not have registered yet. */ }
      finally { cancelTimeout(); }
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('采音页面未能就绪，请在扩展管理页重新加载 NimDaydu 后重试。');
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings?.newValue) return;
    const settings = readSettings(changes.settings.newValue as Partial<Settings>);
    const previous = readSettings(changes.settings.oldValue as Partial<Settings> | undefined);
    if (settings.autoSave !== previous.autoSave) {
      void browser.runtime.sendMessage({ target: 'offscreen', type: 'settings', autoSave: settings.autoSave }).catch(() => {});
    }
    if (settings.translationMode !== previous.translationMode) {
      void browser.runtime.sendMessage({ target: 'offscreen', type: 'settings', translationMode: settings.translationMode }).catch(() => {});
    }
  });

  /** Floating captions run in the source tab. activeTab from the toolbar click,
   *  the keyboard shortcut or the capture itself allows injecting them. */
  async function injectOverlay(tabId: number) {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/overlay.js'] });
      return true;
    } catch { return false; }
  }

  /** Show or hide the caption on the page now; a fresh page (after a reload) shows it. */
  async function toggleOverlay(tabId?: number) {
    source ??= (await browser.storage.session.get('source')).source as Source | undefined;
    const target = tabId ?? source?.tabId;
    if (target == null) return { ok: false };
    try {
      const [probe] = await browser.scripting.executeScript({ target: { tabId: target },
        func: () => Boolean((window as typeof window & { __nimdayduOverlay?: unknown }).__nimdayduOverlay) });
      const fresh = !probe?.result;
      if (fresh && !await injectOverlay(target)) return { ok: false };
      await browser.scripting.executeScript({ target: { tabId: target }, args: [fresh],
        func: (show: boolean) => (window as typeof window & { __nimdayduOverlay?: (action: string) => void }).__nimdayduOverlay?.(show ? 'show' : 'toggle') });
      return { ok: true };
    } catch { return { ok: false }; }
  }

  browser.commands?.onCommand.addListener((command, tab) => {
    if (command === 'toggle-overlay') void toggleOverlay(tab?.id);
  });

  async function ensureOffscreen() {
    if (await browser.offscreen.hasDocument()) return;
    if (!creating) {
      creating = browser.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['USER_MEDIA'],
        justification: 'Capture selected tab audio, preserve playback, and send PCM to the local speech service.',
      }).finally(() => { creating = undefined; });
    }
    await creating;
  }

  browser.action.onClicked.addListener(tab => {
    if (tab.id == null) return;
    source = { tabId: tab.id, title: tab.title || '当前网页', windowId: tab.windowId, ...identifySource(tab.url) };
    void browser.storage.session.set({ source });
    // open() must be invoked in the toolbar action's user gesture.
    void browser.sidePanel.open({ windowId: tab.windowId });
    void browser.runtime.sendMessage({ target: 'ui', type: 'source', source }).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.target !== 'background' || sender.id !== browser.runtime.id) return;
    (async () => {
      if (message.type === 'source') {
        source ??= (await browser.storage.session.get('source')).source as Source | undefined;
        return { source };
      }
      if (message.type === 'snapshot') {
        if (!(await browser.offscreen.hasDocument())) return { state: { phase: 'idle' }, captions: [] };
        return offscreenSnapshot();
      }
      if (message.type === 'start') {
        if (starting) throw new Error('字幕正在启动，请稍候。');
        starting = true;
        try {
          source ??= (await browser.storage.session.get('source')).source as Source | undefined;
          if (!source) throw new Error('请在声音所在网页点击 NimDaydu 图标。');
          const tab = await browser.tabs.get(source.tabId).catch(() => { throw new Error('来源标签页已关闭，请在声音所在网页重新点击插件图标。'); });
          if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('请在会议、直播或视频网页中开始。');
          source = { ...source, title: tab.title || source.title, ...identifySource(tab.url) };
          await ensureOffscreen();
          const snapshot = await offscreenSnapshot();
          if (['starting', 'capturing', 'paused', 'stopping'].includes(snapshot.state.phase)) throw new Error('已有字幕会话，请先停止。');
          const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: source.tabId });
          const settings = readSettings((await browser.storage.local.get('settings')).settings as Partial<Settings> | undefined);
          const result = await browser.runtime.sendMessage({ target: 'offscreen', type: 'start', source, streamId, token: message.token, viewId: message.viewId, canTranslate: message.canTranslate, sentenceHold: message.sentenceHold, autoSave: settings.autoSave, translationMode: settings.translationMode });
          if (result?.error) throw new Error(result.error);
          if (!result?.ok) throw new Error('采音页面没有确认启动，请重新打开侧栏后重试。');
          // The page shows it according to the floating-caption setting.
          if (settings.overlay !== 'off') void injectOverlay(source.tabId);
          return result;
        } finally { starting = false; }
      }
      if (message.type === 'overlay') return toggleOverlay();
      if (message.type === 'badge') {
        await browser.action.setBadgeText({ text: message.phase === 'capturing' ? 'ON' : message.phase === 'paused' ? 'Ⅱ' : '' });
        await browser.action.setBadgeBackgroundColor({ color: '#d5d7dd' });
        return { ok: true };
      }
      return { ok: false };
    })().then(respond).catch(error => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  browser.tabs.onRemoved.addListener(tabId => {
    void browser.runtime.sendMessage({ target: 'offscreen', type: 'sourceClosed', tabId }).catch(() => {});
    void (async () => {
      source ??= (await browser.storage.session.get('source')).source as Source | undefined;
      if (source?.tabId === tabId) {
        source = undefined;
        await browser.storage.session.remove('source');
        await browser.runtime.sendMessage({ target: 'ui', type: 'source', source: undefined }).catch(() => {});
      }
    })();
  });
});
