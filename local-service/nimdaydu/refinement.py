"""Optional acoustic second pass. Audio stays in a bounded RAM window."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import threading
import time
import re

import numpy as np

from .config import ROOT
from .engine import MoonshineEngine
from .segmentation import weak, join_fragments

MODEL_DIR = ROOT / 'models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
FINISH_TIMEOUT = 5.0


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


class ParakeetRefiner:
    def __init__(self):
        import sherpa_onnx
        required = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
        if not all((MODEL_DIR / filename).exists() for filename in required):
            raise RuntimeError('Parakeet weights missing. Run download_refiner.py.')
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(MODEL_DIR / required[0]), decoder=str(MODEL_DIR / required[1]),
            joiner=str(MODEL_DIR / required[2]), tokens=str(MODEL_DIR / required[3]),
            model_type='nemo_transducer', num_threads=4, provider='cpu')

    def transcribe(self, samples, rate):
        stream = self.recognizer.create_stream()
        stream.accept_waveform(rate, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()


class RefinedEngine:
    """Fast Moonshine drafts; serialize Parakeet finalizations separately.

    The acoustic draft never becomes canonical until its second pass completes.
    Errors/overload retain the original acoustic result and report degradation.
    """
    def __init__(self, model='hybrid', draft_factory=MoonshineEngine, refiner_factory=ParakeetRefiner):
        self.refiner = refiner_factory()
        self.draft = draft_factory('small')
        self.model = 'hybrid'
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='nimdaydu-refine')
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.window = AudioWindow()
        self.pending = {}
        self.tasks = set()
        self.generation = 0
        self.emit = lambda _: None
        self.warning = False
        self.held = None
        self.held_live = False
        self.held_at = 0
        self.revisions = {}
        self.stats = {'completed': 0, 'fallbacks': 0, 'failures': 0, 'maxRefinementMs': 0, 'inferenceSeconds': 0.0}

    def begin(self, emit):
        with self.lock:
            self.generation += 1
            self.pending.clear(); self.window.clear()
            self.emit = emit
            self.warning = False
            self.held = None; self.held_live = False; self.revisions.clear()
            self.stats = {'completed': 0, 'fallbacks': 0, 'failures': 0, 'maxRefinementMs': 0, 'inferenceSeconds': 0.0}
        self.draft.begin(self._event)

    def audio(self, packet, rate):
        self.window.append(packet, rate)
        self.draft.audio(packet, rate)
        with self.lock:
            if self.held and not self.held_live and self.window.end / rate - self.held_at >= .8:
                self._flush_held()

    def _fallback(self, message):
        self.stats['fallbacks'] += 1
        self.warning = True
        self.emit({**message, 'final': True, 'revision': message['revision'] + 1})
        self.emit({'type': 'warning', 'message': '整句复核暂未完成，当前使用实时识别结果。'})

    def _event(self, message):
        if message.get('type') == 'retract':
            with self.lock:
                # A retracted live tail must release its held predecessor.
                self._flush_held()
                self.emit(message)
            return
        if message.get('type') != 'caption':
            self.emit(message)
            return
        with self.lock:
            message = dict(message)
            if self.held:
                unfinished = weak(self.held['text']) or not re.search(r'[.!?]["”’]*$', self.held['text'])
                close = message['start'] < self.held['end'] + .1 or (unfinished and message['start'] <= self.held['end'] + 1.5)
                if close and message['end'] - self.held['start'] <= 30:
                    message = {**message, 'id': self.held['id'], 'start': self.held['start'],
                               'text': join_drafts(self.held['text'], message['text'], message['start'] < self.held['end'])}
                    self.held_live = not message['final']
                else:
                    self._flush_held()
            revision = max(message['revision'], self.revisions.get(message['id'], 0) + 1)
            self.revisions[message['id']] = revision
            message['revision'] = revision
            if not message['final']:
                self.emit(message)
                return
            # Moonshine can forcibly split a roughly ten-second region with
            # overlapping timestamps. Re-recognize the union, not each overlap.
            duration = message['end'] - message['start']
            forced = duration >= 9.5 and (not self.held or message['end'] - self.held['end'] >= 9.5)
            if forced or weak(message['text']) or not re.search(r'[.!?]["”’]*$', message['text']):
                self.held = message; self.held_live = False
                self.held_at = self.window.end / self.window.rate
                self.emit({**message, 'final': False})
                return
            self.held = None; self.held_live = False
            self._submit(message)

    def _flush_held(self):
        message = self.held
        self.held = None; self.held_live = False
        if message:
            self._submit(message)

    def _submit(self, message):
        with self.lock:
            if message['id'] in self.pending:
                return
            # A held final may already have lent its ID to several live tail
            # previews. If that tail shifts beyond the merge range, flushing
            # the older held object must supersede those preview revisions.
            # Otherwise the assembler discards its final as stale and blocks
            # every following sentence until the user stops capture.
            revision = max(message['revision'], self.revisions.get(message['id'], 0))
            message = {**message, 'revision': revision}
            self.revisions[message['id']] = revision
            # Keep English readable while the final acoustic pass is pending.
            self.emit({**message, 'final': False})
            samples = self.window.slice(message['start'], message['end'])
            self.tasks = {task for task in self.tasks if not task.done()}
            if samples is None or message['end'] - message['start'] > 30 or len(self.tasks) >= 2:
                self._fallback(message)
                return
            generation = self.generation
            callback = self.emit
            rate = self.window.rate
            future = self.pool.submit(self._recognize, samples, rate)
            self.pending[message['id']] = (future, message)
            self.tasks.add(future)

            def done(task):
                with self.lock:
                    self.tasks.discard(task)
                    current = self.pending.get(message['id'])
                    if generation != self.generation or not current or current[0] is not task:
                        return
                    self.pending.pop(message['id'])
                    try:
                        text, elapsed = task.result()
                        if not text:
                            raise ValueError('Empty acoustic second pass')
                    except Exception:
                        self.stats['failures'] += 1
                        self._fallback(message)
                        self.condition.notify_all()
                        return
                    self.stats['completed'] += 1
                    self.stats['maxRefinementMs'] = max(self.stats['maxRefinementMs'], round(elapsed * 1000))
                    self.stats['inferenceSeconds'] += elapsed
                    callback({**message, 'text': text, 'final': True, 'revision': message['revision'] + 1})
                    if self.warning:
                        self.warning = False
                        callback({'type': 'warning', 'message': ''})
                    self.condition.notify_all()
            future.add_done_callback(done)

    def _recognize(self, samples, rate):
        started = time.perf_counter()
        return self.refiner.transcribe(samples, rate), time.perf_counter() - started

    def pause(self):
        self.draft.pause()
        with self.lock:
            self._flush_held()
        deadline = time.monotonic() + FINISH_TIMEOUT
        with self.condition:
            while self.pending and time.monotonic() < deadline:
                self.condition.wait(timeout=max(0, deadline - time.monotonic()))
            # Bound stop/pause latency. Late second-pass results cannot overwrite
            # already displayed translations or cross into a new session.
            for future, message in list(self.pending.values()):
                self.pending.pop(message['id'], None)
                future.cancel()
                self._fallback(message)
        self.window.clear()

    def finish(self):
        self.pause()
        self.draft.finish()
        with self.lock:
            self.generation += 1
            self.emit = lambda _: None

    def metrics(self):
        with self.lock:
            return {**self.stats, 'pending': len(self.pending), 'inferenceSeconds': round(self.stats['inferenceSeconds'], 3)}

    def close(self):
        self.finish(); self.draft.close()
        self.pool.shutdown(wait=True, cancel_futures=True)


def create_engine(model):
    return RefinedEngine() if model == 'hybrid' else MoonshineEngine(model)
