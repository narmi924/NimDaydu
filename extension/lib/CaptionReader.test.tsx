import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnglishPreviewRow, ParagraphRow } from './CaptionReader';
import type { Caption, EnglishPreview } from './types';
const caption: Caption = { sessionId: 'one', id: 'one', revision: 1, final: true, text: 'Open the application form.', start: 0, end: 1 };
const preview: EnglishPreview = { sessionId: 'one', revision: 1, text: 'Then check the', start: 1, end: 2 };

it('renders English before a translation exists without changing its font class later', () => {
  const before = renderToStaticMarkup(<ParagraphRow paragraph={{ id: 'one', captions: [caption] }} mode="bilingual"/>);
  const after = renderToStaticMarkup(<ParagraphRow paragraph={{ id: 'one', captions: [{ ...caption, translation: '打开申请表。', translationRevision: 1 }] }} mode="bilingual"/>);
  expect(before).toContain('Open the application form.');
  expect(before).not.toContain('class="chinese"');
  expect(before).toContain('class="english"');
  expect(after).toContain('class="english"');
  expect(after).toContain('打开申请表。');
});

it('renders a live English preview without translating it or leaking it into Chinese-only mode', () => {
  const bilingual = renderToStaticMarkup(<EnglishPreviewRow preview={preview} mode="bilingual"/>);
  expect(bilingual).toContain('Then check the');
  expect(bilingual).toContain('实时英文');
  expect(bilingual).not.toContain('class="chinese"');
  expect(renderToStaticMarkup(<EnglishPreviewRow preview={preview} mode="translated"/>)).toBe('');
  expect(renderToStaticMarkup(<EnglishPreviewRow preview={{ ...preview, text: '' }} mode="bilingual"/>)).toBe('');
});
