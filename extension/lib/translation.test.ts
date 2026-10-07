import { afterEach, expect, it, vi } from 'vitest';
import { TranslationQueue, finalTranslation } from './translation';
import type { Caption } from './types';
afterEach(() => vi.useRealTimers());
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
  expect(finalTranslation('接下来,我们检查 Java.java 的 3.5 小时输出.')).toBe('接下来，我们检查 Java.java 的 3.5 小时输出。');
  expect(finalTranslation('我们将会。', true)).toBe('我们将会…');
  expect(() => finalTranslation('')).toThrow();
});
