// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/options/App';

const mock = vi.hoisted(() => ({
  settings: { schema: 2, translationMode: 'local' } as any,
  uiLanguage: undefined as string | undefined,
  listeners: new Set<(changes: any, area: string) => void>(),
  set: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: {
  i18n: { getUILanguage: () => 'en-US' },
  runtime: { sendMessage: async () => ({}) },
  storage: { local: { get: async () => ({ settings: mock.settings, uiLanguage: mock.uiLanguage }), set: (value: any) => {
    if (value.settings) mock.settings = value.settings;
    if (value.uiLanguage) {
      mock.uiLanguage = value.uiLanguage;
      mock.listeners.forEach(listener => listener({ uiLanguage: { newValue: value.uiLanguage } }, 'local'));
    }
    mock.set(value); return Promise.resolve();
  } }, onChanged: { addListener: (listener: any) => mock.listeners.add(listener),
    removeListener: (listener: any) => mock.listeners.delete(listener) } },
} }));
vi.mock('./connection', () => ({ connectLocal: async () => ({ ready: true, model: 'hybrid',
  outputDirectory: 'E:\\Projects\\UniBuni\\Nimdaydu\\OUTPUTS' }) }));
afterEach(() => vi.unstubAllGlobals());

it('shows saving on for existing users, moves removed translation modes to the local model and remembers the switch after reopening settings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  await act(async () => root.render(<App/>));
  expect([...host.querySelectorAll('#provider option')].map(option => (option as HTMLOptionElement).value)).toEqual(['offline', 'off']);
  const control = host.querySelector<HTMLInputElement>('#auto-save')!;
  expect(control.checked).toBe(true);
  expect(host.textContent).toContain('E:\\Projects\\UniBuni\\Nimdaydu\\OUTPUTS');
  await act(async () => control.click());
  expect(mock.set).toHaveBeenLastCalledWith({ settings: expect.objectContaining({ autoSave: false, translationMode: 'offline' }) });
  await act(async () => root.unmount());
  root = createRoot(host); await act(async () => root.render(<App/>));
  expect(host.querySelector<HTMLInputElement>('#auto-save')!.checked).toBe(false);
  await act(async () => root.unmount()); host.remove();
});

it('remembers the interface language without changing which captions are shown', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  await act(async () => root.render(<App/>));
  expect(document.documentElement.lang).toBe('en');
  const language = host.querySelector<HTMLSelectElement>('#ui-language')!;
  await act(async () => {
    language.value = 'zh-CN';
    language.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('h1')?.textContent).toBe('设置');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(mock.set).toHaveBeenLastCalledWith({ uiLanguage: 'zh-CN' });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<App/>));
  expect(host.querySelector<HTMLSelectElement>('#ui-language')?.value).toBe('zh-CN');
  expect(host.querySelector<HTMLSelectElement>('#view')?.value).toBe('bilingual');
  await act(async () => root.unmount()); host.remove();
});
