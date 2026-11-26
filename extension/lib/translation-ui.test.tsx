// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/sidepanel/App';

const mock = vi.hoisted(() => ({ listeners: new Set<(message: any) => void>(), send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: (...args: any[]) => mock.send(...args),
    onMessage: { addListener: (fn: any) => mock.listeners.add(fn), removeListener: (fn: any) => mock.listeners.delete(fn) } },
  storage: { local: { get: async () => ({ settings: { schema: 2, translationMode: 'offline', token: 'test-token' } }) },
    onChanged: { addListener() {}, removeListener() {} } },
} }));
vi.mock('./connection', () => ({ connectLocal: async () => ({ token: 'test-token', ready: true, model: 'small' }) }));
let root: Root;
let host: HTMLDivElement;
function emit(message: any) { mock.listeners.forEach(listener => listener({ ...message, target: 'ui' })); }
const caption = (id: string) => ({ sessionId: 'one', id, revision: 1, final: true, text: `Sentence ${id}.`, start: Number(id), end: Number(id) + 1 });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mock.listeners.clear(); mock.send.mockReset();
  mock.send.mockImplementation(async (message: any) => {
    if (message.type === 'snapshot') return { state: { phase: 'capturing', sessionId: 'one', startedAt: Date.now() }, captions: [] };
    if (message.type === 'source') return { source: { title: 'Public QA sample', tabId: 1, windowId: 1 } };
    return { ok: true };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App/>); });
  await tick(2001);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps English and completed Chinese visible when the service reports a translation failure', async () => {
  await act(async () => {
    emit({ type: 'caption', caption: caption('1') });
    emit({ type: 'caption', caption: caption('2') });
    emit({ type: 'translation', sessionId: 'one', id: '2', revision: 1, text: '第二句译文。' });
    emit({ type: 'translationStatus', status: { pending: 1, failed: 1, retrying: 0, running: false } });
  });
  expect(host.textContent).toContain('Sentence 1.');
  expect(host.textContent).toContain('第二句译文。');
  expect(host.textContent).toContain('正在聆听');
  expect(host.textContent).toContain('恢复翻译');
  expect(mock.send.mock.calls.some(([message]) => message.type === 'stop')).toBe(false);
});

it('requests service repair without restarting capture or changing completed Chinese', async () => {
  await act(async () => {
    emit({ type: 'caption', caption: caption('1') });
    emit({ type: 'caption', caption: caption('2') });
    emit({ type: 'translation', sessionId: 'one', id: '2', revision: 1, text: '第二句保持。' });
    emit({ type: 'translationStatus', status: { pending: 1, failed: 1, retrying: 0, running: false } });
  });
  const repair = [...host.querySelectorAll('button')].find(button => button.textContent === '恢复翻译');
  expect(repair).toBeDefined();
  mock.send.mockImplementationOnce(async (message: any) => {
    expect(message.type).toBe('retryTranslation');
    emit({ type: 'translation', sessionId: 'one', id: '1', revision: 1, text: '第一句恢复。' });
    emit({ type: 'translationStatus', status: { pending: 0, failed: 0, retrying: 0, running: false } });
    return { ok: true };
  });
  await act(async () => repair!.click());
  expect(host.textContent).toContain('第一句恢复。');
  expect(host.textContent).toContain('第二句保持。');
  expect(mock.send.mock.calls.some(([message]) => message.type === 'stop' || message.type === 'start')).toBe(false);
});
