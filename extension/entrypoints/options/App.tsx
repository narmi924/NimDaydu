import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, SERVICE, readSettings, type OverlayMode, type Settings, type TranslationMode, type ViewMode } from '../../lib/types';
import { connectLocal, type Connection } from '../../lib/connection';
import { IS_MAC, SETUP_SCRIPT, START_SCRIPT } from '../../lib/platform';

import { useUiLanguage } from '../../lib/useUiLanguage';
import { messagesFor } from '../../lib/ui-messages';
import { localizeNotice } from '../../lib/ui-notices';
import type { UiLanguage } from '../../lib/ui-language';

export default function App() {
  const language = useUiLanguage('settings');
  const t = messagesFor(language);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [connection, setConnection] = useState<Connection>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'saved' | 'recognitionSaved'>();
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
    await browser.storage.local.set({ settings: next }); setSaved('saved');
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
      await connect(); setSaved('recognitionSaved');
    } catch (error) { setError(error instanceof Error ? error.message : '识别方式切换失败。'); }
    finally { setChangingModel(false); }
  }

  const changeLanguage = (language: UiLanguage) => browser.storage.local.set({ uiLanguage: language });
  const shortcut = IS_MAC ? 'Option+Shift+O' : 'Alt+Shift+O';

  return <main className="settings-page">
    <header className="settings-header"><div><span className="product">NimDaydu</span><h1>{t('settings')}</h1></div><span className="version">{browser.runtime.getManifest?.().version}</span></header>

    {error && <div className="notice" role="status"><p>{localizeNotice(language, error)}</p></div>}

    <div className="setting-row language-setting"><label htmlFor="ui-language">{t('interfaceLanguage')}</label><select id="ui-language" value={language} onChange={e => void changeLanguage(e.target.value as UiLanguage)}>
      <option value="en" lang="en">English</option>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
    </select></div>

    <section className="settings-section" aria-labelledby="translation-heading">
      <h2 id="translation-heading">{t('translation')}</h2>
      <div className="setting-row"><label htmlFor="provider">{t('translationMode')}</label><select id="provider" value={settings.translationMode} onChange={e => void save({ translationMode: e.target.value as TranslationMode, viewMode: e.target.value === 'off' ? 'original' : settings.viewMode === 'original' ? 'bilingual' : settings.viewMode })}>
        <option value="offline">{t('localModel')}</option>
        <option value="off">{t('translationOff')}</option>
      </select></div>
      {settings.translationMode === 'offline' && <p className="section-note">{t('offlineDescription')}{connection?.translationEngine ? ' ' + t('modelInUse', connection.translationEngine) : ''}</p>}
    </section>

    <section className="settings-section" aria-labelledby="display-heading">
      <h2 id="display-heading">{t('captionDisplay')}</h2>
      <div className="setting-row"><label htmlFor="view">{t('show')}</label><select id="view" value={settings.translationMode === 'off' ? 'original' : settings.viewMode} disabled={settings.translationMode === 'off'} onChange={e => void save({ viewMode: e.target.value as ViewMode })}><option value="bilingual">{t('bothLanguages')}</option><option value="translated">{t('chineseOnly')}</option><option value="original">{t('englishOnly')}</option></select></div>
      <div className="setting-row"><label htmlFor="font">{t('textSize')}</label><div className="range-setting"><input id="font" type="range" min="15" max="26" value={settings.fontSize} onChange={e => void save({ fontSize: Number(e.target.value) })}/><output htmlFor="font">{settings.fontSize} px</output></div></div>
      <div className="setting-row"><div><label htmlFor="overlay">{t('pageOverlay')}</label><p>{t('overlayHelp', shortcut)}</p></div><select id="overlay" value={settings.overlay} onChange={e => void save({ overlay: e.target.value as OverlayMode })}><option value="fullscreen">{t('fullscreen')}</option><option value="always">{t('always')}</option><option value="off">{t('off')}</option></select></div>
      <div className="setting-row"><div><label htmlFor="hold">{t('captionTiming')}</label><p>{t('timingHelp')}</p></div><select id="hold" value={settings.sentenceHold} onChange={e => void save({ sentenceHold: Number(e.target.value) })}><option value="0.4">{t('faster')}</option><option value="0.8">{t('balanced')}</option><option value="1.2">{t('longerPhrases')}</option></select></div>
      <div className="preview" aria-label={t('captionPreview')}>{settings.viewMode !== 'original' && settings.translationMode !== 'off' && <p lang="zh-CN" style={{ fontSize: settings.fontSize }}>我们先检查代码，</p>}{(settings.viewMode !== 'translated' || settings.translationMode === 'off') && <p lang="en" style={{ fontSize: settings.viewMode === 'original' || settings.translationMode === 'off' ? settings.fontSize : settings.fontSize * .78 }}>Let's review the code first,</p>}</div>
    </section>

    <section className="settings-section" aria-labelledby="speech-heading">
      <h2 id="speech-heading">{t('speechRecognition')}</h2>
      <div className="setting-row"><div><label htmlFor="asr">{t('recognitionMode')}</label><p>{t('recognitionHelp')}</p></div><select id="asr" value={connection?.model ?? ''} disabled={changingModel || !connection} onChange={event => void changeModel(event.target.value)}>{!connection && <option value="">{t('disconnected')}</option>}<option value="hybrid">{t('hybrid')}</option><option value="small">{t('smallModel')}</option><option value="medium">{t('mediumModel')}</option></select></div>
    </section>

    <section className="settings-section" aria-labelledby="saving-heading">
      <h2 id="saving-heading">{t('saving')}</h2>
      <div className="setting-row"><div><label htmlFor="auto-save">{t('autoSave')}</label><p>{t('savingHelp')}</p></div><input id="auto-save" className="saving-switch" type="checkbox" role="switch" checked={settings.autoSave} onChange={event => void save({ autoSave: event.target.checked })}/></div>
      <p className="section-note output-path">{t('saveLocation', connection?.outputDirectory || t('defaultOutput'))}<br/>{t('saveFormats')}</p>
    </section>

    <section className="settings-section" aria-label={t('overlayListening')}>
      <h2>{t('overlayListening')}</h2>
      {([['overlayClickThrough', 'clickThrough'], ['overlayHideQuiet', 'hideQuiet'], ['idleReminder', 'idleReminder']] as const).map(([key, label]) =>
        <label className="setting-row" key={key}>{t(label)}<input type="checkbox" checked={settings[key]} onChange={e => void save({ [key]: e.target.checked })}/></label>)}
    </section>
    <section className="settings-section" aria-labelledby="connection-heading">
      <h2 id="connection-heading">{t('localService')}</h2>
      <div className="setting-row"><div><p className="connection-label"><span className={`status-dot ${connection ? 'capturing' : 'error'}`}/>{connection ? t('connected') : checking ? t('connecting') : t('disconnected')}</p><p>{connection ? t('serviceLocal') : t('serviceStartHelp', START_SCRIPT)}</p></div><button className="button" disabled={checking} onClick={() => void connect()}>{t('reconnect')}</button></div>
      {connection && <dl className="diagnostics"><div><dt>{t('translationModel')}</dt><dd>{connection.offlineTranslationReady ? connection.translationEngine || t('ready') : connection.translationState === 'loading' ? t('loading') : connection.translationState === 'idle' ? t('onDemand') : t('notReady')}</dd></div><div><dt>{t('audioSource')}</dt><dd>{t('selectedAudio')}</dd></div></dl>}
    </section>
    <footer className="settings-footer"><button className="text-button" onClick={() => void save({ ...DEFAULT_SETTINGS, token: settingsRef.current.token })}>{t('resetSettings')}</button><span role="status">{saved && t(saved)}</span></footer>
  </main>;
}
