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
CLAUSE_BOUNDARY = re.compile(r'(?<=[,;:])\s+|\s+(?=(?:and|but|so|because|which|when|while|if|then|or|although|though|whereas)\b)', re.I)


def clean(text):
    return re.sub(r'\s+([,.!?;:])', r'\1', re.sub(r'\s+', ' ', text)).strip()


def words(text):
    return re.findall(r"[\w]+(?:['’-][\w]+)*", text.lower())


def weak(text):
    bare = text.lower().strip(' .,!?:;')
    if re.search(r"\b(?:not|never|\w+n['’]t)\s*$", text, re.I):
        return True
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
    pieces, start = [], 0
    for boundary in CLAUSE_BOUNDARY.finditer(text):
        left, rest = text[start:boundary.start()], text[boundary.end():]
        strong = left.endswith((',', ';', ':')) or re.match(r'(?:but|because|although|whereas)\b', rest, re.I)
        # Give the next clause room to start. Two-word tails such as "and again"
        # belong with the preceding phrase. Uniform lookahead keeps cuts stable.
        if (len(words(left)) >= (8 if strong else 10) and len(words(rest)) >= 3
                and not weak(left) and not date_continuation(left, rest)):
            pieces.append(left)
            start = boundary.end()
    pieces.append(text[start:])
    return pieces


def display_units(text):
    """Sentences, then clause units: the rows a caption occupies on screen."""
    return [unit for sentence in split_sentences(text) if sentence.strip() for unit in split_units(sentence.strip())]


def timed_parts(parts, start, end, spans):
    """Use token timings when they cover the displayed words exactly."""
    if spans and words(' '.join(s[0] for s in spans)) == words(' '.join(parts)) and all(words(p) for p in parts):
        timed = [(s[1], s[2]) for s in spans for _ in words(s[0])]
        index = 0
        for part in parts:
            count = len(words(part))
            yield timed[index][0], timed[index + count - 1][1]
            index += count
        return
    total = sum(map(len, parts))
    offset = 0
    for part in parts:
        left = start + (end - start) * offset / total
        offset += len(part)
        yield left, start + (end - start) * offset / total


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
        self.last_preview = ('', 0, 0, False)

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
        ended = bool(lines and (lines[-1]['final'] or lines[-1].get('speechEnded')) and not weak(lines[-1]['text']))
        value = (text, lines[0]['start'] if lines else 0, lines[-1]['end'] if lines else 0, ended)
        if value != self.last_preview:
            self.preview_revision += 1
            self.last_preview = value
        # Already cut like settled captions, so the live rows do not reflow
        # from one long paragraph into sentences when the final arrives.
        return {'revision': self.preview_revision, 'text': value[0], 'units': display_units(value[0]),
                'start': value[1], 'end': value[2], 'speechEnded': ended}

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
                replacements = []
                spans = normalized.get('wordTimes', [])
                bounds = timed_parts(pieces, normalized['start'], normalized['end'], spans)
                for index, (piece, (start, end)) in enumerate(zip(pieces, bounds)):
                    replacements.append((f'{identifier}/part:{index}', {**normalized, 'id': f'{identifier}/part:{index}', 'text': piece,
                        'start': start, 'end': end, 'wordTimes': [s for s in spans if start <= s[1] and s[2] <= end]}))
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
                    if self.clock() - group[-1]['_received'] < max(self.hold, 1.8):
                        return
                    break
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
        latest = max(group, key=lambda line: line['_received'])
        spans = [s for line in group for s in line.get('wordTimes', [])]
        bounds = timed_parts(units, first['start'], last['end'], spans)
        for index, (unit, (start, end)) in enumerate(zip(units, bounds)):
            final_unit = index == len(units) - 1
            self.counter += 1
            message = {'type': 'caption', 'id': f'sentence:{self.counter}', 'revision': 1, 'final': True,
                       'text': unit, 'paragraph': self.paragraph,
                       'start': start, 'end': end,
                       'incomplete': incomplete and final_unit, 'continued': not final_unit,
                       'rawText': [line['text'] for line in group] if index == 0 else [],
                       'inferenceMs': max(line.get('inferenceMs', 0) for line in group)}
            # A joined caption waits for the last contributing acoustic pass to arrive.
            for key in ('refineMs', 'refineQueueMs'):
                if key in latest:
                    message[key] = latest[key]
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
