import { expect, it } from 'vitest';
import { groupParagraphs, readableCaptions } from './reader';
import { DEFAULT_SETTINGS, applyTranslation, readSettings, type Caption } from './types';
const caption = (id: string, paragraph = 1): Caption => ({ id, paragraph, sessionId: 'one', text: 'A complete sentence.', final: true, revision: 1, start: 0, end: 1 });
it('displays settled English without waiting for Chinese, preserving reading order', () => {
  const first = { ...caption('a'), translation: '完整语句。', translationRevision: 1 };
  const second = caption('b');
  const third = { ...caption('c'), translation: '第三句。', translationRevision: 1 };
  expect(readableCaptions([first, second, third], 'bilingual')).toEqual([first, second, third]);
  expect(readableCaptions([first, second, third], 'translated')).toEqual([first]);
  expect(readableCaptions([{ ...first, final: false }, second], 'original')).toEqual([second]);
  expect(readableCaptions([first, second, third], 'translated', true)).toHaveLength(3);
});
it('groups settled sentences by paragraph while preserving original sentences', () => {
  const input = [caption('a'), caption('b'), caption('c', 2)];
  const paragraphs = groupParagraphs(input);
  expect(paragraphs.map(p => p.captions.length)).toEqual([2, 1]);
  expect(input.map(c => c.text)).toEqual(paragraphs.flatMap(p => p.captions.map(c => c.text)));
});
it('freezes a displayed translation instead of replacing it with another response', () => {
  const input = [{ ...caption('a'), translation: '原译文。', translationRevision: 1 }];
  expect(applyTranslation(input, { sessionId: 'one', id: 'a', revision: 1, text: '变化的译文。' })).toBe(input);
});
it('migrates old settings to local defaults with both languages visible', () => {
  expect(DEFAULT_SETTINGS.viewMode).toBe('bilingual');
  expect(readSettings({ token: 'saved', translationMode: 'deepseek', viewMode: 'translated' })).toEqual({ ...DEFAULT_SETTINGS, token: 'saved' });
});
