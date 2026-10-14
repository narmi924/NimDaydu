// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/options/App';

const mock = vi.hoisted(() => ({ settings: { schema: 2, translationMode: 'local' } as any, set: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: async () => ({}) },
  storage: { local: { get: async () => ({ settings: mock.settings }), set: (value: any) => {
    mock.settings = value.settings; mock.set(value); return Promise.resolve();
  } }, onChanged: { addListener() {}, removeListener() {} } },
} }));
vi.mock('./connection', () => ({ connectLocal: async () => ({ ready: true, model: 'hybrid',
  outputDirectory: 'E:\\Projects\\UniBuni\\Nimdaydu\\OUTPUTS' }) }));
afterEach(() => vi.unstubAllGlobals());

it('shows saving on for existing users, preserves the provider and remembers the switch after reopening settings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  await act(async () => root.render(<App/>));
  const control = host.querySelector<HTMLInputElement>('#auto-save')!;
  expect(control.checked).toBe(true);
  expect(host.textContent).toContain('E:\\Projects\\UniBuni\\Nimdaydu\\OUTPUTS');
  await act(async () => control.click());
  expect(mock.set).toHaveBeenLastCalledWith({ settings: expect.objectContaining({ autoSave: false, translationMode: 'local' }) });
  await act(async () => root.unmount());
  root = createRoot(host); await act(async () => root.render(<App/>));
  expect(host.querySelector<HTMLInputElement>('#auto-save')!.checked).toBe(false);
  await act(async () => root.unmount()); host.remove();
});
