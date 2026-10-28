"""Conservative sentence assembly, independent of the acoustic VAD boundaries.

No generated words: merge recognized fragments, normalize whitespace and
punctuation, and publish immutable sentences after a short settling window.
Publish revisioned English previews immediately, outside the translation flow.
"""
import re
import time
from collections import OrderedDict

HOLD_SECONDS = 0.8
PREFIXES = {'next', 'so', 'and', 'but', 'however', 'well', 'then', 'for example', 'i think', 'let me', 'because', 'although'}
STANDALONE = {'yes', 'no', 'okay', 'ok', 'thanks', 'thank you', 'sure', 'right', 'agreed', 'exactly', 'hello', 'goodbye'}
MONTHS = r'(?:january|february|march|april|may|june|july|august|september|october|november|december)'
# Subtitle-sized units: about two short lines. Longer sentences are cut at
# clause boundaries so each part is translated and shown as soon as possible.
MAX_UNIT_WORDS = 16
UNIT_TARGET_WORDS = 8
MIN_UNIT_WORDS = 5
CLAUSE_BOUNDARY = re.compile(r'(?<=[,;:])\s+|\s+(?=(?:and|but|so|because|which|when|while|if|then|or|although|though|whereas)\b)', re.I)


def clean(text):
    return re.sub(r'\s+([,.!?;:])', r'\1', re.sub(r'\s+', ' ', text)).strip()


def words(text):
    return re.findall(r"[\w]+(?:['’-][\w]+)*", text.lower())


def weak(text):
    bare = text.lower().strip(' .,!?:;')
    return bare in PREFIXES or (len(words(text)) < 3 and bare not in STANDALONE) or bool(re.search(r'\b(?:and|but|because|the|a|an|to|of|with|will|would|can|could|is|are|was|were)\W*$', text, re.I)) or bool(re.search(r'\b(?:Mr|Mrs|Dr|Prof|e\.g|i\.e)\.$', text, re.I))


def date_continuation(previous, current):
    return bool(re.search(r'\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,.!?]*$', previous, re.I)
                and re.match(MONTHS + r'\b', current, re.I))


def split_sentences(text):
    # The acoustic model can finalize several sentences in one line, or join
    # a short date with a following discourse marker. Keep every spoken word.
    text = re.sub(r'^(' + MONTHS + r'\b.+?)\s+(Next|However|Finally)\.?$', r'\1. \2.', text, flags=re.I)
    result = []
    start = 0
    for boundary in re.finditer(r'(?<=[.!?])\s+(?=[A-Za-z])', text):
        previous = text[start:boundary.start()]
        if re.search(r'\b(?:Mr|Mrs|Dr|Prof|e\.g|i\.e|Inc|Ltd|Co|etc|[A-Z])\.$', previous, re.I):
            continue
        result.append(previous)
        start = boundary.end()
    result.append(text[start:])
    return result


def split_units(text):
    """Cut a long sentence at clause boundaries, never inside a clause.

    Greedy from the left, so applying the same rule to a sentence that is
    still being spoken gives the same cuts: rows already shown stay put while
    words arrive, and the settled caption lands where its draft was.
    """
    if len(words(text)) <= MAX_UNIT_WORDS:
        return [text]
    pieces, start = [], 0
    for boundary in CLAUSE_BOUNDARY.finditer(text):
        left, rest = text[start:boundary.start()], text[boundary.end():]
        if len(words(left)) >= UNIT_TARGET_WORDS and len(words(rest)) >= MIN_UNIT_WORDS:
            pieces.append(left)
            start = boundary.end()
    pieces.append(text[start:])
    return pieces


def display_units(text):
    """Sentences, then clause units: the rows a caption occupies on screen."""
    return [unit for sentence in split_sentences(text) if sentence.strip() for unit in split_units(sentence.strip())]


def continuation(previous, current):
    if weak(previous) or date_continuation(previous, current):
        return True
    return not re.search(r'[.!?]["\u201d\u2019]*$', previous) and bool(re.match(r'(?:and|or|but|because|which|that|to|with)\b', current, re.I))


def join_fragments(previous, current):
    if date_continuation(previous, current) or previous.lower().strip(' .,!?:;') in PREFIXES:
        return previous.rstrip(' .,!?:;') + ', ' + current
    if re.search(r'\b(?:Mr|Mrs|Dr|Prof|e\.g|i\.e)\.$', previous, re.I):
        return previous + ' ' + current
    return previous.rstrip(' .!?') + ' ' + current


