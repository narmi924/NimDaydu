import type { UiLanguage } from './ui-language';
import { messagesFor } from './ui-messages';
import { memo } from 'react';
import { draftKey, timestamp, type DraftTranslations, type EnglishPreview, type ViewMode } from './types';
import { previewUnits, type Paragraph } from './reader';

export function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const keys = terms.map(term => term.trim()).filter(Boolean);
  if (!keys.length) return text;
  const escaped = keys.sort((a, b) => b.length - a.length).map(key =>
    Array.from(key, c => '.*+?^${}()|[]\\'.includes(c) ? '\\' + c : c).join(''));
  return text.split(new RegExp('(' + escaped.join('|') + ')', 'giu'))
    .map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part);
}

/**
 * One row per caption unit: each English clause sits right under its own
 * Chinese. In bilingual mode the Chinese line is reserved before the
 * translation arrives, so filling it in never pushes the rows around.
 */
export const ParagraphRow = memo(function ParagraphRow({ paragraph, mode, onEdit, match, language }: { paragraph: Paragraph; mode: ViewMode; language: UiLanguage; onEdit?: (id: string) => void; match?: string }) {
  const t = messagesFor(language);
  return <article className="paragraph">
    <div className="paragraph-meta"><time>{timestamp(paragraph.captions[0]!.start)}</time>{paragraph.captions.some(c => c.incomplete) && <span>{t('incomplete')}</span>}</div>
    {paragraph.captions.map(caption => {
      const translated = caption.translationRevision === caption.revision ? caption.translation : undefined;
      function highlight(text: string) {
        return match?.trim() ? <HighlightedText text={text} terms={[match]}/> : text;
      }
      return <div className="unit" data-caption-id={caption.id} key={caption.id}>
        {mode !== 'original' && (translated ? <p className="chinese" lang="zh-CN">{highlight(translated)}</p>
          : mode === 'bilingual' && <p className="chinese pending" aria-label={t('translating')}>…</p>)}
        {(mode !== 'translated' || !translated) && <p className={mode === 'original' || mode === 'translated' ? 'english only' : 'english'} lang="en">{highlight(caption.text)}</p>}
        {match?.trim() && caption.recognizedText?.toLowerCase().includes(match.trim().toLowerCase())
          && !caption.text.toLowerCase().includes(match.trim().toLowerCase()) && <small>{t('recognizedAs')} · {highlight(caption.recognizedText)}</small>}
        {onEdit && <button className="edit-term" title={t('correctTerm')} aria-label={t('correctCaption', caption.text)} onClick={() => onEdit(caption.id)}>{t('editTerm')}</button>}
      </div>;
    })}
  </article>;
});

/**
 * Live English, already cut into the rows the settled captions will occupy.
 * Complete rows may carry an early (draft) Chinese, shown dimmed.
 */
export const LiveRows = memo(function LiveRows({ preview, mode, drafts = {}, language }: { preview?: EnglishPreview; mode: ViewMode; language: UiLanguage; drafts?: DraftTranslations }) {
  const t = messagesFor(language);
  const units = previewUnits(preview);
  const rows = units.map((unit, index) => ({ unit, index, zh: drafts[draftKey(unit)] }))
    .filter(row => mode !== 'translated' || row.zh);
  if (!rows.length) return null;
  return <section className="live" aria-label={t('liveCaptions')}>
    {rows.map(({ unit, index, zh }) => <div className="unit live" key={index}>
      {mode !== 'original' && (zh ? <p className="chinese draft" lang="zh-CN">{zh}</p> : <p className="chinese slot" aria-hidden="true">…</p>)}
      {mode !== 'translated' && <p className={mode === 'original' ? 'english only' : 'english'} lang="en">{unit}{index === units.length - 1 && <span className="caret" aria-hidden="true"/>}</p>}
    </div>)}
  </section>;
});
