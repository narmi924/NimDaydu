import type { Caption, CaptureState } from './types';
import { timestamp } from './types';
export function exportCaptions(captions: Caption[], state: CaptureState, format: 'txt' | 'json') {
  const text = format === 'json' ? JSON.stringify({ product: 'NimDaydu', version: 2, source: state.source, startedAt: state.startedAt, captions }, null, 2)
    : `NimDaydu · ${state.source?.title || '网页字幕'}\n${new Date(state.startedAt || Date.now()).toLocaleString()}\n\n` + captions.map(c => `[${timestamp(c.start)}]${c.incomplete ? ' [语句未完整]' : ''}\n${c.translation || ''}\n${c.text}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `NimDaydu-${new Date(state.startedAt || Date.now()).toISOString().replace(/[:.]/g, '-')}.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
