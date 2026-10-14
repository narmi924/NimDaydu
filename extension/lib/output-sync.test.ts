import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OutputSync } from './output-sync';
import type { Caption } from './types';
const caption: Caption = { id: 'sentence:1', sessionId: 'one', revision: 1, final: true,
  text: 'Complete English.', translation: '完整中文。', translationRevision: 1, start: 0, end: 1 };
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('saves completed Chinese once per queued ID and keeps session IDs separate', async () => {
  const status = vi.fn(); const sync = new OutputSync(status);
  sync.begin('one', 'test-token', true); sync.enqueue(caption); sync.enqueue(caption);
  sync.begin('two', 'test-token', true); sync.enqueue({ ...caption, sessionId: 'two' });
  await vi.advanceTimersByTimeAsync(260);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]![0]).toContain('/one/translations'); expect(calls[1]![0]).toContain('/two/translations');
  expect(JSON.parse(calls[0]![1]!.body as string).updates).toHaveLength(1);
});

it('retries a failed save independently without changing the Chinese shown in the reader', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('disk unavailable'));
  const status = vi.fn(); const sync = new OutputSync(status);
  sync.begin('one', 'test-token', true); sync.enqueue(caption);
  await vi.advanceTimersByTimeAsync(260); expect(status).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetch).toHaveBeenCalledTimes(2); expect(status).toHaveBeenLastCalledWith(false);
});

it('does not retry forever when a restarted service no longer knows the old session', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
  const status = vi.fn(); const sync = new OutputSync(status);
  sync.begin('one', 'test-token', true); sync.enqueue(caption);
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(1); expect(status).toHaveBeenLastCalledWith(true);
});

it('never queues drafts, saving opt-outs, or stale translations and applies the latest switch', async () => {
  const sync = new OutputSync(vi.fn()); sync.begin('one', 'test-token', false);
  sync.enqueue(caption); await vi.advanceTimersByTimeAsync(300); expect(fetch).not.toHaveBeenCalled();
  sync.configure(true); sync.enqueue({ ...caption, final: false });
  sync.enqueue({ ...caption, translationRevision: 0 });
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ enabled: true });
  sync.enqueue(caption); sync.configure(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/settings'))).toBe(true);
});
