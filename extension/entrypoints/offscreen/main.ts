import { browser } from 'wxt/browser';
import { diagnosticSnapshot, recordDiagnostic } from '../../lib/diagnostics';
import { applyTranslation, DEFAULT_SETTINGS, draftKey, isActive, mergeCaption, mergePreview, SOCKET, type Caption, type CaptureState, type DraftTranslations, type EnglishPreview, type Source, type TranslationMode } from '../../lib/types';
import { previewUnits } from '../../lib/reader';
import { OutputSync } from '../../lib/output-sync';
import { finalTranslation, serviceTranslate, TranslationQueue, type TranslationStatus } from '../../lib/translation';
import { START_SCRIPT } from '../../lib/platform';
import { OVERLAY_HISTORY } from '../../lib/overlay';

let state: CaptureState = { phase: 'idle' };
let captions: Caption[] = [];
let preview: EnglishPreview | undefined;
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
// Match the service's finite recovery window rather than aborting a brief burst.
const TRANSPORT_BACKLOG_SECONDS = 8;
let fileSaveFailed = false;
let translationSaveFailed = false;
let savingUnsupported = false;
function savingStatus() {
  const saveError = savingUnsupported ? '请重启本机服务以启用自动保存；当前字幕请手动导出。'
    : fileSaveFailed || translationSaveFailed ? '自动保存暂未完成。请保持本机服务运行；必要时手动导出字幕。' : undefined;
  if (saveError !== state.saveError) {
    recordDiagnostic('capture', saveError ? 'output_failed' : 'output_recovered');
    setState({ saveError });
  }
}
const outputs = new OutputSync(failed => { translationSaveFailed = failed; savingStatus(); });
// Only chrome.runtime is available in an offscreen document. Settings are
// read/watched by the service worker and delivered through runtime messages.

// The local model and DeepSeek are translated here, so captions keep their
// Chinese while the side panel is hidden (fullscreen) or closed. Chrome's own
// translator only exists in a visible page; that mode stays with the side panel.
let translationMode: TranslationMode | undefined;
let serviceToken = '';
let translationStatus: TranslationStatus = { pending: 0, failed: 0, retrying: 0, running: false };
const servesTranslation = () => translationMode === 'offline' || translationMode === 'deepseek';
const serviceQueue = new TranslationQueue(
  (caption, signal) => {
    // A live draft of the same words was already translated: no second model call.
    const drafted = draftModel.get(draftKey(caption.text));
    if (drafted !== undefined) return Promise.resolve(drafted);
    return serviceTranslate(caption.text, serviceToken,
      captions.filter(c => c.final && c.start < caption.start).slice(-2).map(c => c.text), translationMode as 'offline' | 'deepseek', signal);
  },
  (caption, text) => acceptTranslation({ sessionId: caption.sessionId, id: caption.id, revision: caption.revision, text }),
  () => {}, { onChange: status => {
    translationStatus = status; publish({ type: 'translationStatus', status });
    if (!status.pending && !status.running) void pumpDrafts();
  } });

