import { memo } from 'react';
import { draftKey, timestamp, type DraftTranslations, type EnglishPreview, type ViewMode } from './types';
import { previewUnits, type Paragraph } from './reader';

/**
 * One row per caption unit: each English clause sits right under its own
 * Chinese. In bilingual mode the Chinese line is reserved before the
 * translation arrives, so filling it in never pushes the rows around.
 */
export const ParagraphRow = memo(function ParagraphRow({ paragraph, mode }: { paragraph: Paragraph; mode: ViewMode }) {
  return <article className="paragraph">
    <div className="paragraph-meta"><time>{timestamp(paragraph.captions[0]!.start)}</time>{paragraph.captions.some(c => c.incomplete) && <span>语句未完</span>}</div>
    {paragraph.captions.map(caption => {
      const translated = caption.translationRevision === caption.revision ? caption.translation : undefined;
      return <div className="unit" key={caption.id}>
        {mode !== 'original' && (translated ? <p className="chinese" lang="zh-CN">{translated}</p>
          : mode === 'bilingual' && <p className="chinese pending" aria-label="正在翻译">…</p>)}
        {(mode !== 'translated' || !translated) && <p className={mode === 'original' || mode === 'translated' ? 'english only' : 'english'} lang="en">{caption.text}</p>}
      </div>;
    })}
  </article>;
});

/**
 * Live English, already cut into the rows the settled captions will occupy.
 * Complete rows may carry an early (draft) Chinese, shown dimmed.
 */
export const LiveRows = memo(function LiveRows({ preview, mode, drafts = {} }: { preview?: EnglishPreview; mode: ViewMode; drafts?: DraftTranslations }) {
  const units = previewUnits(preview);
  const rows = units.map((unit, index) => ({ unit, index, zh: drafts[draftKey(unit)] }))
    .filter(row => mode !== 'translated' || row.zh);
  if (!rows.length) return null;
  return <section className="live" aria-label="实时字幕">
    {rows.map(({ unit, index, zh }) => <div className="unit live" key={index}>
      {mode !== 'original' && (zh ? <p className="chinese draft" lang="zh-CN">{zh}</p> : <p className="chinese slot" aria-hidden="true">…</p>)}
      {mode !== 'translated' && <p className={mode === 'original' ? 'english only' : 'english'} lang="en">{unit}{index === units.length - 1 && <span className="caret" aria-hidden="true"/>}</p>}
    </div>)}
  </section>;
});
