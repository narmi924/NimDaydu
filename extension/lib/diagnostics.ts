/** Bounded, in-memory operational events. Never accept transcript/error messages. */
export type DiagnosticEvent = {
  at: string; component: 'translation' | 'capture' | 'connection'; code: string;
  errorName?: string; durationMs?: number; pending?: number; attempt?: number; closeCode?: number;
};
const events: DiagnosticEvent[] = [];
const names = new Set(['AbortError', 'TimeoutError', 'NotSupportedError', 'InvalidStateError', 'NotAllowedError', 'OperationError', 'QuotaExceededError', 'NetworkError', 'TypeError', 'Error']);
export function errorName(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Error';
  return names.has(name) ? name : 'Error';
}
export function recordDiagnostic(component: DiagnosticEvent['component'], code: string,
  fields: Partial<Omit<DiagnosticEvent, 'at' | 'component' | 'code'>> = {}) {
  // Select fields explicitly: callers cannot accidentally export text, URLs or tokens.
  const event: DiagnosticEvent = { at: new Date().toISOString(), component,
    code: /^[a-z_]{1,40}$/.test(code) ? code : 'unknown' };
  if (fields.errorName) event.errorName = names.has(fields.errorName) ? fields.errorName : 'Error';
  for (const key of ['durationMs', 'pending', 'attempt', 'closeCode'] as const) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) event[key] = Math.max(0, Math.round(value));
  }
  events.push(event);
  if (events.length > 200) events.shift();
}
export function diagnosticSnapshot() { return events.map(event => ({ ...event })); }

export function safeCaptureDiagnostics(value: unknown) {
  const capture = value as { phase?: string; recovering?: boolean; events?: DiagnosticEvent[] } | undefined;
  return {
    phase: ['idle', 'starting', 'capturing', 'paused', 'stopping', 'stopped', 'error'].includes(capture?.phase || '') ? capture!.phase : 'unknown',
    recovering: capture?.recovering === true,
    events: Array.isArray(capture?.events) ? capture.events.slice(-200).filter(event => event && typeof event === 'object').map(event => {
      const safe: Partial<DiagnosticEvent> = { component: ['translation', 'capture', 'connection'].includes(event.component) ? event.component : 'capture',
        code: /^[a-z_]{1,40}$/.test(event.code) ? event.code : 'unknown' };
      if (typeof event.at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(event.at)) safe.at = event.at;
      if (event.errorName && names.has(event.errorName)) safe.errorName = event.errorName;
      for (const key of ['durationMs', 'pending', 'attempt', 'closeCode'] as const) if (typeof event[key] === 'number' && Number.isFinite(event[key])) safe[key] = event[key];
      return safe;
    }) : [],
  };
}
