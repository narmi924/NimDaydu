import { browser } from 'wxt/browser';
import { SERVICE } from './types';
import { diagnosticSnapshot, safeCaptureDiagnostics } from './diagnostics';
import type { TranslationStatus } from './translation';

export async function exportDiagnostics(translation: TranslationStatus) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [capture, response] = await Promise.allSettled([
    Promise.race([browser.runtime.sendMessage({ target: 'offscreen', type: 'diagnostics' }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Capture unavailable')), 2000); })])
      .finally(() => clearTimeout(timer)),
    fetch(`${SERVICE}/health`, { signal: AbortSignal.timeout(2000) }).then(response => response.json()),
  ]);
  const health = response.status === 'fulfilled' ? response.value : undefined;
  const audio: Record<string, number | string | boolean> = {};
  for (const key of ['framesReceived', 'framesProcessed', 'maxQueuedFrames', 'backpressureEvents', 'maxInferenceMs',
    'inferenceSeconds', 'audioSecondsProcessed', 'recovering', 'status', 'sampleRate', 'realTimeFactor']) {
    const value = health?.audio?.[key];
    if (typeof value === 'number' || typeof value === 'boolean') audio[key] = value;
    if (key === 'status' && ['active', 'stopped', 'overload', 'disconnected'].includes(value)) audio[key] = value;
  }
  const refinement: Record<string, number> = {};
  for (const key of ['completed', 'fallbacks', 'failures', 'maxRefinementMs', 'inferenceSeconds', 'pending']) {
    if (typeof health?.refinement?.[key] === 'number') refinement[key] = health.refinement[key];
  }
  const report = { product: 'NimDaydu', version: browser.runtime.getManifest().version, createdAt: new Date().toISOString(),
    translation: { pending: translation.pending, failed: translation.failed, retrying: translation.retrying, running: translation.running },
    events: diagnosticSnapshot(), capture: capture.status === 'fulfilled' ? safeCaptureDiagnostics(capture.value) : { unavailable: true },
    service: { reachable: health?.app === 'NimDaydu', ready: Boolean(health?.ready), audio, refinement } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `NimDaydu-diagnostics-${Date.now()}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
