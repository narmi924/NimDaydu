import { browser } from 'wxt/browser';

export type UiLanguage = 'en' | 'zh-CN';

export function defaultUiLanguage(): UiLanguage {
  const locale = browser.i18n.getUILanguage();
  return /^zh(?:-|$)/i.test(locale) ? 'zh-CN' : 'en';
}

export function watchUiLanguage(update: (language: UiLanguage) => void) {
  const read = (value: unknown) => update(value === 'en' || value === 'zh-CN' ? value : defaultUiLanguage());
  let active = true;
  let changed = false;
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local' || !changes.uiLanguage) return;
    changed = true;
    read(changes.uiLanguage.newValue);
  };
  browser.storage.onChanged.addListener(listener);
  void browser.storage.local.get('uiLanguage').then(stored => {
    if (active && !changed) read(stored.uiLanguage);
  });
  return () => {
    active = false;
    browser.storage.onChanged.removeListener(listener);
  };
}
