import pcmSource from '../public/audio-worklet.js?raw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { draftKey } from './types';

const runtime = vi.hoisted(() => ({ listener: undefined as any, connect: undefined as any, sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  id: 'nimdaydu-test', getURL: (path: string) => path, sendMessage: runtime.sendMessage,
  onMessage: { addListener: (listener: any) => { runtime.listener = listener; } },
  onConnect: { addListener: (listener: any) => { runtime.connect = listener; } },
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
  await start(false);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: '你好，Discord。' })));
  sockets[0]!.emit({ type: 'caption', sessionId: 'session-1', id: 'sentence:1', revision: 1,
    final: true, text: 'Hello Discord.', start: 0, end: 1,
    preview: { revision: 1, text: '', start: 0, end: 0 } });
  await vi.advanceTimersByTimeAsync(1);
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
  sockets[0]!.bufferedAmount = sockets[0]!.sent[0].sampleRate * 4 * seconds;
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

const settled = (id: string, text: string, start: number) => ({ type: 'caption', sessionId: 'session-1', id, revision: 1,
  final: true, text, start, end: start + 1, preview: { revision: 1, text: '', start: 0, end: 0 } });

it('translates with the local service here, so Chinese continues while the side panel is hidden', async () => {
  vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
    if (String(url).endsWith('/translate')) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ text: body.text === 'First line.' ? '第一句' : '第二句' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  await command('start', { source: { tabId: 1, windowId: 1, title: 'Meeting' }, streamId: 'stream', token: 'test-token',
    viewId: 'view', canTranslate: true, sentenceHold: .4, autoSave: false, translationMode: 'offline' });
  sockets[0]!.emit(settled('sentence:1', 'First line.', 0));
  sockets[0]!.emit(settled('sentence:2', 'Second line.', 1));
  await vi.advanceTimersByTimeAsync(10);
  const requests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/translate'))
    .map(([, init]) => JSON.parse(init!.body as string));
  expect(requests).toEqual([{ text: 'First line.' },
    { text: 'Second line.' }]);
  const snapshot = await command('snapshot');
  expect(snapshot.captions.map((c: any) => c.translation)).toEqual(['第一句。', '第二句。']);
  expect(snapshot.serviceTranslation).toBe(true);
  // A view cannot overwrite what the capture page translated.
  expect(runtime.sendMessage.mock.calls.some(([message]) => message.type === 'translation' && message.text === '第二句。')).toBe(true);
});

it('feeds floating captions through a port and keeps capturing while only they are open', async () => {
  await start();
  const sent: any[] = [];
  let disconnect = () => {};
  runtime.connect({ name: 'nimdaydu-overlay', sender: { id: 'nimdaydu-test' }, postMessage: (message: any) => sent.push(message),
    onDisconnect: { addListener: (listener: () => void) => { disconnect = listener; } } });
  expect(sent[0]).toMatchObject({ type: 'snapshot', state: { phase: 'capturing' } });
  sockets[0]!.emit(settled('sentence:1', 'Hello there.', 0));
  expect(sent.at(-1)).toMatchObject({ type: 'caption', caption: { text: 'Hello there.' } });
  // No side panel leases: the connected overlay alone keeps the session.
  await vi.advanceTimersByTimeAsync(16000);
  expect((await command('snapshot')).state.phase).toBe('capturing');
  disconnect();
  // Lease expiry, then the stop handshake's own timeout with this fake peer.
  await vi.advanceTimersByTimeAsync(20000);
  expect((await command('snapshot')).state).toMatchObject({ phase: 'stopped', message: expect.stringContaining('自动停止') });
});

