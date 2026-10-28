import { afterEach, expect, it, vi } from 'vitest';
import { LocalTranslator, TranslationQueue, finalTranslation, serviceTranslate } from './translation';
import type { Caption } from './types';
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const caption = (id: string, final = true): Caption => ({ sessionId: 'one', id, revision: 1, final, text: `Complete sentence ${id}.`, start: 0, end: 1 });

it('only translates finalized sentences once and delivers them in reading order', async () => {
  vi.useFakeTimers();
  const translate = vi.fn(async c => c.text);
  const deliver = vi.fn();
  const queue = new TranslationQueue(translate, deliver, vi.fn());
  queue.enqueue(caption('draft', false)); queue.enqueue(caption('a')); queue.enqueue(caption('a')); queue.enqueue(caption('b'));
  await vi.runAllTimersAsync();
  queue.enqueue(caption('a')); await vi.runAllTimersAsync();
  expect(translate.mock.calls.map(call => call[0].id)).toEqual(['a', 'b']);
  expect(deliver.mock.calls.map(call => call[0].id)).toEqual(['a', 'b']);
});

it('drops an in-flight translation after changing session or provider', async () => {
  vi.useFakeTimers();
  let resolve!: (text: string) => void;
  const translate = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const deliver = vi.fn();
  const queue = new TranslationQueue(translate, deliver, vi.fn());
  queue.enqueue(caption('a')); await vi.advanceTimersByTimeAsync(1);
  queue.reset(); resolve('stale translation'); await vi.runAllTimersAsync();
  expect(deliver).not.toHaveBeenCalled();
});

it('does not retranslate already displayed Chinese', async () => {
  vi.useFakeTimers();
  const translate = vi.fn(async () => '中文。');
  const queue = new TranslationQueue(translate, vi.fn(), vi.fn());
  queue.enqueue({ ...caption('a'), translation: '已完成。', translationRevision: 1 });
  await vi.runAllTimersAsync();
  expect(translate).not.toHaveBeenCalled();
});

it('formats sentence boundaries without changing decimals, code identifiers or uncertainty', () => {
  expect(finalTranslation('谢谢你今天能来')).toBe('谢谢你今天能来。');
  expect(finalTranslation('“不要哭泣，”他说。“')).toBe('“不要哭泣，”他说。“');
  expect(finalTranslation('接下来,我们检查 Java.java 的 3.5 小时输出.')).toBe('接下来，我们检查 Java.java 的 3.5 小时输出。');
  expect(finalTranslation('我们将会。', true)).toBe('我们将会…');
  // A clause of a longer sentence ends with a comma; questions keep their mark.
  expect(finalTranslation('我不想让你们等到最后。', false, true)).toBe('我不想让你们等到最后，');
  expect(finalTranslation('你看到了吗？', false, true)).toBe('你看到了吗？');
  expect(() => finalTranslation('')).toThrow();
});

