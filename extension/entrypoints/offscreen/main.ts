import { browser } from 'wxt/browser';
import { diagnosticSnapshot, recordDiagnostic, type DiagnosticEvent } from '../../lib/diagnostics';
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

// Translate in the capture page so closing the side panel does not pause Chinese.
let translationMode: TranslationMode = DEFAULT_SETTINGS.translationMode;
let serviceToken = '';
let translationStatus: TranslationStatus = { pending: 0, failed: 0, retrying: 0, running: false };
const servesTranslation = () => translationMode === 'offline';
let audioOrigin: number | undefined;
type LiveTiming = { english: number; chinese?: number; revision?: number; observations: number };
let liveTimes = new Map<string, LiveTiming>();
const captionTimes = new WeakMap<Caption, {
  end: number; settled: number; early?: number; fields: Partial<DiagnosticEvent>;
}>();

function updateLiveTimes() {
  const next = new Map<string, LiveTiming>();
  const now = performance.now();
  for (const unit of previewUnits(preview)) {
    const key = draftKey(unit);
    const row = liveTimes.get(key) ?? { english: now, observations: 0 };
    if (row.revision !== preview?.revision) {
      row.observations++;
      row.revision = preview?.revision;
    }
    if (draftModel.has(key)) row.chinese ??= now;
    next.set(key, row);
  }
  liveTimes = next;
}
const serviceQueue = new TranslationQueue(
  (caption, signal) => {
    // A live draft of the same words was already translated: no second model call.
    const drafted = draftModel.get(draftKey(caption.text));
    const timing = captionTimes.get(caption);
    const waited = timing ? performance.now() - timing.settled : 0;
    if (timing) timing.fields.translationQueueMs = waited;
    if (drafted !== undefined) {
      if (timing) timing.fields.modelMs = 0;
      return Promise.resolve(drafted);
    }
    return serviceTranslate(caption.text, serviceToken, signal, false, (modelMs, queueMs) => {
      if (timing) Object.assign(timing.fields, { modelMs, translationQueueMs: waited + queueMs });
    });
  },
  (caption, text) => {
    acceptTranslation({ sessionId: caption.sessionId, id: caption.id, revision: caption.revision, text });
    const timing = captionTimes.get(caption);
    if (timing) {
      const now = performance.now();
      recordDiagnostic('translation', 'caption_timing', { ...timing.fields,
        firstChineseMs: (timing.early ?? now) - timing.end, finalChineseMs: now - timing.end });
    }
  },
  () => {}, { onChange: status => {
    translationStatus = status; publish({ type: 'translationStatus', status });
    if (!status.pending && !status.running) void pumpDrafts();
  } });

