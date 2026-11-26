import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, SERVICE, readSettings, type OverlayMode, type Settings, type TranslationMode, type ViewMode } from '../../lib/types';
import { connectLocal, type Connection } from '../../lib/connection';
import { IS_MAC, SETUP_SCRIPT, START_SCRIPT } from '../../lib/platform';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [connection, setConnection] = useState<Connection>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [changingModel, setChangingModel] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const connect = useCallback(async () => {
    setChecking(true); setError('');
    try {
      const next = await connectLocal();
      setConnection(next);
      const { token: _token, ...capabilities } = next;
      void browser.runtime.sendMessage({ target: 'ui', type: 'capabilities', capabilities }).catch(() => {});
    }
    catch (error) { setError(error instanceof Error ? error.message : '连接失败。'); }
    finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void browser.storage.local.get('settings').then(stored => setSettings(readSettings(stored.settings as Partial<Settings> | undefined)));
    const listener = (changes: any, area: string) => { if (area === 'local' && changes.settings?.newValue) setSettings(readSettings(changes.settings.newValue)); };
    browser.storage.onChanged.addListener(listener); void connect();
    return () => { browser.storage.onChanged.removeListener(listener); };
  }, [connect]);

  async function save(update: Partial<Settings>) {
    const next = { ...settingsRef.current, ...update };
    settingsRef.current = next; setSettings(next);
    await browser.storage.local.set({ settings: next }); setSaved('已保存');
  }

  async function changeModel(model: string) {
    setChangingModel(true); setError('');
    try {
      const current = await connectLocal();
      const response = await fetch(`${SERVICE}/models/asr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` },
        body: JSON.stringify({ model }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(response.status === 409 ? '请先结束当前字幕会话，再切换识别方式。'
        : response.status === 404 ? '请重启本机服务以加载新版。' : `模型尚未就绪，请运行 ${SETUP_SCRIPT} 后重试。`);
      await connect(); setSaved('识别方式已保存');
    } catch (error) { setError(error instanceof Error ? error.message : '识别方式切换失败。'); }
    finally { setChangingModel(false); }
  }

  const shortcut = IS_MAC ? 'Option+Shift+O' : 'Alt+Shift+O';

  return <main className="settings-page">
    <header className="settings-header"><div><span className="product">NimDaydu</span><h1>设置</h1></div><span className="version">{browser.runtime.getManifest?.().version}</span></header>
    <p className="settings-intro">更改会自动保存。已经显示的字幕不会改变。</p>
    {error && <div className="notice" role="status"><p>{error}</p></div>}

    <section className="settings-section" aria-labelledby="translation-heading">
      <h2 id="translation-heading">翻译</h2>
      <div className="setting-row"><label htmlFor="provider">翻译方式</label><select id="provider" value={settings.translationMode} onChange={e => void save({ translationMode: e.target.value as TranslationMode, viewMode: e.target.value === 'off' ? 'original' : settings.viewMode === 'original' ? 'bilingual' : settings.viewMode })}>
        <option value="offline">本机模型 Hy-MT2-1.8B</option>
        <option value="off">不翻译</option>
      </select></div>
      {settings.translationMode === 'offline' && <p className="section-note">在这台电脑上翻译，不需要网络或密钥，音频和文字都不会上传。{connection?.translationEngine ? `当前模型：${connection.translationEngine}。` : ''}</p>}
    </section>

    <section className="settings-section" aria-labelledby="display-heading">
      <h2 id="display-heading">字幕显示</h2>
      <div className="setting-row"><label htmlFor="view">显示内容</label><select id="view" value={settings.translationMode === 'off' ? 'original' : settings.viewMode} disabled={settings.translationMode === 'off'} onChange={e => void save({ viewMode: e.target.value as ViewMode })}><option value="bilingual">中文和英文</option><option value="translated">只看中文</option><option value="original">只看英文</option></select></div>
      <div className="setting-row"><label htmlFor="font">文字大小</label><div className="range-setting"><input id="font" type="range" min="15" max="26" value={settings.fontSize} onChange={e => void save({ fontSize: Number(e.target.value) })}/><output htmlFor="font">{settings.fontSize} px</output></div></div>
      <div className="setting-row"><div><label htmlFor="overlay">网页悬浮字幕</label><p>叠在会议或视频画面上：底部是实时英文，上面是逐句中文。拖动移动位置，拖顶部横条调高度。快捷键 {shortcut}。</p></div><select id="overlay" value={settings.overlay} onChange={e => void save({ overlay: e.target.value as OverlayMode })}><option value="fullscreen">全屏时自动显示</option><option value="always">一直显示</option><option value="off">关闭</option></select></div>
      <div className="setting-row"><div><label htmlFor="hold">出字速度</label><p>英文边说边显示，中文在每个短句说完后出现。“更完整”会多等一会儿，把同一句话合在一起翻译。下次开始时生效。</p></div><select id="hold" value={settings.sentenceHold} onChange={e => void save({ sentenceHold: Number(e.target.value) })}><option value="0.4">更快（推荐）</option><option value="0.8">均衡</option><option value="1.2">更完整</option></select></div>
      <div className="preview" aria-label="字幕样式预览">{settings.viewMode !== 'original' && settings.translationMode !== 'off' && <p lang="zh-CN" style={{ fontSize: settings.fontSize }}>我们先检查代码，</p>}{(settings.viewMode !== 'translated' || settings.translationMode === 'off') && <p lang="en" style={{ fontSize: settings.viewMode === 'original' || settings.translationMode === 'off' ? settings.fontSize : settings.fontSize * .78 }}>Let's review the code first,</p>}</div>
    </section>

    <section className="settings-section" aria-labelledby="speech-heading">
      <h2 id="speech-heading">语音识别</h2>
      <div className="setting-row"><div><label htmlFor="asr">识别方式</label><p>先显示实时英文，再由第二个模型连续复核原音。结束当前字幕后才能切换。</p></div><select id="asr" value={connection?.model ?? ''} disabled={changingModel || !connection} onChange={event => void changeModel(event.target.value)}>{!connection && <option value="">未连接</option>}<option value="hybrid">实时 + 原音复核（推荐）</option><option value="small">只用实时识别（更省电）</option><option value="medium">只用实时识别 · 较大模型</option></select></div>
    </section>

    <section className="settings-section" aria-labelledby="saving-heading">
      <h2 id="saving-heading">保存</h2>
      <div className="setting-row"><div><label htmlFor="auto-save">自动保存字幕</label><p>保存定稿的英文、中文和时间，不保存音频。</p></div><input id="auto-save" className="saving-switch" type="checkbox" role="switch" checked={settings.autoSave} onChange={event => void save({ autoSave: event.target.checked })}/></div>
      <p className="section-note output-path">保存位置：{connection?.outputDirectory || '项目文件夹中的 OUTPUTS'}<br/>每次字幕保存为一个文件夹，包含 TXT 和 JSON。</p>
    </section>

    <section className="settings-section" aria-label="悬浮与聆听">
      <h2>悬浮与聆听</h2>
      {([['overlayClickThrough', '鼠标穿过网页字幕'], ['overlayHideQuiet', '安静十秒后收起网页字幕'], ['idleReminder', '十分钟无新字幕后提醒，一分钟后自动结束']] as const).map(([key, label]) =>
        <label className="setting-row" key={key}>{label}<input type="checkbox" checked={settings[key]} onChange={e => void save({ [key]: e.target.checked })}/></label>)}
    </section>
    <section className="settings-section" aria-labelledby="connection-heading">
      <h2 id="connection-heading">本机服务</h2>
      <div className="setting-row"><div><p className="connection-label"><span className={`status-dot ${connection ? 'capturing' : 'error'}`}/>{connection ? '已连接' : checking ? '连接中…' : '未连接'}</p><p>{connection ? '识别和翻译都在这台电脑上运行。' : `请先运行项目里的 ${START_SCRIPT}，扩展会自动连接。`}</p></div><button className="button" disabled={checking} onClick={() => void connect()}>重新连接</button></div>
      {connection && <dl className="diagnostics"><div><dt>翻译模型</dt><dd>{connection.offlineTranslationReady ? connection.translationEngine || '已就绪' : connection.translationState === 'loading' ? '正在加载' : connection.translationState === 'idle' ? '按需加载' : '未就绪'}</dd></div><div><dt>音频来源</dt><dd>所选标签页，或主动共享声音的桌面来源</dd></div></dl>}
    </section>
    <footer className="settings-footer"><button className="text-button" onClick={() => void save({ ...DEFAULT_SETTINGS, token: settingsRef.current.token })}>恢复默认设置</button><span role="status">{saved}</span></footer>
  </main>;
}