// Live English rows that are already complete (every row but the one still
// being spoken, unless it already ends a sentence) are translated while the
// local model is idle. Chinese then
// appears as the sentence ends instead of after the second pass, and the
// settled caption reuses it when the words agree. Paid DeepSeek is not used.
const draftModel = new Map<string, string>();
let drafts: DraftTranslations = {};
let drafting = false;
async function pumpDrafts() {
  if (drafting || translationMode !== 'offline' || state.phase !== 'capturing') return;
  if (translationStatus.pending || translationStatus.running) return;
  // The last row is usually still being spoken; once the recognizer closes it
  // with sentence punctuation it is very likely finished too.
  const units = previewUnits(preview);
  const ready = /[.!?]["”’]*$/.test(units.at(-1) ?? '') ? units : units.slice(0, -1);
  const unit = ready.find(text => !draftModel.has(draftKey(text)));
  if (!unit) return;
  drafting = true;
  const session = state.sessionId;
  let done = false;
  try {
    const text = await serviceTranslate(unit, serviceToken, [], 'offline', AbortSignal.timeout(8000), true);
    if (session !== state.sessionId) return;
    const key = draftKey(unit);
    draftModel.set(key, text);
    drafts = { ...drafts, [key]: finalTranslation(text, false, !/[.!?]["”’]*$/.test(unit)) };
    if (draftModel.size > 300) {
      const oldest = draftModel.keys().next().value!;
      draftModel.delete(oldest);
      const { [oldest]: _removed, ...rest } = drafts;
      drafts = rest;
    }
    publish({ type: 'draft', sessionId: session, key, text: drafts[key] });
    done = true;
  } catch { /* Busy or failed: the settled caption is translated normally. */ }
  finally {
    drafting = false;
    if (done) void pumpDrafts();
  }
}
function resetDrafts() { draftModel.clear(); drafts = {}; }

// Floating captions on the source page connect here and count as an open view.
const overlays = new Set<ReturnType<typeof browser.runtime.connect>>();
const OVERLAY_TYPES = new Set(['state', 'caption', 'preview', 'translation', 'draft', 'cleared']);

function publish(message: Record<string, unknown>) {
  void browser.runtime.sendMessage({ target: 'ui', ...message }).catch(() => {});
  if (!OVERLAY_TYPES.has(message.type as string)) return;
  for (const port of overlays) { try { port.postMessage(message); } catch { overlays.delete(port); } }
}

function acceptTranslation(message: { sessionId: string; id: string; revision: number; text: string }) {
  captions = applyTranslation(captions, message);
  const translated = captions.find(caption => caption.sessionId === message.sessionId && caption.id === message.id);
  if (translated) outputs.enqueue(translated);
  publish({ type: 'translation', ...message });
}

function setTranslationMode(mode: TranslationMode | undefined) {
  if (mode === translationMode) return;
  serviceQueue.reset();
  resetDrafts();
  translationMode = mode;
  translationOwner = undefined;
  if (servesTranslation()) captions.forEach(caption => serviceQueue.enqueue(caption));
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
    if (!failed && socket?.readyState === WebSocket.OPEN) {
      const currentSocket = socket;
      const closed = new Promise<void>(resolve => {
        currentSocket.addEventListener('close', () => resolve(), { once: true });
        setTimeout(resolve, 5000);
      });
      currentSocket.send(JSON.stringify({ type: 'stop' }));
      await closed;
    }
    await cleanup();
    setState({ phase: failed ? 'error' : 'stopped', message, recovering: false });
  })().finally(() => { stopping = undefined; });
  return stopping;
}

async function start(source: Source, streamId: string, token: string, viewId: string, canTranslate: boolean, sentenceHold: number, autoSave: boolean, mode?: TranslationMode) {
  if (isActive(state.phase)) throw new Error('已有会话运行中。');
  await cleanup();
  captions = [];
  preview = undefined;
  sequence = 0;
  lastLease = Date.now();
  viewLeases.set(viewId, lastLease);
  serviceQueue.reset();
  resetDrafts();
  translationMode = mode;
  serviceToken = token;
  translationOwner = canTranslate && !servesTranslation() ? viewId : undefined;
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
      const timeout = setTimeout(() => reject(new Error(`本机服务连接超时，请运行 ${START_SCRIPT}。`)), 8000);
      currentSocket.onopen = () => currentSocket.send(JSON.stringify({ type: 'hello', protocol: 1, token, sampleRate: rate, format: 'f32le', channels: 1, sentenceHold,
        autoSave, source: { title: source.title.slice(0, 500), site: source.site || '网页', host: source.host || '' } }));
      currentSocket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          clearTimeout(timeout);
          setState({ phase: 'capturing', sessionId: message.sessionId, model: message.model });
          savingUnsupported = autoSave && message.autoSaveSupported !== true;
          outputs.begin(message.sessionId, token, autoSave && !savingUnsupported);
          savingStatus();
          resolve();
        } else if (message.type === 'caption' && message.sessionId === state.sessionId) {
          if (!message.final) return;
          const { preview: remainingPreview, ...caption } = message;
          captions = mergeCaption(captions, caption as Caption);
          if (remainingPreview) preview = mergePreview(preview, { ...remainingPreview, sessionId: message.sessionId }, state.sessionId);
          // Replace the preview and add its settled sentence atomically.
          publish({ type: 'caption', caption, preview });
          if (servesTranslation()) serviceQueue.enqueue(caption as Caption);
          void pumpDrafts();
        } else if (message.type === 'preview' && message.sessionId === state.sessionId) {
          preview = mergePreview(preview, message as EnglishPreview, state.sessionId);
          publish({ type: 'preview', preview });
          void pumpDrafts();
        } else if (message.type === 'pending' && message.sessionId === state.sessionId && message.pending !== state.pending) {
          setState({ pending: message.pending });
        } else if (message.type === 'backpressure' && message.sessionId === state.sessionId) {
          setState({ recovering: Boolean(message.recovering) });
        } else if (message.type === 'warning' && message.sessionId === state.sessionId) {
          recordDiagnostic('capture', message.message ? 'refinement_fallback' : 'refinement_recovered');
          setState({ message: message.message });
        } else if (message.type === 'saving' && message.sessionId === state.sessionId) {
          fileSaveFailed = Boolean(message.failed); savingStatus();
        } else if (message.type === 'error') {
          recordDiagnostic('capture', message.code === 'asr_overload' ? 'asr_overload' : 'peer_error');
          clearTimeout(timeout);
          reject(new Error(message.message));
          if (state.phase !== 'starting' && state.phase !== 'stopping') void stop(message.message, true);
        }
      };
      currentSocket.onerror = () => {
        recordDiagnostic('connection', 'socket_error');
        clearTimeout(timeout);
        reject(new Error(`无法连接本机语音服务。请先运行 ${START_SCRIPT}。`));
      };
      currentSocket.onclose = event => {
        recordDiagnostic('capture', 'socket_closed', { closeCode: event.code });
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
      if (currentSocket.bufferedAmount > rate * 4 * TRANSPORT_BACKLOG_SECONDS) {
        recordDiagnostic('capture', 'transport_overload');
        void stop('音频发送持续积压，已停止采集。请检查本机负载后重新开始；已有字幕已保留。', true);
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
    if (message.type === 'snapshot') return { state, captions, preview, drafts, translationStatus, serviceTranslation: servesTranslation() };
    if (message.type === 'diagnostics') return { phase: state.phase, recovering: Boolean(state.recovering), events: diagnosticSnapshot() };
    if (message.type === 'settings') {
      if ('autoSave' in message) {
        outputs.configure(message.autoSave === true);
        if (message.autoSave === true) captions.forEach(caption => outputs.enqueue(caption));
      }
      if ('translationMode' in message) setTranslationMode(message.translationMode);
      return { ok: true };
    }
    if (message.type === 'lease') {
      lastLease = Date.now();
      viewLeases.set(message.viewId, lastLease);
      for (const [id, timestamp] of viewLeases) if (lastLease - timestamp > 10000) viewLeases.delete(id);
      if (translationOwner && !viewLeases.has(translationOwner)) translationOwner = undefined;
      if (message.canTranslate && !translationOwner && !servesTranslation()) translationOwner = message.viewId;
      if (!message.canTranslate && translationOwner === message.viewId) translationOwner = undefined;
      return { owner: translationOwner === message.viewId };
    }
    if (message.type === 'start') return start(message.source, message.streamId, message.token, message.viewId, message.canTranslate, message.sentenceHold || DEFAULT_SETTINGS.sentenceHold, message.autoSave ?? DEFAULT_SETTINGS.autoSave, message.translationMode);
    if (message.type === 'pause' && state.phase === 'capturing') {
      setState({ phase: 'paused' });
      socket?.send(JSON.stringify({ type: 'pause' }));
    } else if (message.type === 'resume' && state.phase === 'paused') {
      socket?.send(JSON.stringify({ type: 'resume' }));
      setState({ phase: 'capturing' });
    } else if (message.type === 'stop') await stop();
    else if (message.type === 'sourceClosed' && message.tabId === state.source?.tabId && isActive(state.phase)) await stop('来源标签页已关闭。');
    else if (message.type === 'translation') {
      if (servesTranslation() || message.viewId !== translationOwner) return { ok: false };
      acceptTranslation({ sessionId: message.sessionId, id: message.id, revision: message.revision, text: message.text });
    } else if (message.type === 'retryTranslation' && servesTranslation()) {
      serviceQueue.retryFailed();
      captions.forEach(caption => serviceQueue.enqueue(caption));
    } else if (message.type === 'clear' && !isActive(state.phase)) {
      captions = [];
      preview = undefined;
      serviceQueue.reset();
      resetDrafts();
      publish({ type: 'cleared' });
    }
    return { ok: true };
  })().then(respond).catch(error => respond({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'nimdaydu-overlay' || port.sender?.id !== browser.runtime.id) return;
  overlays.add(port);
  port.onDisconnect.addListener(() => overlays.delete(port));
  port.postMessage({ type: 'snapshot', state, captions: captions.slice(-OVERLAY_HISTORY), preview, drafts });
});

setInterval(() => {
  // Floating captions are a view too: the side panel may close during a meeting.
  if (overlays.size) lastLease = Date.now();
  if (isActive(state.phase) && state.phase !== 'stopping' && Date.now() - lastLease > 10000) {
    recordDiagnostic('capture', 'view_lease_expired'); void stop('侧栏和悬浮字幕都已关闭，采集自动停止。');
  }
}, 2000);
