"""Optional acoustic second pass. Audio stays in a bounded RAM window."""
from collections import deque
import json
import os
from concurrent.futures import ThreadPoolExecutor
import threading
import time
import re

import numpy as np

from .config import ROOT
from .engine import MoonshineEngine
from .segmentation import join_fragments
from .system import SETUP_SCRIPT

# Second-pass models from the sherpa-onnx releases: name -> (directory, archive SHA256).
REFINERS = {
    'parakeet-v3': ('sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf'),
    'parakeet-v2': ('sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad'),
}
REFINER_CHOICE = ROOT / 'models/refiner.json'
FINISH_TIMEOUT = 5.0


def selected_refiner():
    # Installs from before v0.6 have Parakeet v3 and no choice file.
    if REFINER_CHOICE.exists():
        return json.loads(REFINER_CHOICE.read_text(encoding='utf-8'))['refiner']
    return 'parakeet-v3'


def join_drafts(previous, current, overlap=False):
    if overlap:
        left = list(re.finditer(r"\w+(?:['’-]\w+)*", previous))
        right = list(re.finditer(r"\w+(?:['’-]\w+)*", current))
        for size in range(min(12, len(left), len(right)), 0, -1):
            if [word.group().lower() for word in left[-size:]] == [word.group().lower() for word in right[:size]]:
                return (previous[:left[-size].start()].rstrip() + ' ' + current).strip()
    return join_fragments(previous, current)


class AudioWindow:
    def __init__(self, seconds=90):
        self.seconds = seconds
        self.clear()

    def clear(self):
        self.frames = deque()
        self.rate = 0
        self.end = 0

    def append(self, packet, rate):
        if self.rate != rate or (self.frames and packet.offset != self.end):
            self.clear()
        self.rate = rate
        self.frames.append((packet.offset, packet.samples.copy()))
        self.end = packet.offset + len(packet.samples)
        while self.frames and self.frames[0][0] + len(self.frames[0][1]) <= self.end - rate * self.seconds:
            self.frames.popleft()

    def slice(self, start, end):
        if not self.frames or end <= start:
            return None
        first = round(start * self.rate)
        last = round(end * self.rate)
        if first < self.frames[0][0] or last > self.end or last - first > self.rate * self.seconds:
            return None
        parts = [data[max(0, first - offset):min(len(data), last - offset)]
                 for offset, data in self.frames if offset < last and offset + len(data) > first]
        return np.concatenate(parts) if parts else None