// Live English rows that are already complete (every row but the one still
// being spoken, unless it already ends a sentence) are translated while the
// local model is idle. Chinese then
// appears as the sentence ends instead of after the second pass, and the
// settled caption reuses it when the words agree.
const draftModel = new Map<string, string>();
let drafts: DraftTranslations = {};
let drafting = false;
let tailTimer: ReturnType<typeof setTimeout> | undefined;
const TAIL_SETTLE_MS = 1100;
async function pumpDrafts() {
  if (drafting || translationMode !== 'offline' || state.phase !== 'capturing') return;
  if (translationStatus.pending || translationStatus.running) return;
  clearTimeout(tailTimer);
  const units = previewUnits(preview);
  const unit = units.find((text, index) => {
    const key = draftKey(text);
    if (draftModel.has(key)) return false;
    if (preview?.speechEnded) return true;
    const row = liveTimes.get(key);
    const tail = index === units.length - 1;
    if (/[.!?]["”’]*$/.test(text)) {
      if (!tail || !row || row.observations >= 2) return true;
      // Moonshine often puts a period on a changing hypothesis. Give the next
      // acoustic update time to replace it before showing a Chinese guess.
      const remaining = TAIL_SETTLE_MS - (performance.now() - row.english);
      if (remaining <= 0) return true;
      tailTimer = setTimeout(() => void pumpDrafts(), Math.ceil(remaining));
      return false;
    }
    // A clause can be ready while the microphone is still hearing the next
    // one. Confirm it in two revisions before spending an idle model pass.
    const clauseEnd = !tail || (/[,;:]$/.test(text) && text.split(/\s+/u).length >= 8);
    return clauseEnd && (row?.observations ?? 0) >= 2;
  });
  if (!unit) return;
  const continued = !/[.!?]["”’]*$/.test(unit) && !(preview?.speechEnded && unit === units.at(-1));
  drafting = true;
  const session = state.sessionId;
  let done = false;
  try {
    const text = await serviceTranslate(unit, serviceToken, AbortSignal.timeout(8000), true);
    if (session !== state.sessionId || !servesTranslation()) return;
    const key = draftKey(unit);
    draftModel.set(key, text);
    const row = liveTimes.get(key);
    if (row) row.chinese ??= performance.now();
    drafts = { ...drafts, [key]: finalTranslation(text, false, continued) };
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
function resetDrafts() { clearTimeout(tailTimer); draftModel.clear(); drafts = {}; }

// Floating captions on the source page connect here and count as an open view.
const overlays = new Set<ReturnType<typeof browser.runtime.connect>>();
const OVERLAY_TYPES = new Set(['state', 'caption', 'preview', 'translation', 'draft', 'cleared']);

function publish(message: Record<string, unknown>) {
  void browser.runtime.sendMessage({ target: 'ui', ...message }).catch(() => {});
  if (!OVERLAY_TYPES.has(message.type as string)) return;
  for (const port of overlays) { try { port.postMessage(message); } catch { overlays.delete(port); } }
}

function acceptTranslation(message: { sessionId: string; id: string; revision: number; text: string }) {
  const updated = applyTranslation(captions, message);
  if (updated === captions) return;
  captions = updated;
  const translated = captions.find(caption => caption.sessionId === message.sessionId && caption.id === message.id);
  if (translated) outputs.enqueue(translated);
  publish({ type: 'translation', ...message });
}

function setTranslationMode(mode: TranslationMode) {
  if (mode === translationMode) return;
  serviceQueue.reset();
  resetDrafts();
  translationMode = mode;
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

async function start(source: Source, streamId: string, token: string, sentenceHold: number, autoSave: boolean, mode: TranslationMode = DEFAULT_SETTINGS.translationMode, desktop = false) {
  if (isActive(state.phase)) throw new Error('已有会话运行中。');
  let selected: MediaStream | undefined;
  if (desktop) {
    try {
      selected = await navigator.mediaDevices.getDisplayMedia({
        audio: true, video: true, systemAudio: 'include', windowAudio: 'window',
      } as DisplayMediaStreamOptions);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('没有开始共享声音。请在 Chrome 的共享窗口中选择音源并允许共享。');
      throw error;
    }
    for (const track of selected.getVideoTracks()) { track.stop(); selected.removeTrack(track); }
    if (!selected.getAudioTracks().length) throw new Error('所选来源没有共享声音。请选择支持音频的窗口、屏幕或标签页并勾选共享音频。');
  }
  await cleanup();
  captions = [];
  preview = undefined;
  sequence = 0;
  audioOrigin = undefined;
  liveTimes.clear();
  lastLease = Date.now();
  serviceQueue.reset();
  resetDrafts();
  translationMode = mode;
  serviceToken = token;
  state = { phase: 'starting', source, startedAt: Date.now() };
  setState({});
  try {
    const constraints = { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false };
    media = selected ?? await navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
    media.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (isActive(state.phase) && state.phase !== 'stopping') void stop('声音来源已关闭。');
    });
    context = new AudioContext({ latencyHint: 'interactive' });
    await context.resume();
    const input = context.createMediaStreamSource(media);
    if (!desktop) input.connect(context.destination);
    await context.audioWorklet.addModule(browser.runtime.getURL('/audio-worklet.js'));
    worklet = new AudioWorkletNode(context, 'nimdaydu-pcm');
    input.connect(worklet);
    worklet.connect(context.destination);
    const rate = Math.min(16000, context.sampleRate);
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
          const { preview: remainingPreview, refineMs, refineQueueMs, ...caption } = message;
          const live = liveTimes.get(draftKey(caption.text));
          if (audioOrigin !== undefined) {
            const end = audioOrigin + caption.end * 1000;
            const settled = performance.now();
            const fields = { sentence: Number(caption.id.split(':')[1]), settledMs: settled - end,
              previewMs: live && live.english - end, refineMs, refineQueueMs };
            recordDiagnostic('capture', 'english_settled', fields);
            captionTimes.set(caption as Caption, { end, settled, early: live?.chinese, fields });
          }
          liveTimes.delete(draftKey(caption.text));
          captions = mergeCaption(captions, caption as Caption);
          if (remainingPreview) preview = mergePreview(preview, { ...remainingPreview, sessionId: message.sessionId }, state.sessionId);
          if (remainingPreview) updateLiveTimes();
          // Replace the preview and add its settled sentence atomically.
          publish({ type: 'caption', caption, preview });
          if (servesTranslation()) serviceQueue.enqueue(caption as Caption);
          void pumpDrafts();
        } else if (message.type === 'preview' && message.sessionId === state.sessionId) {
          preview = mergePreview(preview, message as EnglishPreview, state.sessionId);
          updateLiveTimes();
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
      audioOrigin ??= performance.now() - (data.offset + samples.length) / rate * 1000;
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
    if (message.type === 'editTerm') {
      const sessionId = state.sessionId;
      if (!sessionId || message.sessionId !== sessionId) throw new Error('字幕会话已切换。');
      const response = await fetch(`http://127.0.0.1:8765/terms/${sessionId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify(message.edit),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '纠词失败。');
      if (state.sessionId !== sessionId) return { ok: true };
      for (const item of result.captions) {
        const caption = { ...item, sessionId };
        captions = mergeCaption(captions, caption);
        publish({ type: 'caption', caption, preview });
        if (servesTranslation()) serviceQueue.enqueue(caption);
      }
      if (!result.saved) setState({ saveError: '字幕已更正，写入输出文件失败。' });
      return { ok: true };
    }
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
      return { ok: true };
    }
    if (message.type === 'start') return start(message.source, message.streamId, message.token, message.sentenceHold || DEFAULT_SETTINGS.sentenceHold, message.autoSave ?? DEFAULT_SETTINGS.autoSave, message.translationMode, message.desktop === true);
    if (message.type === 'pause' && state.phase === 'capturing') {
      setState({ phase: 'paused' });
      socket?.send(JSON.stringify({ type: 'pause' }));
    } else if (message.type === 'resume' && state.phase === 'paused') {
      socket?.send(JSON.stringify({ type: 'resume' }));
      setState({ phase: 'capturing' });
    } else if (message.type === 'stop') await stop();
    else if (message.type === 'sourceClosed' && message.tabId === state.source?.tabId && isActive(state.phase)) await stop('来源标签页已关闭。');
    else if (message.type === 'retryTranslation' && servesTranslation()) {
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
