import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, SERVICE, readSettings, type Settings, type TranslationMode, type ViewMode } from '../../lib/types';
import { connectLocal, type Connection } from '../../lib/connection';
import { LocalTranslator } from '../../lib/translation';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [connection, setConnection] = useState<Connection>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [key, setKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [languageStatus, setLanguageStatus] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const settingsRef = useRef(settings);
  const translator = useRef<LocalTranslator | null>(null);
  settingsRef.current = settings; translator.current ??= new LocalTranslator();

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
    return () => { browser.storage.onChanged.removeListener(listener); translator.current?.destroy(); };
  }, [connect]);

  async function save(update: Partial<Settings>) {
    const next = { ...settingsRef.current, ...update };
    settingsRef.current = next; setSettings(next);
    await browser.storage.local.set({ settings: next }); setSaved('已保存');
  }

  async function saveKey(clear = false) {
    setSavingKey(true); setError('');
    try {
      const current = await connectLocal();
      const response = await fetch(`${SERVICE}/providers/deepseek`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` },
        body: JSON.stringify(clear ? { clear: true } : { key: key.trim() }), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('密钥保存失败，请重启本机服务后重试。');
      setKey(''); await connect(); setSaved(clear ? '已移除密钥' : '密钥已保存在本机');
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败。'); }
    finally { setSavingKey(false); }
  }

  function prepareChrome() {
    setPreparing(true); setError(''); setLanguageStatus('正在准备语言包…');
    void translator.current!.prepare(value => setLanguageStatus(`正在下载 ${Math.round(value * 100)}%`))
      .then(() => setLanguageStatus('语言包已就绪'))
      .catch(error => { setError(error instanceof Error && error.name !== 'TimeoutError' ? error.message : '语言包准备超时。可以继续使用本机离线翻译。'); setLanguageStatus(''); })
      .finally(() => setPreparing(false));
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
        : response.status === 404 ? '请重启本机服务以加载新版。' : '模型尚未就绪，请运行 setup.ps1 后重试。');
      await connect(); setSaved('识别方式已保存');
    } catch (error) { setError(error instanceof Error ? error.message : '识别方式切换失败。'); }
    finally { setChangingModel(false); }
  }

  return <main className="settings-page">
    <header className="settings-header"><div><span className="product">NimDaydu</span><h1>设置</h1></div><span className="version">0.5.1</span></header>
    <p className="settings-intro">更改会自动保存。当前会话已显示的翻译保持不变。</p>
    {error && <div className="notice" role="status"><p>{error}</p></div>}
    <section className="settings-section" aria-labelledby="display-heading">
      <h2 id="display-heading">字幕</h2>
      <div className="setting-row"><label htmlFor="view">显示内容</label><select id="view" value={settings.viewMode} onChange={e => void save({ viewMode: e.target.value as ViewMode })}><option value="bilingual">中文和英文</option><option value="translated">仅中文</option><option value="original">仅英文</option></select></div>
      <div className="setting-row"><label htmlFor="font">文字大小</label><div className="range-setting"><input id="font" type="range" min="15" max="26" value={settings.fontSize} onChange={e => void save({ fontSize: Number(e.target.value) })}/><output htmlFor="font">{settings.fontSize} px</output></div></div>
      <div className="setting-row"><div><label htmlFor="hold">译文整理等待</label><p>英文实时显示；完整句子整理后再翻译。</p></div><select id="hold" value={settings.sentenceHold} onChange={e => void save({ sentenceHold: Number(e.target.value) })}><option value="0.8">0.8 秒</option><option value="1.2">1.2 秒</option><option value="0.4">0.4 秒</option></select></div>
      <p className="section-note">短语和日期通常等待 1.8 秒；续句仍在识别时会继续等待。此设置在下一次开始时生效。</p>
      <div className="preview" aria-label="字幕样式预览">{settings.viewMode !== 'original' && <p lang="zh-CN" style={{ fontSize: settings.fontSize }}>我们先检查代码，然后讨论下一步。</p>}{settings.viewMode !== 'translated' && <p lang="en" style={{ fontSize: settings.viewMode === 'original' ? settings.fontSize : settings.fontSize * .78 }}>Let's review the code first, then discuss the next step.</p>}</div>
    </section>

    <section className="settings-section" aria-labelledby="saving-heading">
      <h2 id="saving-heading">保存</h2>
      <div className="setting-row"><div><label htmlFor="auto-save">自动保存</label><p>保存已定稿的英文、译文和时间，不保存音频。</p></div><input id="auto-save" className="saving-switch" type="checkbox" role="switch" checked={settings.autoSave} onChange={event => void save({ autoSave: event.target.checked })}/></div>
      <p className="section-note output-path">{connection?.outputDirectory || '项目目录 / OUTPUTS'}<br/>按日期和会话保存 TXT、JSON，过程中持续更新。关闭后已有文件保留，重新开启不会补存关闭期间的新句子。</p>
    </section>

    <section className="settings-section" aria-labelledby="translation-heading">
      <h2 id="translation-heading">翻译</h2>
      <div className="setting-row"><label htmlFor="provider">翻译方式</label><select id="provider" value={settings.translationMode} onChange={e => void save({ translationMode: e.target.value as TranslationMode, viewMode: e.target.value === 'off' ? 'original' : 'bilingual' })}><option value="offline">本机离线模型</option><option value="deepseek">DeepSeek API</option><option value="local">Chrome 本地翻译</option><option value="off">关闭翻译</option></select></div>
      {settings.translationMode === 'offline' && <p className="section-note">在电脑上翻译英文完整句子，无需密钥。术语表位于项目的 glossary.json。</p>}
      {settings.translationMode === 'deepseek' && <div className="provider-detail"><p>只发送完整字幕和最近两句英文上下文。使用你已有的 API，费用由 DeepSeek 按量收取。</p><label htmlFor="api-key">API 密钥 {connection?.deepseekConfigured && <span className="configured">已配置</span>}</label><div className="key-row"><input id="api-key" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={e => setKey(e.target.value)}/><button className="button" disabled={savingKey || !key.trim()} onClick={() => void saveKey()}>保存</button></div><p className="section-note">密钥仅保存在本机服务中，不写入扩展存储。模型：{connection?.deepseekModel || 'deepseek-flash'}。</p>{connection?.deepseekConfigured && <button className="text-button" disabled={savingKey} onClick={() => void saveKey(true)}>移除已保存的密钥</button>}</div>}
      {settings.translationMode === 'local' && <div className="provider-detail"><p>需要 Chrome 提供英中语言包。准备失败时可切回本机离线模型。</p><div className="language-preparation"><button className="button" disabled={preparing} onClick={prepareChrome}>{preparing ? '准备中…' : '准备语言包'}</button><span role="status">{languageStatus}</span></div></div>}
    </section>

    <section className="settings-section" aria-labelledby="connection-heading">
      <h2 id="connection-heading">本机服务</h2>
      <div className="setting-row"><div><p className="connection-label"><span className={`status-dot ${connection ? 'capturing' : 'error'}`}/>{connection ? '已连接' : checking ? '连接中…' : '未连接'}</p><p>127.0.0.1:8765</p></div><button className="button" disabled={checking} onClick={() => void connect()}>重新连接</button></div>
      <div className="setting-row"><div><label htmlFor="asr">语音识别</label><p>结束会话后切换，选择会保存在本机。</p></div><select id="asr" value={connection?.model || 'small'} disabled={changingModel || !connection} onChange={event => void changeModel(event.target.value)}><option value="hybrid">实时英文 + 整句复核</option><option value="small">Moonshine Small</option><option value="medium">Moonshine Medium</option></select></div>
      <p className="section-note">整句复核使用 Moonshine Small 显示英文草稿，再由 Parakeet 重新识别原音频；最终句子完成后才翻译。全部在 CPU 上运行。</p>
      <dl className="diagnostics"><div><dt>英中翻译模型</dt><dd>{connection?.offlineTranslationReady ? '已就绪' : '未就绪'}</dd></div><div><dt>音频来源</dt><dd>所选 Chrome 标签页 · 不采集麦克风</dd></div></dl>
      <p className="section-note">先运行项目中的 Start-NimDaydu.cmd。本机服务启动后会自动连接。</p>
    </section>
    <footer className="settings-footer"><button className="text-button" onClick={() => void save({ ...DEFAULT_SETTINGS, token: settingsRef.current.token })}>恢复默认设置</button><span role="status">{saved}</span></footer>
  </main>;
}
