import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ listener: undefined as any, storageListener: undefined as any, settings: {} as any,
  send: vi.fn(), create: vi.fn(), capture: vi.fn(), exists: false }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'nimdaydu-test', sendMessage: (...args: any[]) => mock.send(...args),
    onMessage: { addListener: (listener: any) => { mock.listener = listener; } } },
  storage: { session: { get: async () => ({ source: { tabId: 1, title: 'Playing video', windowId: 1 } }) },
    local: { get: async () => ({ settings: mock.settings }) }, onChanged: { addListener: (listener: any) => { mock.storageListener = listener; } } },
  offscreen: { hasDocument: async () => mock.exists, createDocument: (...args: any[]) => mock.create(...args) },
  tabs: { get: async () => ({ id: 1, url: 'https://www.youtube.com/watch?v=sample', title: 'Playing video' }), onRemoved: { addListener() {} } },
  tabCapture: { getMediaStreamId: (...args: any[]) => mock.capture(...args) },
  action: { onClicked: { addListener() {} } }, sidePanel: { open: async () => {} },
} }));

beforeEach(async () => {
  vi.resetModules(); mock.send.mockReset(); mock.create.mockReset(); mock.capture.mockReset(); mock.exists = false; mock.settings = {};
  mock.create.mockResolvedValue(undefined); mock.capture.mockResolvedValue('stream-id');
  vi.stubGlobal('defineBackground', (setup: () => void) => setup());
  await import('../entrypoints/background');
  vi.unstubAllGlobals();
});

function command(type: string) {
  return new Promise<any>(resolve => mock.listener({ target: 'background', type, token: 'test-token', viewId: 'view', canTranslate: true }, { id: 'nimdaydu-test' }, resolve));
}

it('waits for an initialized offscreen listener instead of reading state from an undefined response', async () => {
  let attempts = 0;
  mock.send.mockImplementation(async (message: any) => {
    if (message.type === 'snapshot') return ++attempts === 1 ? undefined : { state: { phase: 'idle' }, captions: [] };
    return { ok: true };
  });
  const result = await command('start');
  expect(result).toEqual({ ok: true });
  expect(mock.capture).toHaveBeenCalledOnce();
});

it('reports an unresponsive document without capturing audio or dereferencing missing state', async () => {
  vi.useFakeTimers();
  try {
    mock.send.mockImplementation(() => new Promise(() => {}));
    const pending = command('start');
    await vi.advanceTimersByTimeAsync(3100);
    expect(await pending).toEqual({ error: expect.stringContaining('采音页面未能就绪') });
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.create).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('keeps an existing active session and never starts another audio capture', async () => {
  mock.exists = true;
  mock.send.mockResolvedValue({ state: { phase: 'capturing' }, captions: [] });
  expect(await command('start')).toEqual({ error: '已有字幕会话，请先停止。' });
  expect(mock.create).not.toHaveBeenCalled(); expect(mock.capture).not.toHaveBeenCalled();
});

it('passes the saved opt-out and forwards settings changes through runtime messages', async () => {
  mock.settings = { schema: 2, autoSave: false };
  mock.send.mockImplementation(async (message: any) => message.type === 'snapshot'
    ? { state: { phase: 'idle' }, captions: [] } : { ok: true });
  expect(await command('start')).toEqual({ ok: true });
  expect(mock.send.mock.calls.find(([message]) => message.type === 'start')![0]).toMatchObject({ autoSave: false });
  mock.storageListener({ settings: { oldValue: mock.settings, newValue: { schema: 2, autoSave: true } } }, 'local');
  expect(mock.send).toHaveBeenLastCalledWith({ target: 'offscreen', type: 'settings', autoSave: true });
});

it('serializes concurrent starts so only one tab audio stream is requested', async () => {
  mock.send.mockImplementation(async (message: any) => message.type === 'snapshot'
    ? { state: { phase: 'idle' }, captions: [] } : { ok: true });
  const results = await Promise.all([command('start'), command('start')]);
  expect(results).toEqual([{ ok: true }, { error: '字幕正在启动，请稍候。' }]);
  expect(mock.capture).toHaveBeenCalledOnce();
});
