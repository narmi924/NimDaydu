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
};
export type Phase = 'idle' | 'starting' | 'capturing' | 'paused' | 'stopping' | 'stopped' | 'error';
export type CaptureState = {
  phase: Phase; source?: Source; sessionId?: string; startedAt?: number;
  model?: string; message?: string;
  pending?: boolean;
  recovering?: boolean;
  saveError?: string;
};
export type EnglishPreview = { sessionId: string; revision: number; text: string; start: number; end: number };
export type Snapshot = { state: CaptureState; captions: Caption[]; preview?: EnglishPreview };
export type Settings = { schema: number; token: string; translationMode: TranslationMode; viewMode: ViewMode; fontSize: number; sentenceHold: number; autoSave: boolean };
export const DEFAULT_SETTINGS: Settings = { schema: 2, token: '', translationMode: 'offline', viewMode: 'bilingual', fontSize: 18, sentenceHold: 0.8, autoSave: true };
export function readSettings(saved?: Partial<Settings>): Settings {
  return saved?.schema === 2 ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS, token: saved?.token || '' };
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

export function timestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
