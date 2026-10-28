import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveRows, ParagraphRow } from './CaptionReader';
import type { Caption, EnglishPreview } from './types';
const caption: Caption = { sessionId: 'one', id: 'one', revision: 1, final: true, text: 'Open the application form.', start: 0, end: 1 };
const preview: EnglishPreview = { sessionId: 'one', revision: 1, text: 'Then check the', start: 1, end: 2 };

it('renders English before a translation exists without changing its font class later', () => {
  const before = renderToStaticMarkup(<ParagraphRow paragraph={{ id: 'one', captions: [caption] }} mode="bilingual"/>);
  const after = renderToStaticMarkup(<ParagraphRow paragraph={{ id: 'one', captions: [{ ...caption, translation: '打开申请表。', translationRevision: 1 }] }} mode="bilingual"/>);
  expect(before).toContain('Open the application form.');
  // The Chinese line is reserved, so the translation fills it in place.
  expect(before).toContain('class="chinese pending"');
  expect(before).toContain('class="english"');
  expect(after).toContain('class="english"');
  expect(after).toContain('打开申请表。');
});

it('shows live English as separate rows with a reserved Chinese slot, never in Chinese-only mode', () => {
  const bilingual = renderToStaticMarkup(<LiveRows preview={{ ...preview, text: 'Check it. Then check the', units: ['Check it.', 'Then check the'] }} mode="bilingual"/>);
  expect(bilingual.match(/class="unit live"/g)).toHaveLength(2);
  expect(bilingual.match(/class="chinese slot"/g)).toHaveLength(2);
  expect(bilingual).toContain('Then check the<span class="caret"');
  expect(renderToStaticMarkup(<LiveRows preview={preview} mode="original"/>)).not.toContain('chinese');
  expect(renderToStaticMarkup(<LiveRows preview={preview} mode="translated"/>)).toBe('');
  expect(renderToStaticMarkup(<LiveRows preview={{ ...preview, text: '' }} mode="bilingual"/>)).toBe('');
});

it('pairs every clause with its own Chinese instead of one block per paragraph', () => {
  const markup = renderToStaticMarkup(<ParagraphRow paragraph={{ id: 'p', captions: [
    { ...caption, id: 'a', text: 'I will put it up front,', continued: true, translation: '我会放在前面，', translationRevision: 1 },
    { ...caption, id: 'b', text: 'so you do not wait.' }] }} mode="bilingual"/>);
  expect(markup.match(/class="unit"/g)).toHaveLength(2);
  expect(markup.indexOf('我会放在前面，')).toBeLessThan(markup.indexOf('I will put it up front,'));
  expect(markup.indexOf('I will put it up front,')).toBeLessThan(markup.indexOf('so you do not wait.'));
});

it('shows early Chinese on finished live rows and only those rows in Chinese-only mode', () => {
  const live = { ...preview, text: 'Check it. Then check the', units: ['Check it.', 'Then check the'] };
  const drafts = { 'check it': '检查一下。' };
  const bilingual = renderToStaticMarkup(<LiveRows preview={live} mode="bilingual" drafts={drafts}/>);
  expect(bilingual).toContain('<p class="chinese draft" lang="zh-CN">检查一下。</p>');
  expect(bilingual.match(/class="chinese slot"/g)).toHaveLength(1);
  const chinese = renderToStaticMarkup(<LiveRows preview={live} mode="translated" drafts={drafts}/>);
  expect(chinese).toContain('检查一下。'); expect(chinese).not.toContain('Then check the');
});