class SentenceAssembler:
    def __init__(self, emit, clock=time.monotonic, hold=HOLD_SECONDS):
        self.emit = emit
        self.clock = clock
        self.hold = hold
        self.lines = OrderedDict()
        self.committed = set()
        self.finalized = set()
        self.counter = 0
        self.paragraph = 0
        self.paragraph_size = 0
        self.last_end = None
        self.pending = False
        self.preview_revision = 0
        self.last_preview = ('', 0, 0)

    def _preview_snapshot(self):
        lines = list(self.lines.values())
        text = ''
        previous = None
        for line in lines:
            if text and previous and line['start'] - previous['end'] <= 1.5 and continuation(text, line['text']):
                text = join_fragments(text, line['text'])
            else:
                text = (text + ' ' + line['text']).strip()
            previous = line
        value = (text, lines[0]['start'] if lines else 0, lines[-1]['end'] if lines else 0)
        if value != self.last_preview:
            self.preview_revision += 1
            self.last_preview = value
        # Already cut like settled captions, so the live rows do not reflow
        # from one long paragraph into sentences when the final arrives.
        return {'revision': self.preview_revision, 'text': value[0], 'units': display_units(value[0]),
                'start': value[1], 'end': value[2]}

    def _publish_preview(self):
        previous_revision = self.preview_revision
        snapshot = self._preview_snapshot()
        if snapshot['revision'] != previous_revision:
            # English updates never enter the translation queue. A settled
            # caption later replaces the matching preview in one event.
            self.emit({'type': 'preview', **snapshot})

    def _pending(self):
        value = bool(self.lines)
        if value != self.pending:
            self.pending = value
            self.emit({'type': 'pending', 'pending': value})

    def feed(self, message):
        if message.get('type') == 'retract':
            line = self.lines.get(message['id'])
            if line and not line['final'] and message['revision'] > line['revision']:
                self.lines.pop(message['id'])
                self._pending()
                self._publish_preview()
                self.tick()
            return
        if message.get('type') != 'caption':
            self.emit(message)
            return
        identifier = message['id']
        if not message['text'].strip():
            return
        if identifier in self.committed or identifier in self.finalized:
            return
        previous = self.lines.get(identifier)
        if previous and message['revision'] <= previous['revision']:
            return
        normalized = {**message, 'text': clean(message['text']), '_received': self.clock()}
        if message['final']:
            self.finalized.add(identifier)
            pieces = split_sentences(normalized['text'])
            if len(pieces) > 1:
                duration = max(0, normalized['end'] - normalized['start'])
                total = sum(len(piece) for piece in pieces)
                offset = 0
                replacements = []
                for index, piece in enumerate(pieces):
                    replacements.append((f'{identifier}/part:{index}', {**normalized, 'id': f'{identifier}/part:{index}', 'text': piece,
                        'start': normalized['start'] + duration * offset / total,
                        'end': normalized['start'] + duration * (offset + len(piece)) / total}))
                    offset += len(piece)
                items = list(self.lines.items())
                self.lines.clear()
                placed = False
                for key, value in items:
                    if key == identifier:
                        self.lines.update(replacements); placed = True
                    else:
                        self.lines[key] = value
                if not placed:
                    self.lines.update(replacements)
            else:
                self.lines[identifier] = normalized
        else:
            self.lines[identifier] = normalized
        self._pending()
        self._publish_preview()
        self.tick()

    def tick(self):
        while self.lines:
            ordered = list(self.lines.values())
            first = ordered[0]
            if not first['final']:
                return
            group = [first]
            text = first['text']
            for next_line in ordered[1:]:
                gap = next_line['start'] - group[-1]['end']
                if gap > 1.5 or not continuation(text, next_line['text']):
                    break
                if not next_line['final']:
                    # Only a plausible continuation may delay a finalized line.
                    # It will be re-evaluated on the next model update.
                    return
                text = join_fragments(text, next_line['text'])
                group.append(next_line)
            last = group[-1]
            quiet = self.clock() - last['_received']
            date_tail = bool(re.search(r'\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)[.!?]*$', text, re.I))
            wait = max(self.hold, 1.8) if weak(text) or date_tail else self.hold
            if quiet < wait:
                return
            self._commit(group, text, incomplete=weak(text))

    def _commit(self, group, text, incomplete=False):
        first, last = group[0], group[-1]
        text = clean(text)
        if incomplete:
            text = text.rstrip(' .!?') + '…'
        elif not re.search(r'[.!?]["\u201d\u2019]*$', text):
            text += '.'
        gap = first['start'] - self.last_end if self.last_end is not None else 99
        topic = bool(re.match(r'(?:next|now|moving on|on another|finally|in summary)\b', text, re.I))
        if gap > 1.8 or topic or self.paragraph_size >= 3:
            self.paragraph += 1
            self.paragraph_size = 0
        self.paragraph_size += 1
        self.last_end = last['end']
        for line in group:
            self.lines.pop(line['id'], None)
            self.committed.add(line['id'])
        units = split_units(text)
        total = sum(len(unit) for unit in units)
        duration = max(0, last['end'] - first['start'])
        offset = 0
        for index, unit in enumerate(units):
            final_unit = index == len(units) - 1
            self.counter += 1
            message = {'type': 'caption', 'id': f'sentence:{self.counter}', 'revision': 1, 'final': True,
                       'text': unit, 'paragraph': self.paragraph,
                       # Times inside one acoustic span are estimated by text length.
                       'start': first['start'] + duration * offset / total,
                       'end': last['end'] if final_unit else first['start'] + duration * (offset + len(unit)) / total,
                       'incomplete': incomplete and final_unit, 'continued': not final_unit,
                       'rawText': [line['text'] for line in group] if index == 0 else [],
                       'inferenceMs': max(line.get('inferenceMs', 0) for line in group)}
            offset += len(unit)
            if final_unit:
                message['preview'] = self._preview_snapshot()
            self.emit(message)
        self._pending()

    def flush(self):
        # Pause/stop must not lose the last recognized words. Mark fragments
        # that do not form a complete thought instead of pretending certainty.
        while self.lines:
            ordered = list(self.lines.values())
            group = [ordered[0]]
            text = group[0]['text']
            for line in ordered[1:]:
                if line['start'] - group[-1]['end'] > 1.5 or not continuation(text, line['text']):
                    break
                group.append(line)
                text = join_fragments(text, line['text'])
            self._commit(group, text, incomplete=weak(text) or any(not line['final'] for line in group))
