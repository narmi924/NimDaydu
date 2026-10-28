import type { Caption, CaptureState, DraftTranslations, EnglishPreview, OverlayMode, ViewMode } from './types';
import { draftKey, isActive, mergeCaption, mergePreview, applyTranslation } from './types';
import { previewUnits, readableCaptions } from './reader';

/** One line pair in the floating caption: settled (with its own Chinese slot) or live English. */
export type OverlayRow = { key: string; zh?: string; en?: string; pending?: boolean; live?: boolean; draft?: boolean };
/** A show/hide the person asked for on this page; it wins over the setting until the next session. */
export type OverlayOverride = 'shown' | 'hidden' | undefined;
/** Position as window fractions; height in px (0: about three sentences at the current size). */
export type OverlayView = { x: number; y: number; scale: number; height: number };
export const DEFAULT_OVERLAY_VIEW: OverlayView = { x: 0.5, y: 0.86, scale: 1, height: 0 };
// Settled captions kept for scrolling back inside the floating caption.
export const OVERLAY_HISTORY = 20;

/**
 * Same order and slots as the side panel: settled sentences keep their place
 * and receive Chinese when it arrives; live English updates underneath.
 */
export function overlayRows(captions: Caption[], preview: EnglishPreview | undefined, mode: ViewMode, drafts: DraftTranslations = {}): OverlayRow[] {
  const translation = (caption: Caption) => caption.translationRevision === caption.revision ? caption.translation : undefined;
  const settled = readableCaptions(captions, mode).slice(-OVERLAY_HISTORY);
  const live = previewUnits(preview).map((unit, index) => ({ unit, index, zh: drafts[draftKey(unit)] }));
  if (mode === 'translated') {
    // Chinese only: settled lines, then early Chinese for what is being said.
    return [...settled.map(caption => ({ key: caption.id, zh: translation(caption) })),
      ...live.filter(row => row.zh).map(row => ({ key: `live:${row.index}`, zh: row.zh, live: true, draft: true }))];
  }
  const rows: OverlayRow[] = settled.map(caption => mode === 'original' ? { key: caption.id, en: caption.text }
    : { key: caption.id, zh: translation(caption), en: caption.text, pending: !translation(caption) });
  live.forEach(row => rows.push(mode === 'original' || !row.zh ? { key: `live:${row.index}`, en: row.unit, live: true }
    : { key: `live:${row.index}`, zh: row.zh, en: row.unit, live: true, draft: true }));
  return rows;
}

export function overlayVisible(mode: OverlayMode, phase: CaptureState['phase'], fullscreen: boolean, override: OverlayOverride) {
  if (!(isActive(phase) || phase === 'stopping') || override === 'hidden') return false;
  return override === 'shown' || mode === 'always' || (mode === 'fullscreen' && fullscreen);
}

export function clampView(view: Partial<OverlayView> | undefined): OverlayView {
  const value = { ...DEFAULT_OVERLAY_VIEW, ...view };
  return { x: Math.min(.97, Math.max(.03, value.x)), y: Math.min(.98, Math.max(.08, value.y)),
    scale: Math.min(2, Math.max(.6, value.scale)), height: Math.max(0, Math.round(value.height) || 0) };
}

/** Captions held by the overlay: same merge rules as the side panel, recent ones only. */
export class OverlayCaptions {
  state: CaptureState = { phase: 'idle' };
  captions: Caption[] = [];
  preview?: EnglishPreview;
  drafts: DraftTranslations = {};
  updatedAt = 0;

  apply(message: any, now = Date.now()) {
    if (message.type === 'snapshot') {
      this.state = message.state; this.captions = message.captions || []; this.preview = message.preview; this.drafts = message.drafts || {};
    } else if (message.type === 'state') {
      if (message.state.phase === 'starting') { this.captions = []; this.preview = undefined; this.drafts = {}; }
      this.state = message.state;
      return;
    } else if (message.type === 'caption' && message.caption?.final) {
      if (message.caption.sessionId !== this.state.sessionId) return;
      this.captions = mergeCaption(this.captions, message.caption).slice(-OVERLAY_HISTORY);
      if (message.preview) this.preview = mergePreview(this.preview, message.preview, this.state.sessionId);
    } else if (message.type === 'preview' && message.preview) {
      this.preview = mergePreview(this.preview, message.preview, this.state.sessionId);
    } else if (message.type === 'translation') {
      this.captions = applyTranslation(this.captions, message);
    } else if (message.type === 'draft') {
      if (message.sessionId !== this.state.sessionId) return;
      this.drafts = { ...this.drafts, [message.key]: message.text };
    } else if (message.type === 'cleared') {
      this.captions = []; this.preview = undefined; this.drafts = {};
    } else return;
    this.updatedAt = now;
  }
}
