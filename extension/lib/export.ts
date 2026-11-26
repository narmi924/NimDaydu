import type { UiLanguage } from './ui-language';
import { messagesFor } from './ui-messages';
import type { Caption, CaptureState } from './types';
import { timestamp } from './types';
export type ExportFormat = 'txt' | 'json' | 'srt' | 'md';
function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function subtitleText(captions: Caption[], format: 'srt' | 'md') {
  return captions.map((c, i) => {
    const zh = c.translationRevision === c.revision ? c.translation : undefined;
    const lines = [c.text, zh].filter(Boolean);
    if (format === 'srt') return [String(i + 1), `${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + .001))}`, ...lines].join('\n');
    return `**${timestamp(c.start)}**  \n` + lines.join('  \n');
  }).join('\n\n') + '\n';
}
export function exportCaptions(captions: Caption[], state: CaptureState, format: ExportFormat, language: UiLanguage) {
  const t = messagesFor(language);
  const text = format === 'srt' || format === 'md' ? subtitleText(captions, format) : format === 'json' ? JSON.stringify({ product: 'NimDaydu', version: 2, sessionId: state.sessionId, source: state.source, startedAt: state.startedAt, captions }, null, 2)
    : `NimDaydu · ${state.source?.title || t('webCaptions')}\n${new Date(state.startedAt || Date.now()).toLocaleString(language)}\n\n` + captions.map(c => `[${timestamp(c.start)}]${c.incomplete ? ' [' + t('incompleteExport') + ']' : ''}\n${c.translation || ''}\n${c.text}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `NimDaydu-${new Date(state.startedAt || Date.now()).toISOString().replace(/[:.]/g, '-')}.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
