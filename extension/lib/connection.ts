import { browser } from 'wxt/browser';
import { SERVICE, readSettings, type Settings } from './types';
export type Connection = { token: string; ready: boolean; offlineTranslationReady: boolean; deepseekConfigured: boolean; deepseekModel?: string; model: string; version: string; error?: string; outputDirectory?: string };
let connecting: Promise<Connection> | undefined;
export async function connectLocal(): Promise<Connection> {
  if (connecting) return connecting;
  connecting = (async () => {
    let response: Response;
    try { response = await fetch(`${SERVICE}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(6000) }); }
    catch { throw new Error('本机服务未启动。运行 Start-NimDaydu.cmd 后重试。'); }
    if (response.status === 404) throw new Error('请重启本机服务，以加载更新。');
    if (!response.ok) throw new Error('本机连接失败，请在设置中重新连接。');
    const result: Connection = await response.json();
    if (!result.ready) throw new Error('语音模型未就绪，请运行 setup.ps1 后重启本机服务。');
    const raw = (await browser.storage.local.get('settings')).settings as Partial<Settings> | undefined;
    const stored = readSettings(raw);
    if (stored.token !== result.token || raw?.schema !== 2) await browser.storage.local.set({ settings: { ...stored, token: result.token } });
    return result;
  })().finally(() => { connecting = undefined; });
  return connecting;
}