it('translates finished live rows early and reuses them when the caption settles', async () => {
  const requests: any[] = [];
  vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
    if (String(url).endsWith('/translate')) {
      const body = JSON.parse(init.body); requests.push(body);
      return new Response(JSON.stringify({ text: body.text.startsWith('Check') ? '检查可用性。' : '其他' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  await command('start', { source: { tabId: 1, windowId: 1, title: 'Meeting' }, streamId: 'stream', token: 'test-token',
    viewId: 'view', canTranslate: false, sentenceHold: .4, autoSave: false, translationMode: 'offline' });
  sockets[0]!.emit({ type: 'preview', sessionId: 'session-1', revision: 1, text: 'Check availability. Then we',
    units: ['Check availability.', 'Then we'], start: 0, end: 2 });
  await vi.advanceTimersByTimeAsync(10);
  // Only the finished row is drafted; the row still being spoken is not.
  expect(requests).toEqual([{ text: 'Check availability.', draft: true }]);
  sockets[0]!.emit({ type: 'preview', sessionId: 'session-1', revision: 2, text: 'Check availability. Then we pay.',
    units: ['Check availability.', 'Then we pay.'], start: 0, end: 3 });
  await vi.advanceTimersByTimeAsync(10);
  // A period on the still-changing last row must survive another acoustic update.
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1100);
  expect(requests.map(request => request.text)).toEqual(['Check availability.', 'Then we pay.']);
  expect(runtime.sendMessage.mock.calls.some(([message]) => message.type === 'draft' && message.text === '检查可用性。')).toBe(true);
  expect((await command('snapshot')).drafts).toEqual({ [draftKey('Check availability.')]: '检查可用性。', [draftKey('Then we pay.')]: '其他。' });
  // Dropping the final period doesn't need another model call.
  sockets[0]!.emit(settled('sentence:1', 'Check availability', 0));
  await vi.advanceTimersByTimeAsync(10);
  expect(requests).toHaveLength(2);
  expect((await command('snapshot')).captions[0].translation).toBe('检查可用性。');
});

it('translates the final programming language even when a similar name was drafted', async () => {
  const requested: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/translate')) return new Response('{}');
    const { text } = JSON.parse(String(init?.body));
    requested.push(text);
    return Response.json({ text: text.replace('We use', '我们用') });
  });
  await command('start', { source: { tabId: 1, windowId: 1, title: 'Meeting' }, streamId: 'stream', token: 'test-token',
    sentenceHold: .4, autoSave: false, translationMode: 'offline' });
  sockets[0]!.emit({ type: 'preview', sessionId: 'session-1', revision: 1, text: 'We use C++.', start: 0, end: 2, speechEnded: true });
  await vi.advanceTimersByTimeAsync(10);
  sockets[0]!.emit(settled('sentence:1', 'We use C#.', 0));
  sockets[0]!.emit(settled('sentence:2', 'We use C.', 2));
  await vi.advanceTimersByTimeAsync(10);
  expect(requested).toEqual(['We use C++.', 'We use C#.', 'We use C.']);
  expect((await command('snapshot')).captions.map((c: { translation: string }) => c.translation))
    .toEqual(['我们用 C#。', '我们用 C。']);
});

it('waits for a stable clause, then translates an unpunctuated ending before refinement', async () => {
  const requested: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/translate')) return new Response('{}');
    requested.push(JSON.parse(String(init?.body)).text);
    return Response.json({ text: '会议字幕', modelMs: 15, queueMs: 3 });
  });
  await command('start', { source: { tabId: 1, windowId: 1, title: 'Meeting' }, streamId: 'stream',
    token: 'test-token', autoSave: false, sentenceHold: .4, translationMode: 'offline' });
  worklets[0].port.onmessage({ data: { samples: new Float32Array(3840).buffer, offset: 0 } });
  const clause = 'We changed the price of the remote today,';
  const preview = (revision: number, tail: string, speechEnded = false) => sockets[0]!.emit({
    type: 'preview', sessionId: 'session-1', revision, start: 0, end: revision,
    text: clause + ' ' + tail, units: [clause, tail], speechEnded,
  });
  preview(1, 'because the');
  await vi.advanceTimersByTimeAsync(10);
  expect(requested).toEqual([]);
  preview(2, 'because the batteries');
  await vi.advanceTimersByTimeAsync(10);
  expect(requested).toEqual([clause]);
  preview(3, 'because the batteries cost more', true);
  await vi.advanceTimersByTimeAsync(10);
  expect(requested).toEqual([clause, 'because the batteries cost more']);
  sockets[0]!.emit(settled('sentence:1', 'because the batteries cost more.', 0));
  await vi.advanceTimersByTimeAsync(10);
  const timing = (await command('diagnostics')).events.find((event: { code: string }) => event.code === 'caption_timing');
  expect(timing).toMatchObject({ sentence: 1, modelMs: 0, firstChineseMs: expect.any(Number), finalChineseMs: expect.any(Number) });
  expect(requested).toHaveLength(2);
});

