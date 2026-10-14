import { memo } from 'react';
import { timestamp, type EnglishPreview, type ViewMode } from './types';
import type { Paragraph } from './reader';

export const ParagraphRow = memo(function ParagraphRow({ paragraph, mode }: { paragraph: Paragraph; mode: ViewMode }) {
  const translated = paragraph.captions.filter(c => c.translationRevision === c.revision).map(c => c.translation).filter(Boolean).join('');
  return <article className="paragraph">
    <div className="paragraph-meta"><time>{timestamp(paragraph.captions[0]!.start)}</time>{paragraph.captions.some(c => c.incomplete) && <span>语句未完</span>}</div>
    {mode !== 'original' && translated && <p className="chinese" lang="zh-CN">{translated}</p>}
    {(mode !== 'translated' || !translated) && <p className={mode === 'original' || mode === 'translated' ? 'english only' : 'english'} lang="en">{paragraph.captions.map(c => c.text).join(' ')}</p>}
  </article>;
});

export const EnglishPreviewRow = memo(function EnglishPreviewRow({ preview, mode }: { preview?: EnglishPreview; mode: ViewMode }) {
  if (!preview?.text || mode === 'translated') return null;
  return <article className="live-preview" aria-label="实时英文">
    <div className="paragraph-meta"><time>{timestamp(preview.start)}</time><span>实时英文</span></div>
    <p className={mode === 'original' ? 'english only' : 'english'} lang="en">{preview.text}</p>
  </article>;
});
