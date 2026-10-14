import { expect, it } from 'vitest';
import { diagnosticSnapshot, errorName, recordDiagnostic, safeCaptureDiagnostics } from './diagnostics';

it('exports only bounded operational fields and never arbitrary error details', () => {
  for (let i = 0; i < 250; i++) recordDiagnostic('translation', 'sentence_retry', {
    errorName: 'secret caption', durationMs: i, pending: 2,
    message: 'private transcript', token: 'secret-token', text: 'private sentence',
  } as any);
  const events = diagnosticSnapshot();
  expect(events).toHaveLength(200);
  expect(events[0]?.durationMs).toBe(50);
  expect(events[0]?.errorName).toBe('Error');
  expect(JSON.stringify(events)).not.toMatch(/private|secret/);
  events[0]!.code = 'mutated';
  expect(diagnosticSnapshot()[0]!.code).toBe('sentence_retry');
  expect(errorName(new DOMException('sensitive details', 'TimeoutError'))).toBe('TimeoutError');
});

it('removes accidental caption and token fields from capture diagnostics at the export boundary', () => {
  const report = safeCaptureDiagnostics({ phase: 'capturing', token: 'secret-token', captions: [{ text: 'private transcript' }],
    events: [{ at: '2026-10-14T02:00:00.000Z', component: 'capture', code: 'socket_closed', closeCode: 1011,
      message: 'private transcript', token: 'secret-token' }] });
  expect(JSON.stringify(report)).not.toMatch(/private|secret|captions|token/);
  expect(report.events[0]?.closeCode).toBe(1011);
});