it('keeps later sentences after a transient failure and repairs the failed sentence once', async () => {
  vi.useFakeTimers();
  let failed = false;
  const translate = vi.fn(async c => {
    if (c.id === 'a' && !failed) { failed = true; throw new Error('temporary'); }
    return '完整译文';
  });
  const deliver = vi.fn();
  const queue = new TranslationQueue(translate, deliver, vi.fn());
  ['a', 'b', 'c'].forEach(id => queue.enqueue(caption(id)));
  await vi.runAllTimersAsync();
  expect(translate.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b', 'c', 'a']);
  expect(deliver.mock.calls.map(([c]) => c.id)).toEqual(['b', 'c', 'a']);
  expect(queue.status).toEqual({ pending: 0, failed: 0, retrying: 0, running: false });
  queue.enqueue(caption('a')); await vi.runAllTimersAsync();
  expect(deliver).toHaveBeenCalledTimes(3);
});

it('bounds automatic retries, retains failed work, and repairs without retranslating successful Chinese', async () => {
  vi.useFakeTimers();
  let unavailable = true;
  const translate = vi.fn(async c => {
    if (c.id === 'a' && unavailable) throw new Error('unavailable');
    return '完成';
  });
  const deliver = vi.fn();
  const queue = new TranslationQueue(translate, deliver, vi.fn());
  queue.enqueue(caption('a')); queue.enqueue(caption('b'));
  await vi.runAllTimersAsync();
  expect(translate.mock.calls.filter(([c]) => c.id === 'a')).toHaveLength(3);
  expect(queue.status).toMatchObject({ pending: 1, failed: 1, running: false });
  expect(deliver.mock.calls.map(([c]) => c.id)).toEqual(['b']);
  unavailable = false; queue.retryFailed(); await vi.runAllTimersAsync();
  expect(deliver.mock.calls.map(([c]) => c.id)).toEqual(['b', 'a']);
  expect(queue.status.pending).toBe(0);
});

it('times out an unresponsive provider, continues later sentences, and ignores late results', async () => {
  vi.useFakeTimers();
  let resolve!: (text: string) => void;
  const deliver = vi.fn();
  const queue = new TranslationQueue(c => c.id === 'a' ? new Promise(done => { resolve = done; }) : Promise.resolve('后续译文'),
    deliver, vi.fn(), { timeoutMs: 50, retryDelays: [] });
  queue.enqueue(caption('a')); queue.enqueue(caption('b'));
  await vi.runAllTimersAsync();
  expect(queue.status).toMatchObject({ pending: 1, failed: 1 });
  expect(deliver.mock.calls.map(([c]) => c.id)).toEqual(['b']);
  resolve('迟到译文'); await Promise.resolve();
  expect(deliver).toHaveBeenCalledOnce();
});

it('cancels a hung old session immediately and starts the next without waiting for its timeout', async () => {
  vi.useFakeTimers();
  let oldSignal!: AbortSignal;
  const deliver = vi.fn();
  const queue = new TranslationQueue((c, signal) => {
    if (c.id === 'old') { oldSignal = signal; return new Promise(() => {}); }
    return Promise.resolve('新会话');
  }, deliver, vi.fn());
  queue.enqueue(caption('old')); await vi.advanceTimersByTimeAsync(1);
  queue.reset(); expect(oldSignal.aborted).toBe(true);
  queue.enqueue({ ...caption('new'), sessionId: 'two' }); await vi.advanceTimersByTimeAsync(1);
  expect(deliver.mock.calls.map(([c]) => c.sessionId)).toEqual(['two']);
  expect(queue.status.pending).toBe(0);
});

it('destroys a timed-out Chrome instance and recreates it for the next attempt', async () => {
  vi.useFakeTimers();
  const broken = { translate: vi.fn(() => new Promise<string>(() => {})), destroy: vi.fn() };
  const working = { translate: vi.fn(async () => '恢复后的完整译文'), destroy: vi.fn() };
  const create = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(working);
  vi.stubGlobal('window', { Translator: { availability: async () => 'available', create } });
  const translator = new LocalTranslator();
  await translator.prepare(() => {});
  const result = translator.translate('Public synthetic sentence.').catch(error => error.name);
  await vi.advanceTimersByTimeAsync(8001);
  expect(await result).toBe('TimeoutError');
  expect(broken.destroy).toHaveBeenCalledOnce(); expect(translator.ready).toBe(false);
  expect(await translator.translate('Public synthetic sentence.')).toBe('恢复后的完整译文');
  expect(create).toHaveBeenCalledTimes(2);
  translator.destroy(); expect(working.destroy).toHaveBeenCalledOnce();
});

it('releases a late Chrome creation after the view was closed', async () => {
  vi.useFakeTimers();
  let resolve!: (instance: any) => void;
  const instance = { translate: vi.fn(), destroy: vi.fn() };
  vi.stubGlobal('window', { Translator: { create: () => new Promise(done => { resolve = done; }) } });
  const translator = new LocalTranslator();
  const result = translator.prepare(() => {}).catch(error => error.name);
  translator.destroy(); expect(await result).toBe('AbortError');
  resolve(instance); await vi.advanceTimersByTimeAsync(0);
  expect(instance.destroy).toHaveBeenCalledOnce(); expect(translator.ready).toBe(false);
});

it('clears creation timeout once prepared, so an established translator stays usable after three minutes', async () => {
  vi.useFakeTimers();
  let createSignal!: AbortSignal;
  vi.stubGlobal('window', { Translator: { create: async ({ signal }: any) => {
    createSignal = signal; return { translate: async () => '完成', destroy() {} };
  } } });
  const translator = new LocalTranslator(); await translator.prepare(() => {});
  await vi.advanceTimersByTimeAsync(180001);
  expect(createSignal.aborted).toBe(false);
  expect(await translator.translate('Synthetic sentence.')).toBe('完成');
  translator.destroy();
});

it('retries an unacknowledged delivery using the completed result instead of calling the model again', async () => {
  vi.useFakeTimers();
  const translate = vi.fn(async () => '已完成的译文');
  const deliver = vi.fn().mockRejectedValueOnce(new Error('view handoff')).mockResolvedValue(undefined);
  const queue = new TranslationQueue(translate, deliver, vi.fn());
  queue.enqueue(caption('a')); await vi.runAllTimersAsync();
  expect(translate).toHaveBeenCalledOnce(); expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0]![1]).toBe(deliver.mock.calls[1]![1]);
  expect(queue.status.pending).toBe(0);
});

it('sends recent sentences as context to the local model and explains a missing model', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ text: '好的。' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(serviceTranslate('Okay.', 'token', ['Earlier.'], 'offline')).resolves.toBe('好的。');
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ text: 'Okay.', context: ['Earlier.'], provider: 'offline' });
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
  await expect(serviceTranslate('Okay.', 'token', [], 'offline')).rejects.toThrow(/setup\.(ps1|sh)/);
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
  await expect(serviceTranslate('Okay.', 'token', [], 'offline')).rejects.toThrow('自动重试');
});
