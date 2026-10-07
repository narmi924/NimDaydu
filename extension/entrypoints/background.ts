import { browser } from 'wxt/browser';
import type { Source } from '../lib/types';
import { identifySource } from '../lib/source';

export default defineBackground(() => {
  let source: Source | undefined;
  let creating: Promise<void> | undefined;

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
        return browser.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' });
      }
      if (message.type === 'start') {
        source ??= (await browser.storage.session.get('source')).source as Source | undefined;
        if (!source) throw new Error('请在声音所在网页点击 NimDaydu 图标。');
        const tab = await browser.tabs.get(source.tabId).catch(() => { throw new Error('来源标签页已关闭，请在声音所在网页重新点击插件图标。'); });
        if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('请在会议、直播或视频网页中开始。');
        source = { ...source, title: tab.title || source.title, ...identifySource(tab.url) };
        await ensureOffscreen();
        const snapshot = await browser.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' });
        if (['starting', 'capturing', 'paused', 'stopping'].includes(snapshot.state.phase)) throw new Error('已有字幕会话，请先停止。');
        const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: source.tabId });
        return browser.runtime.sendMessage({ target: 'offscreen', type: 'start', source, streamId, token: message.token, viewId: message.viewId, canTranslate: message.canTranslate, sentenceHold: message.sentenceHold });
      }
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
