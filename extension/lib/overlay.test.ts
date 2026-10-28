import { expect, it } from 'vitest';
import { OverlayCaptions, clampView, overlayRows, overlayVisible } from './overlay';
import type { Caption, EnglishPreview } from './types';

const caption = (id: string, text: string, translation?: string): Caption => ({ sessionId: 's', id, revision: 1, final: true, text,
  start: 0, end: 1, ...(translation ? { translation, translationRevision: 1 } : {}) });
const live = (text: string, units?: string[]): EnglishPreview => ({ sessionId: 's', revision: 1, text, start: 0, end: 1, units });

it('lists settled lines with their own Chinese slot and live English underneath', () => {
  const captions = [caption('1', 'Open the form.', '打开表单。'), caption('2', 'Then pay.')];
  const preview = live('And check the date. The booking', ['And check the date.', 'The booking']);
  expect(overlayRows(captions, preview, 'bilingual')).toEqual([
    { key: '1', zh: '打开表单。', en: 'Open the form.', pending: false },
    { key: '2', zh: undefined, en: 'Then pay.', pending: true },
    { key: 'live:0', en: 'And check the date.', live: true },
    { key: 'live:1', en: 'The booking', live: true },
  ]);
  // A late translation fills the same row; the keys do not move.
  captions[1] = caption('2', 'Then pay.', '然后付款。');
  expect(overlayRows(captions, preview, 'bilingual')[1]).toEqual({ key: '2', zh: '然后付款。', en: 'Then pay.', pending: false });
});

it('respects Chinese-only and English-only modes', () => {
  const captions = [caption('1', 'Open the form.', '打开表单。'), caption('2', 'Then pay.'), caption('3', 'Done.', '完成。')];
  // Chinese only shows translated lines in order and no live English.
  expect(overlayRows(captions, live('Next'), 'translated')).toEqual([{ key: '1', zh: '打开表单。' }]);
  expect(overlayRows(captions, live('Next'), 'original').map(row => row.en)).toEqual(['Open the form.', 'Then pay.', 'Done.', 'Next']);
});

it('follows the setting until the person shows or hides it on the page', () => {
  expect(overlayVisible('fullscreen', 'capturing', false, undefined)).toBe(false);
  expect(overlayVisible('fullscreen', 'capturing', true, undefined)).toBe(true);
  expect(overlayVisible('always', 'paused', false, undefined)).toBe(true);
  expect(overlayVisible('off', 'capturing', true, undefined)).toBe(false);
  // The shortcut works in any mode, including inside fullscreen.
  expect(overlayVisible('fullscreen', 'capturing', true, 'hidden')).toBe(false);
  expect(overlayVisible('off', 'capturing', false, 'shown')).toBe(true);
  expect(overlayVisible('always', 'idle', false, 'shown')).toBe(false);
});

it('keeps a dragged caption on screen and its size within bounds', () => {
  expect(clampView({ x: -1, y: 2, scale: 9, height: 120.4 })).toEqual({ x: .03, y: .98, scale: 2, height: 120 });
  expect(clampView(undefined)).toEqual({ x: .5, y: .86, scale: 1, height: 0 });
});

it('follows one session, keeps recent sentences, applies late Chinese and live English', () => {
  const data = new OverlayCaptions();
  data.apply({ type: 'snapshot', state: { phase: 'capturing', sessionId: 's' }, captions: [] }, 1);
  for (let index = 0; index < 25; index++) data.apply({ type: 'caption', caption: caption(String(index), `Line ${index}.`) }, 2);
  data.apply({ type: 'caption', caption: { ...caption('x', 'Other session.'), sessionId: 'old' } }, 3);
  expect(data.captions).toHaveLength(20);
  expect(data.captions[0]!.id).toBe('5');
  data.apply({ type: 'translation', sessionId: 's', id: '24', revision: 1, text: '第二十四句。' }, 4);
  expect(data.captions.at(-1)!.translation).toBe('第二十四句。');
  data.apply({ type: 'preview', preview: live('Now we') }, 5);
  expect(data.preview?.text).toBe('Now we');
  expect(data.updatedAt).toBe(5);
  data.apply({ type: 'state', state: { phase: 'starting' } }, 6);
  expect(data.captions).toEqual([]);
});

it('shows early Chinese for finished live rows, dimmed, in bilingual and Chinese-only modes', () => {
  const preview = live('And check the date. The booking', ['And check the date.', 'The booking']);
  const drafts = { 'and check the date': '再核对日期。' };
  expect(overlayRows([], preview, 'bilingual', drafts)).toEqual([
    { key: 'live:0', zh: '再核对日期。', en: 'And check the date.', live: true, draft: true },
    { key: 'live:1', en: 'The booking', live: true },
  ]);
  expect(overlayRows([], preview, 'translated', drafts)).toEqual([{ key: 'live:0', zh: '再核对日期。', live: true, draft: true }]);
  expect(overlayRows([], preview, 'original', drafts).every(row => !row.zh)).toBe(true);
});
