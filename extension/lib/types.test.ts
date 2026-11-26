import { describe, expect, it } from 'vitest';
import { applyTranslation, draftKey, mergeCaption, mergePreview, readSettings, type Caption, type EnglishPreview } from './types';

const base: Caption = { sessionId: 'session', id: 'line', revision: 1, text: 'Open the form', final: false, start: 0, end: 1 };

it('reuses draft formatting changes while keeping meaningful case and punctuation', () => {
  expect(draftKey(' Use  C++, ')).toBe(draftKey('Use C++.'));
  expect(draftKey('Ship now?')).not.toBe(draftKey('Ship now.'));
  expect(draftKey('Use MB')).not.toBe(draftKey('Use Mb'));
  expect(draftKey('Install 3.12')).not.toBe(draftKey('Install 3 12'));
  expect(draftKey('Wait...')).not.toBe(draftKey('Wait.'));
  expect(draftKey('constructor') in {}).toBe(false);
});

it('enables saving for existing settings while preserving an explicit opt-out', () => {
  expect(readSettings({ schema: 2, translationMode: 'local' })).toMatchObject({ autoSave: true, translationMode: 'offline' });
  expect(readSettings({ schema: 2, autoSave: false }).autoSave).toBe(false);
});

it('moves removed translation modes to the local model without losing preferences', () => {
  for (const schema of [2, 3]) for (const translationMode of ['local', 'deepseek']) {
    expect(readSettings({ schema, translationMode, fontSize: 22, autoSave: false })).toMatchObject({
      translationMode: 'offline', fontSize: 22, autoSave: false,
    });
  }
  expect(readSettings({ schema: 3, translationMode: 'off' }).translationMode).toBe('off');
});

it('moves the old default translation wait to the faster one but keeps a deliberate choice', () => {
  expect(readSettings({ schema: 2, sentenceHold: 0.8 })).toMatchObject({ schema: 3, sentenceHold: 0.4, overlay: 'fullscreen' });
  expect(readSettings({ schema: 2, sentenceHold: 1.2 }).sentenceHold).toBe(1.2);
  expect(readSettings({ schema: 3, sentenceHold: 0.8 }).sentenceHold).toBe(0.8);
});

describe('live caption revisions', () => {
  it('replaces a partial rather than adding duplicates and rejects stale ASR updates', () => {
    const updated = mergeCaption([base], { ...base, revision: 3, text: 'Open the application form.', final: true });
    expect(updated).toHaveLength(1);
    expect(mergeCaption(updated, { ...base, revision: 2 })).toBe(updated);
  });
  it('never lets an old translation overwrite newer English or another session', () => {
    const captions = [{ ...base, revision: 2 }];
    expect(applyTranslation(captions, { sessionId: 'session', id: 'line', revision: 1, text: '旧译文' })).toBe(captions);
    expect(applyTranslation(captions, { sessionId: 'previous', id: 'line', revision: 2, text: '其他会话' })).toBe(captions);
    expect(applyTranslation(captions, { sessionId: 'session', id: 'line', revision: 2, text: '打开申请表。' })[0]?.translation).toBe('打开申请表。');
  });
});

it('rejects old previews after a sentence is committed and ignores another session', () => {
  const live: EnglishPreview = { sessionId: 'session', revision: 2, text: 'Open the form', start: 0, end: 1 };
  const cleared = mergePreview(live, { ...live, revision: 3, text: '' }, 'session');
  expect(cleared?.text).toBe('');
  expect(mergePreview(cleared, live, 'session')).toBe(cleared);
  expect(mergePreview(cleared, { ...live, sessionId: 'previous', revision: 100 }, 'session')).toBe(cleared);
  expect(mergePreview(undefined, live, 'new-session')).toBeUndefined();
});