class SherpaRefiner:
    """Re-recognize one finished utterance with Parakeet TDT through sherpa-onnx."""
    def __init__(self, name=None):
        import sherpa_onnx
        self.name = name or selected_refiner()
        directory = ROOT / 'models' / REFINERS[self.name][0]
        if not (directory / 'tokens.txt').exists():
            raise RuntimeError(f'{self.name} weights missing. Run {SETUP_SCRIPT} again.')
        # A quarter of the cores, two to four: a 30 s utterance finishes in
        # about a second while live drafts, the browser and the translator keep
        # theirs (four on a 14-core Intel laptop, two on a 10-core M4).
        threads = min(4, max(2, (os.cpu_count() or 8) // 4))
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(directory / 'encoder.int8.onnx'), decoder=str(directory / 'decoder.int8.onnx'),
            joiner=str(directory / 'joiner.int8.onnx'), tokens=str(directory / 'tokens.txt'),
            model_type='nemo_transducer', num_threads=threads, provider='cpu', blank_penalty=1.25)

    def transcribe(self, samples, rate):
        stream = self.recognizer.create_stream()
        stream.accept_waveform(rate, samples)
        self.recognizer.decode_stream(stream)
        result = stream.result
        spans = []
        for token, start, duration in zip(result.tokens, result.timestamps, result.durations):
            if not spans or token[:1].isspace():
                spans.append([token.strip(), start, start + duration])
            else:
                spans[-1][0] += token
                spans[-1][2] = start + duration
        return result.text.strip(), spans


def recognize_region(model, samples, rate, origin, start, end, speech=()):
    """Recover audible holes by decoding the same sound with different context."""
    if not np.any(samples):
        return []

    def decode(left, right):
        first = max(0, round((left - origin) * rate))
        last = min(len(samples), round((right - origin) * rate))
        if last <= first:
            return []
        text, spans = model.transcribe(samples[first:last], rate)
        if text and not spans:
            raise ValueError('The recognizer returned text without word timestamps.')
        t = origin + first / rate
        return [(w, max(start, t + a), min(end, t + b)) for w, a, b in spans if start <= t + (a + b) / 2 < end]

    primary = decode(origin, origin + len(samples) / rate)
    if not speech:
        return primary
    # A quiet turn can disappear from an otherwise valid result. Only retry a
    # hole when the independent streaming recognizer actually heard words there.
    gaps = zip([start, *(b for _, _, b in primary)], [*(a for _, a, _ in primary), end])
    reread = {}
    for left, boundary in gaps:
        if boundary - left < .85:
            continue
        candidates = [d for d in speech if min(boundary, d['end']) - max(left, d['start']) >= .65]
        if not candidates:
            continue
        region = max(candidates, key=lambda d: min(boundary, d['end']) - max(left, d['start']))
        bounds = region['start'], region['end']
        if bounds not in reread:
            reread[bounds] = decode(*bounds)
        for word, a, b in reread[bounds]:
            mid = (a + b) / 2
            if left <= mid < boundary and not any(
                    abs((x + y) / 2 - mid) < .5 and w.casefold().strip('.,!?') == word.casefold().strip('.,!?')
                    for w, x, y in primary):
                primary.append((word, a, b))
    primary.sort(key=lambda w: w[1])
    return primary


class RefinedEngine:
    """Keep native English drafts live while Parakeet reads every sample in order."""
    STRIDE = 5.6
    HISTORY = 5.0
    LOOKAHEAD = 1.0

    def __init__(self, model='hybrid', draft_factory=None, refiner_factory=SherpaRefiner):
        self.refiner = refiner_factory()
        self.draft = draft_factory('small') if draft_factory else MoonshineEngine('small', max_segment_seconds=6.0)
        self.model = 'hybrid'
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='nimdaydu-refine')
        self.condition = threading.Condition(threading.RLock())
        self.window = AudioWindow()
        self.emit = lambda _: None
        self.pending = {}
        self._reset()

    def _reset(self):
        self.window.clear()
        self.drafts = {}
        self.sequence = self.revision = 0
        self.next_start = self.confirmed = self.boundary = None
        self.last_preview = None
        self.last_word = None
        self.quiet_seconds = self.recent_level = 0.0
        self.stats = {'completed': 0, 'fallbacks': 0, 'failures': 0, 'maxRefinementMs': 0, 'inferenceSeconds': 0.0}

    def begin(self, emit):
        with self.condition:
            self._reset()
            self.emit = emit
        self.draft.begin(self._event)

    def _tail(self, start, end):
        parts = []
        for d in self.drafts.values():
            if d['end'] <= start or d['start'] >= end:
                continue
            # Only the provisional display uses estimated word positions.
            # The immutable subtitle below uses Parakeet token timestamps.
            tokens = d['text'].split()
            span = max(.001, d['end'] - d['start'])
            a = max(0, round((start - d['start']) / span * len(tokens)))
            b = len(tokens) if end >= d['end'] else max(0, round((end - d['start']) / span * len(tokens)))
            if tokens[a:b]:
                parts.append((d, ' '.join(tokens[a:b])))
        if not parts:
            return None
        text = ''
        last_end = 0
        for d, portion in parts:
            text = join_drafts(text, portion, d['start'] < last_end) if text else portion
            last_end = d['end']
        return {'text': text, 'start': max(start, parts[0][0]['start']), 'end': min(end, last_end),
                'inferenceMs': parts[-1][0].get('inferenceMs', 0), 'speechEnded': parts[-1][0]['final']}

    def _publish_preview(self):
        tail = self._tail(self.confirmed or 0, float('inf'))
        if tail == self.last_preview:
            return
        self.last_preview = tail
        self.revision += 1
        base = {'id': f'audio:{self.sequence}', 'revision': self.revision}
        self.emit({'type': 'caption', **base, **tail, 'final': False} if tail else {'type': 'retract', **base})

    def _event(self, message):
        with self.condition:
            if message['type'] == 'retract':
                self.drafts.pop(message['id'], None)
            elif message['type'] == 'caption':
                if message['end'] <= (self.confirmed or 0):
                    return
                self.drafts[message['id']] = message
            else:
                self.emit(message)
                return
            self._publish_preview()

    def audio(self, packet, rate, behind=False):
        with self.condition:
            self.window.append(packet, rate)
            if self.next_start is None:
                self.confirmed = self.next_start = packet.offset / rate
        self.draft.audio(packet, rate, behind)
        with self.condition:
            now = self.window.end / rate
            seconds = len(packet.samples) / rate
            rms = float(np.sqrt(np.mean(np.square(packet.samples))))
            self.recent_level = max(rms, self.recent_level * .5 ** (seconds / 1.5))
            quiet = self.recent_level > .001 and rms < min(.008, self.recent_level * .18)
            self.quiet_seconds = self.quiet_seconds + seconds if quiet else 0
            if len(self.pending) >= 2:
                return
            if self.boundary is None and self.quiet_seconds >= .36 and now - self.next_start >= 3.2:
                self.boundary = now - .16
            end = min(self.next_start + self.STRIDE, self.boundary or now)
            if now >= end + self.LOOKAHEAD:
                self._submit(end)
                self.boundary = None

    def _submit(self, end):
        start = self.next_start
        if start is None or end <= start:
            return
        rate = self.window.rate
        origin = max(self.window.frames[0][0] / rate, start - self.HISTORY)
        samples = self.window.slice(origin, min(self.window.end / rate, end + self.LOOKAHEAD))
        self.next_start = end
        speech = [d for d in self.drafts.values() if d['start'] < end and d['end'] > start]
        submitted = time.perf_counter()
        def recognize():
            began = time.perf_counter()
            if samples is None:
                raise ValueError('Audio no longer buffered')
            result = recognize_region(self.refiner, samples, rate, origin, start, end, speech)
            return result, began - submitted, time.perf_counter() - began
        future = self.pool.submit(recognize)
        self.pending[future] = (start, end)
        def done(task):
            with self.condition:
                if self.pending.pop(task, None) is None:
                    return
                try:
                    owned, queued, cost = task.result()
                    if self.last_word and owned:
                        w, a, _ = owned[0]
                        old, _, b = self.last_word
                        if w.casefold().strip('.,!?') == old.casefold().strip('.,!?') and a < b + .05:
                            owned.pop(0)
                    if owned:
                        self.last_word = owned[-1]
                    self.stats['completed'] += 1
                    self.stats['inferenceSeconds'] += cost
                    self.stats['maxRefinementMs'] = max(self.stats['maxRefinementMs'], round(cost * 1000))
                    result = {'text': ' '.join(w[0] for w in owned), 'start': owned[0][1], 'end': owned[-1][2],
                              'wordTimes': owned, 'refineMs': round(cost*1000), 'refineQueueMs': round(queued*1000)} if owned else None
                except Exception:
                    self.stats['failures'] += 1
                    result = self._fallback(start, end)
                self._commit(end, result)
                self.condition.notify_all()
        future.add_done_callback(done)

    def _fallback(self, start, end):
        self.stats['fallbacks'] += 1
        self.emit({'type': 'warning', 'message': '这段原音复核失败，保留实时识别结果。'})
        return self._tail(start, end)

    def _commit(self, end, result):
        base = {'id': f'audio:{self.sequence}', 'revision': self.revision + 1}
        if result:
            self.emit({'type': 'caption', **base, **result, 'final': True})
        elif self.last_preview:
            self.emit({'type': 'retract', **base})
        self.sequence += 1
        self.revision = 0
        self.confirmed = end
        self.last_preview = None
        self.drafts = {k: d for k, d in self.drafts.items() if d['end'] > end}
        self._publish_preview()

    def pause(self):
        self.draft.pause()
        with self.condition:
            if self.window.frames:
                self._submit(self.window.end / self.window.rate)
            self.condition.wait_for(lambda: not self.pending, timeout=FINISH_TIMEOUT)
            for future, (start, end) in list(self.pending.items()):
                self.pending.pop(future)
                future.cancel()
                self._commit(end, self._fallback(start, end))
            self.window.clear()
            self.drafts.clear()
            self.last_preview = self.next_start = self.confirmed = self.last_word = self.boundary = None
            self.quiet_seconds = self.recent_level = 0

    def finish(self):
        self.pause()
        self.draft.finish()

    def metrics(self):
        with self.condition:
            return {**self.stats, 'pending': len(self.pending), 'refiner': getattr(self.refiner, 'name', 'parakeet')}

    def close(self):
        self.finish()
        self.draft.close()
        self.pool.shutdown(wait=True, cancel_futures=True)


def create_engine(model):
    return RefinedEngine() if model == 'hybrid' else MoonshineEngine(model)
