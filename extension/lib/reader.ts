import type { Caption } from './types';
export type Paragraph = { id: string; captions: Caption[] };
/** Hide unfinished translations and preserve chronological reading order. */
export function readableCaptions(captions: Caption[], translated: boolean, fallback = false): Caption[] {
  const result: Caption[] = [];
  for (const caption of captions) {
    if (!caption.final) continue;
    if (translated && !fallback && caption.translationRevision !== caption.revision) break;
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
