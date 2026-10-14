import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ listener: undefined as any, sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  id: 'nimdaydu-test', getURL: (path: string) => path, sendMessage: runtime.sendMessage,
  onMessage: { addListener: (listener: any) => { runtime.listener = listener; } },
} } }));

const sockets: FakeSocket[] = [];
const worklets: any[] = [];
let track: { stop: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
class FakeSocket {
  static OPEN = 1;
  static SAVING_SUPPORTED = true;
  readyState = 0;
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  closeListeners: (() => void)[] = [];
  sent: any[] = [];
  constructor() {
    sockets.push(this);
    Promise.resolve().then(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(data: string | ArrayBuffer) {
    if (data instanceof ArrayBuffer) { this.sent.push(data); return; }
    const message = JSON.parse(data); this.sent.push(message);
    if (message.type === 'hello') Promise.resolve().then(() => this.emit({
      type: 'ready', sessionId: `session-${sockets.length}`, model: 'small', autoSaveSupported: FakeSocket.SAVING_SUPPORTED,
    }));
    // A peer reporting a fatal error will not respond to another stop request.
  }
  emit(message: any) { this.onmessage?.({ data: JSON.stringify(message) }); }
  addEventListener(_type: string, listener: () => void) { this.closeListeners.push(listener); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); this.closeListeners.forEach(listener => listener()); }
}

beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); sockets.length = 0; worklets.length = 0;
  FakeSocket.SAVING_SUPPORTED = true;
  runtime.sendMessage.mockReset().mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  track = { stop: vi.fn(), addEventListener: vi.fn() };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({
    getAudioTracks: () => [track], getTracks: () => [track],
  }) } });
  vi.stubGlobal('AudioContext', class {
    state = 'running'; sampleRate = 48000; destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {};
    createMediaStreamSource() { return { connect() {} }; }
    async close() { this.state = 'closed'; }
  });
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: null };
    constructor() { worklets.push(this); }
    connect() {}; disconnect() {}
  });
  vi.stubGlobal('WebSocket', FakeSocket);
  await import('../entrypoints/offscreen/main');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function command(type: string, fields = {}): Promise<any> {
  return new Promise(resolve => runtime.listener({ target: 'offscreen', type, ...fields }, { id: 'nimdaydu-test' }, resolve));
}
const start = (autoSave?: boolean) => command('start', { source: { tabId: 1, windowId: 1, title: 'Speech sample' },
  streamId: 'stream', token: 'test-token', viewId: 'view', canTranslate: true, sentenceHold: .8, autoSave });

it('honors an explicitly disabled saving setting received from the background', async () => {
  await start(false);
  expect(sockets[0]!.sent[0]).toMatchObject({ autoSave: false });
  expect((await command('snapshot')).state.phase).toBe('capturing');
});

it('starts with saving enabled and syncs a user opt-out without stopping audio', async () => {
  await start();
  expect(sockets[0]!.sent[0]).toMatchObject({ autoSave: true, source: { title: 'Speech sample' } });
  await command('settings', { autoSave: false });
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('/outputs/session-1/settings');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ enabled: false });
  expect((await command('snapshot')).state.phase).toBe('capturing');
  expect(track.stop).not.toHaveBeenCalled();
});

it('warns instead of silently promising files when an old local service is still running', async () => {
  FakeSocket.SAVING_SUPPORTED = false;
  await start();
  expect((await command('snapshot')).state).toMatchObject({ phase: 'capturing', saveError: expect.stringContaining('重启本机服务') });
  expect(track.stop).not.toHaveBeenCalled();
});

it('keeps capture running while a backlog starts and clears', async () => {
  await start();
  sockets[0]!.emit({ type: 'backpressure', sessionId: 'session-1', recovering: true });
  expect((await command('snapshot')).state).toMatchObject({ phase: 'capturing', recovering: true });
  sockets[0]!.emit({ type: 'backpressure', sessionId: 'session-1', recovering: false });
  expect((await command('snapshot')).state).toMatchObject({ phase: 'capturing', recovering: false });
  expect(track.stop).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(1);
});

it('cleans up a fatal peer error immediately and preserves settled bilingual captions', async () => {
  await start();
  sockets[0]!.emit({ type: 'caption', sessionId: 'session-1', id: 'sentence:1', revision: 1,
    final: true, text: 'Hello Discord.', start: 0, end: 1,
    preview: { revision: 1, text: '', start: 0, end: 0 } });
  await command('translation', { viewId: 'view', sessionId: 'session-1', id: 'sentence:1', revision: 1, text: '你好，Discord。' });
  const before = Date.now();
  sockets[0]!.emit({ type: 'error', code: 'asr_overload', message: '语音识别持续积压。' });
  for (let index = 0; index < 10; index++) await Promise.resolve();
  const snapshot = await command('snapshot');
  expect(snapshot.state).toMatchObject({ phase: 'error', recovering: false, message: '语音识别持续积压。' });
  expect(Date.now()).toBe(before);
  expect(snapshot.captions[0]).toMatchObject({ text: 'Hello Discord.', translation: '你好，Discord。' });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(sockets[0]!.sent.map(message => message.type)).toEqual(['hello']);
  await start();
  expect((await command('snapshot')).state).toMatchObject({ phase: 'capturing', sessionId: 'session-2' });
});

it.each([3, 9])('allows a transient send burst but bounds a persistent transport backlog (%s seconds)', async seconds => {
  await start();
  sockets[0]!.bufferedAmount = 48000 * 4 * seconds;
  worklets[0].port.onmessage({ data: { samples: new Float32Array(3840).buffer, offset: 0 } });
  for (let index = 0; index < 10; index++) await Promise.resolve();
  const snapshot = await command('snapshot');
  if (seconds === 3) {
    expect(snapshot.state.phase).toBe('capturing');
    expect(track.stop).not.toHaveBeenCalled();
    expect(sockets[0]!.sent[1]).toBeInstanceOf(ArrayBuffer);
    expect(new DataView(sockets[0]!.sent[1]).getUint32(0, true)).toBe(0);
  } else {
    expect(snapshot.state.phase).toBe('error');
    expect(track.stop).toHaveBeenCalledOnce();
  }
});
