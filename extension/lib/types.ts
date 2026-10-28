export const SERVICE = 'http://127.0.0.1:8765';
export const SOCKET = 'ws://127.0.0.1:8765/audio';
export type TranslationMode = 'offline' | 'local' | 'deepseek' | 'off';
export type ViewMode = 'bilingual' | 'original' | 'translated';
export type Source = { tabId: number; title: string; windowId: number; site?: string; host?: string };
export type Caption = {
  id: string; sessionId: string; revision: number; text: string; final: boolean;
  start: number; end: number; inferenceMs?: number;
  translation?: string; translationRevision?: number;
  paragraph?: number; incomplete?: boolean; rawText?: string[];
  /** A clause of a longer sentence; the sentence continues in the next caption. */
  continued?: boolean;
};
export type Phase = 'idle' | 'starting' | 'capturing' | 'paused' | 'stopping' | 'stopped' | 'error';
export type CaptureState = {
  phase: Phase; source?: Source; sessionId?: string; startedAt?: number;
  model?: string; message?: string;
  pending?: boolean;
  recovering?: boolean;
  saveError?: string;
};
/** Live English, already cut into the rows its settled captions will take (`units`). */
export type EnglishPreview = { sessionId: string; revision: number; text: string; start: number; end: number; units?: string[] };
export type Snapshot = { state: CaptureState; captions: Caption[]; preview?: EnglishPreview };
/** Floating captions on the page: only while it is fullscreen, always, or never. */
export type OverlayMode = 'fullscreen' | 'always' | 'off';
export type Settings = { schema: number; token: string; translationMode: TranslationMode; viewMode: ViewMode; fontSize: number; sentenceHold: number; autoSave: boolean; overlay: OverlayMode };
export const DEFAULT_SETTINGS: Settings = { schema: 3, token: '', translationMode: 'offline', viewMode: 'bilingual', fontSize: 18, sentenceHold: 0.4, autoSave: true, overlay: 'fullscreen' };
export function readSettings(saved?: Partial<Settings>): Settings {
  if (saved?.schema === 3) return { ...DEFAULT_SETTINGS, ...saved };
  // v0.5 users never chose 0.8 s; it was the old default. Shorter waits now
  // pair with clause-sized captions, so move them to the new default.
  if (saved?.schema === 2) return { ...DEFAULT_SETTINGS, ...saved, schema: 3, sentenceHold: saved.sentenceHold === 0.8 || saved.sentenceHold === undefined ? DEFAULT_SETTINGS.sentenceHold : saved.sentenceHold };
  return { ...DEFAULT_SETTINGS, token: saved?.token || '' };
}
export const isActive = (phase: Phase) => ['starting', 'capturing', 'paused', 'stopping'].includes(phase);

export function mergeCaption(captions: Caption[], incoming: Caption): Caption[] {
  const index = captions.findIndex(c => c.id === incoming.id && c.sessionId === incoming.sessionId);
  if (index < 0) return [...captions.slice(-4999), incoming];
  const current = captions[index]!;
  if (incoming.revision <= current.revision) return captions;
  const updated = captions.slice();
  updated[index] = { ...current, ...incoming };
  return updated;
}

export function mergePreview(current: EnglishPreview | undefined, incoming: EnglishPreview, sessionId?: string): EnglishPreview | undefined {
  if (incoming.sessionId !== sessionId) return current;
  if (current?.sessionId === incoming.sessionId && current.revision >= incoming.revision) return current;
  return incoming;
}

export function applyTranslation(captions: Caption[], message: { sessionId: string; id: string; revision: number; text: string }): Caption[] {
  const index = captions.findIndex(c => c.id === message.id && c.sessionId === message.sessionId);
  if (index < 0 || captions[index]!.revision !== message.revision || captions[index]!.translationRevision === message.revision) return captions;
  const updated = captions.slice();
  updated[index] = { ...captions[index]!, translation: message.text, translationRevision: message.revision };
  return updated;
}

/** Live and settled English often differ only in case or punctuation. */
export function draftKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
}

/** Chinese for live English rows, keyed by draftKey; shown dimmed until the caption settles. */
export type DraftTranslations = Record<string, string>;

export function timestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
