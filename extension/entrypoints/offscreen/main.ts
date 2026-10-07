import { browser } from 'wxt/browser';
import { applyTranslation, isActive, mergeCaption, SOCKET, type Caption, type CaptureState, type Source } from '../../lib/types';

let state: CaptureState = { phase: 'idle' };
let captions: Caption[] = [];
let media: MediaStream | undefined;
let context: AudioContext | undefined;
let worklet: AudioWorkletNode | undefined;
let socket: WebSocket | undefined;
let lastLease = Date.now();
let lastMeter = 0;
let sequence = 0;
let stopping: Promise<void> | undefined;
let translationOwner: string | undefined;
const viewLeases = new Map<string, number>();

function publish(message: Record<string, unknown>) {
  void browser.runtime.sendMessage({ target: 'ui', ...message }).catch(() => {});
}
function setState(update: Partial<CaptureState>) {
  state = { ...state, ...update };
  publish({ type: 'state', state });
  void browser.runtime.sendMessage({ target: 'background', type: 'badge', phase: state.phase }).catch(() => {});
}

async function cleanup() {
  if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); }
  worklet = undefined;
  media?.getTracks().forEach(track => track.stop());
  media = undefined;
  if (context && context.state !== 'closed') await context.close();
  context = undefined;
  socket?.close();
  socket = undefined;
  publish({ type: 'level', level: 0 });
}

async function stop(message?: string, failed = false) {
  if (stopping) return stopping;
  stopping = (async () => {
    setState({ phase: 'stopping' });
    if (socket?.readyState === WebSocket.OPEN) {
      const currentSocket = socket;
      const closed = new Promise<void>(resolve => {
        currentSocket.addEventListener('close', () => resolve(), { once: true });
        setTimeout(resolve, 5000);
      });
      currentSocket.send(JSON.stringify({ type: 'stop' }));
      await closed;
    }
    await cleanup();
    setState({ phase: failed ? 'error' : 'stopped', message });
  })().finally(() => { stopping = undefined; });
  return stopping;
}

async function start(source: Source, streamId: string, token: string, viewId: string, canTranslate: boolean, sentenceHold: number) {
  if (isActive(state.phase)) throw new Error('已有会话运行中。');
  await cleanup();
  captions = [];
  sequence = 0;
  lastLease = Date.now();
  viewLeases.set(viewId, lastLease);
  translationOwner = canTranslate ? viewId : undefined;
  state = { phase: 'starting', source, startedAt: Date.now() };
  setState({});
  try {
    const constraints = { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false };
    media = await navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
    media.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (isActive(state.phase) && state.phase !== 'stopping') void stop('声音来源已关闭。');
    });
    context = new AudioContext({ latencyHint: 'interactive' });
    await context.resume();
    const input = context.createMediaStreamSource(media);
    input.connect(context.destination);
    await context.audioWorklet.addModule(browser.runtime.getURL('/audio-worklet.js'));
    worklet = new AudioWorkletNode(context, 'nimdaydu-pcm');
    input.connect(worklet);
    worklet.connect(context.destination);
    const rate = context.sampleRate;
    socket = new WebSocket(SOCKET);
    const currentSocket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('本机服务连接超时，请运行 start.ps1。')), 8000);
      currentSocket.onopen = () => currentSocket.send(JSON.stringify({ type: 'hello', protocol: 1, token, sampleRate: rate, format: 'f32le', channels: 1, sentenceHold }));
      currentSocket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          clearTimeout(timeout);
          setState({ phase: 'capturing', sessionId: message.sessionId, model: message.model });
          resolve();
        } else if (message.type === 'caption' && message.sessionId === state.sessionId) {
          if (!message.final) return;
          captions = mergeCaption(captions, message as Caption);
          publish({ type: 'caption', caption: message });
        } else if (message.type === 'pending' && message.sessionId === state.sessionId && message.pending !== state.pending) {
          setState({ pending: message.pending });
        } else if (message.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(message.message));
          if (state.phase !== 'starting' && state.phase !== 'stopping') void stop(message.message, true);
        }
      };
      currentSocket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('无法连接本机语音服务。请先运行 start.ps1。'));
      };
      currentSocket.onclose = event => {
        clearTimeout(timeout);
        if (state.phase === 'starting') reject(new Error(event.code === 1008 ? '配对码不正确，请重新复制。' : '本机服务拒绝连接。'));
        else if (state.phase !== 'stopping' && isActive(state.phase)) {
          void cleanup().then(() => setState({ phase: 'error', message: '本机连接已断开。字幕已保留，点开始可重新采集。' }));
        }
      };
    });
    worklet.port.onmessage = ({ data }: MessageEvent<{ samples: ArrayBuffer; offset: number }>) => {
      const samples = new Float32Array(data.samples);
      if (Date.now() - lastMeter > 140) {
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        publish({ type: 'level', level: Math.min(1, Math.sqrt(sum / samples.length) * 5) });
        lastMeter = Date.now();
      }
      if (state.phase !== 'capturing' || currentSocket.readyState !== WebSocket.OPEN) return;
      if (currentSocket.bufferedAmount > rate * 4 * 2) {
        void stop('音频发送积压，请检查本机服务后重新开始。', true);
        return;
      }
      const packet = new ArrayBuffer(12 + samples.byteLength);
      const header = new DataView(packet);
      header.setUint32(0, sequence++, true);
      header.setBigUint64(4, BigInt(data.offset), true);
      new Float32Array(packet, 12).set(samples);
      currentSocket.send(packet);
    };
    return { ok: true };
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : String(error);
    setState({ phase: 'error', message });
    throw error;
  }
}

browser.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'offscreen' || sender.id !== browser.runtime.id) return;
  (async () => {
    if (message.type === 'snapshot') return { state, captions };
    if (message.type === 'lease') {
      lastLease = Date.now();
      viewLeases.set(message.viewId, lastLease);
      for (const [id, timestamp] of viewLeases) if (lastLease - timestamp > 10000) viewLeases.delete(id);
      if (translationOwner && !viewLeases.has(translationOwner)) translationOwner = undefined;
      if (message.canTranslate && !translationOwner) translationOwner = message.viewId;
      if (!message.canTranslate && translationOwner === message.viewId) translationOwner = undefined;
      return { owner: translationOwner === message.viewId };
    }
    if (message.type === 'start') return start(message.source, message.streamId, message.token, message.viewId, message.canTranslate, message.sentenceHold || 0.8);
    if (message.type === 'pause' && state.phase === 'capturing') {
      setState({ phase: 'paused' });
      socket?.send(JSON.stringify({ type: 'pause' }));
    } else if (message.type === 'resume' && state.phase === 'paused') {
      socket?.send(JSON.stringify({ type: 'resume' }));
      setState({ phase: 'capturing' });
    } else if (message.type === 'stop') await stop();
    else if (message.type === 'sourceClosed' && message.tabId === state.source?.tabId && isActive(state.phase)) await stop('来源标签页已关闭。');
    else if (message.type === 'translation') {
      if (message.viewId !== translationOwner) return { ok: false };
      captions = applyTranslation(captions, message);
      publish({ ...message, target: 'ui' });
    } else if (message.type === 'clear' && !isActive(state.phase)) {
      captions = [];
      publish({ type: 'cleared' });
    }
    return { ok: true };
  })().then(respond).catch(error => respond({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

setInterval(() => {
  if (isActive(state.phase) && state.phase !== 'stopping' && Date.now() - lastLease > 10000) void stop('侧栏已关闭，采集自动停止。');
}, 2000);
