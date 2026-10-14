import { expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ listener: undefined as any }));
// Chrome offscreen documents expose chrome.runtime, not chrome.storage.
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  id: 'nimdaydu-test', sendMessage: async () => ({}),
  onMessage: { addListener: (listener: any) => { runtime.listener = listener; } },
} } }));

it('boots with the actual offscreen API surface and answers the startup snapshot', async () => {
  vi.stubGlobal('setInterval', vi.fn());
  try {
    await import('../entrypoints/offscreen/main');
    const snapshot = await new Promise<any>(resolve => runtime.listener(
      { target: 'offscreen', type: 'snapshot' }, { id: 'nimdaydu-test' }, resolve));
    expect(snapshot.state.phase).toBe('idle');
    expect(snapshot.captions).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
