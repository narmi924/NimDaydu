import { describe, expect, it } from 'vitest';
import { applyTranslation, mergeCaption, mergePreview, readSettings, type Caption, type EnglishPreview } from './types';

const base: Caption = { sessionId: 'session', id: 'line', revision: 1, text: 'Open the form', final: false, start: 0, end: 1 };

it('enables saving for existing settings while preserving an explicit opt-out', () => {
  expect(readSettings({ schema: 2, translationMode: 'local' })).toMatchObject({ autoSave: true, translationMode: 'local' });
  expect(readSettings({ schema: 2, autoSave: false }).autoSave).toBe(false);
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
