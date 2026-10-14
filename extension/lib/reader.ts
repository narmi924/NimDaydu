import type { Caption, ViewMode } from './types';
export type Paragraph = { id: string; captions: Caption[] };
/** English is immediately readable; Chinese-only mode waits for translations. */
export function readableCaptions(captions: Caption[], mode: ViewMode, fallback = false): Caption[] {
  const result: Caption[] = [];
  for (const caption of captions) {
    if (!caption.final) continue;
    if (mode === 'translated' && !fallback && caption.translationRevision !== caption.revision) break;
    result.push(caption);
  }
  return result;
}
export function groupParagraphs(captions: Caption[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const caption of captions) {
    const group = `${caption.sessionId}/${caption.paragraph ?? caption.id}`;
    const last = paragraphs.at(-1);
    if (last?.id === group) last.captions.push(caption);
    else paragraphs.push({ id: group, captions: [caption] });
  }
  return paragraphs;
}
