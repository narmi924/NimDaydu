// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/sidepanel/App';

const mock = vi.hoisted(() => ({ listeners: new Set<(message: any) => void>(), send: vi.fn(), translate: vi.fn(), create: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: (...args: any[]) => mock.send(...args),
    onMessage: { addListener: (fn: any) => mock.listeners.add(fn), removeListener: (fn: any) => mock.listeners.delete(fn) } },
  storage: { local: { get: async () => ({ settings: { schema: 2, translationMode: 'local', token: 'test-token' } }) },
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
  mock.listeners.clear(); mock.translate.mockReset(); mock.create.mockReset(); mock.send.mockReset();
  mock.create.mockImplementation(async () => ({ translate: (...args: any[]) => mock.translate(...args), destroy() {} }));
  window.Translator = { availability: async () => 'available', create: mock.create };
  mock.send.mockImplementation(async (message: any) => {
    if (message.type === 'snapshot') return { state: { phase: 'capturing', sessionId: 'one', startedAt: Date.now() }, captions: [] };
    if (message.type === 'source') return { source: { title: 'Public QA sample', tabId: 1, windowId: 1 } };
    if (message.type === 'lease') return { owner: true };
    if (message.type === 'translation') { emit(message); return { ok: true }; }
    return { ok: true };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App/>); });
  await tick(2001);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete window.Translator;
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps accepting English and repairs Chinese after an actual view-level translation failure', async () => {
  let first = true;
  mock.translate.mockImplementation(async (text: string) => {
    if (text === 'Sentence 1.' && first) { first = false; throw new DOMException('test failure', 'OperationError'); }
    return text === 'Sentence 1.' ? '第一句译文' : '第二句译文';
  });
  await act(async () => emit({ type: 'caption', caption: caption('1') })); await tick(1);
  await act(async () => emit({ type: 'caption', caption: caption('2') })); await tick(1);
  expect(host.textContent).toContain('Sentence 2.'); expect(host.textContent).toContain('第二句译文');
  await tick(1100);
  expect(host.textContent).toContain('第一句译文'); expect(host.textContent).toContain('正在聆听');
  expect(mock.send.mock.calls.some(([message]) => message.type === 'stop')).toBe(false);
  expect(mock.create).toHaveBeenCalledTimes(2);
});

it('offers repair after bounded retries and restores missing Chinese without restarting capture or changing existing Chinese', async () => {
  let broken = true;
  mock.translate.mockImplementation(async (text: string) => {
    if (text === 'Sentence 1.' && broken) throw new DOMException('test failure', 'OperationError');
    return text === 'Sentence 1.' ? '第一句恢复' : '第二句保持';
  });
  await act(async () => { emit({ type: 'caption', caption: caption('1') }); emit({ type: 'caption', caption: caption('2') }); });
  await tick(4100);
  expect(host.textContent).toContain('第二句保持');
  const repair = [...host.querySelectorAll('button')].find(button => button.textContent === '恢复翻译');
  expect(repair).toBeDefined(); broken = false;
  await act(async () => repair!.click()); await tick(1);
  expect(host.textContent).toContain('第一句恢复'); expect(host.textContent).toContain('第二句保持');
  expect(mock.translate.mock.calls.filter(([text]) => text === 'Sentence 2.')).toHaveLength(1);
  expect(mock.send.mock.calls.some(([message]) => message.type === 'stop' || message.type === 'start')).toBe(false);
});