it('does not translate when translation is disabled', async () => {
  await command('start', { source: { tabId: 1, windowId: 1, title: 'Meeting' }, streamId: 'stream', token: 'test-token',
    viewId: 'view', canTranslate: false, sentenceHold: .4, autoSave: false, translationMode: 'off' });
  sockets[0]!.emit({ type: 'preview', sessionId: 'session-1', revision: 1, text: 'Check availability. Then we',
    units: ['Check availability.', 'Then we'], start: 0, end: 2 });
  await vi.advanceTimersByTimeAsync(10);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/translate'))).toHaveLength(0);
});


it('resamples device audio without clock drift or folding ultrasonic tones into speech', () => {
  function capture(rate: number, frequency: number) {
    const frames: Array<{ samples: ArrayBuffer; offset: number }> = [];
    class Processor { port = { postMessage: (packet: typeof frames[number]) => frames.push(packet) }; }
    type Worklet = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
    let node: Worklet;
    Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', pcmSource)(Processor, rate,
      (_name: string, WorkletClass: new () => Worklet) => { node = new WorkletClass(); });
    for (let i = 0; i < rate * .4; i += 128) {
      const size = Math.min(128, rate * .4 - i);
      const signal = Float32Array.from({ length: size }, (_, j) => Math.sin(2 * Math.PI * frequency * (i + j) / rate));
      node!.process([[signal]], [[new Float32Array(size)]]);
    }
    expect(frames.map(f => f.offset)).toEqual([0, 1280, 2560, 3840, 5120]);
    const pcm = new Float32Array(frames[1]!.samples);
    return Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
  }
  for (const rate of [44100, 48000, 96000]) {
    expect(capture(rate, 1000)).toBeGreaterThan(.68);
    expect(capture(rate, 14000)).toBeLessThan(.015);
  }
});

it('keeps only the shared audio and rejects a source with no audio before starting recognition', async () => {
  const video = { stop: vi.fn() };
  let audioTracks: typeof track[] = [];
  const shared = { getVideoTracks: () => [video], getAudioTracks: () => audioTracks,
    getTracks: () => audioTracks, removeTrack: vi.fn() };
  const getDisplayMedia = vi.fn().mockResolvedValue(shared);
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
  const fields = { desktop: true, source: { tabId: -1, windowId: -1, title: 'Desktop' }, token: 'test-token', autoSave: false };
  expect((await command('start', fields)).error).toContain('没有共享声音');
  expect(sockets).toHaveLength(0);
  expect(video.stop).toHaveBeenCalledOnce();
  audioTracks = [track];
  expect(await command('start', fields)).toMatchObject({ ok: true });
  expect(shared.removeTrack).toHaveBeenCalledWith(video);
  expect(sockets[0]?.sent.find(packet => packet.type === 'hello')?.sampleRate).toBe(16000);
});

it('shares the silence countdown across views and cancels it on speech or a request to keep listening', async () => {
  await start(false);
  runtime.connect({ name: 'nimdaydu-overlay', sender: { id: 'nimdaydu-test' }, postMessage() {},
    onDisconnect: { addListener() {} } });
  await vi.advanceTimersByTimeAsync(660_000);
  expect((await command('snapshot')).state.phase).toBe('capturing');
  await command('settings', { idleReminder: true });
  await vi.advanceTimersByTimeAsync(600_000);
  expect((await command('snapshot')).state.idleStopAt).toBe(Date.now() + 60_000);
  await command('continueListening');
  expect((await command('snapshot')).state.idleStopAt).toBeUndefined();
  await vi.advanceTimersByTimeAsync(600_000);
  sockets[0]!.emit({ type: 'preview', sessionId: 'session-1', revision: 1, text: 'Hello again', start: 0, end: 1 });
  expect((await command('snapshot')).state.idleStopAt).toBeUndefined();
  await vi.advanceTimersByTimeAsync(666_000);
  expect((await command('snapshot')).state.phase).toBe('stopped');
});
