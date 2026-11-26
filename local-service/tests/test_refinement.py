import threading

import numpy as np

from nimdaydu.protocol import AudioFrame
from nimdaydu.refinement import AudioWindow, RefinedEngine


class Draft:
    def __init__(self, model):
        self.emit = lambda _: None
    def begin(self, emit): self.emit = emit
    def audio(self, frame, rate, behind=False): pass
    def pause(self): pass
    def finish(self): pass
    def close(self): pass


def line(identifier='one'):
    return {'type': 'caption', 'id': identifier, 'revision': 2, 'final': True,
            'text': 'Original spoken words.', 'start': 0, 'end': .08}


def test_window_bounds_memory_and_does_not_join_across_pause_gaps():
    window = AudioWindow(seconds=1)
    for index in range(30):
        window.append(AudioFrame(index, index * 1280, np.ones(1280, dtype=np.float32)), 16000)
    assert sum(len(data) for _, data in window.frames) <= 16000 + 1280
    assert window.slice(0, .08) is None
    assert len(window.slice(2.32, 2.4)) == 1280
    window.append(AudioFrame(30, 160000, np.ones(1280, dtype=np.float32)), 16000)
    assert window.slice(2.32, 10.08) is None
    assert len(window.slice(10, 10.08)) == 1280


class Acoustic:
    def transcribe(self, samples, rate):
        return 'Actual spoken words.', [('Actual', .12, .22), ('spoken', .25, .29), ('words.', .3, .55)]


def packet(index=0, seconds=.8, offset=0):
    return AudioFrame(index, offset, np.full(round(seconds*16000), .05, dtype=np.float32))


def test_audio_without_any_native_draft_is_still_recognized_and_timed():
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Acoustic)
    events = []
    engine.begin(events.append)
    engine.audio(packet(), 16000)
    engine.finish()
    finals = [e for e in events if e.get('final')]
    assert [(e['text'], e['start'], e['end']) for e in finals] == [('Actual spoken words.', .12, .55)]
    assert finals[0]['wordTimes'][2] == ('words.', .3, .55)
    engine.close()


def test_retracting_draft_does_not_cancel_independent_audio_or_leave_stale_preview():
    from nimdaydu.segmentation import SentenceAssembler
    events = []
    assembler = SentenceAssembler(events.append)
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Acoustic)
    engine.begin(assembler.feed)
    engine.audio(packet(), 16000)
    engine.draft.emit({**line(), 'text': 'Noisy live guess', 'final': False})
    assert any(e.get('type') == 'preview' and 'guess' in e['text'] for e in events)
    engine.draft.emit({'type': 'retract', 'id': 'one'})
    engine.pause()
    assembler.flush()
    assert [e['text'] for e in events if e['type'] == 'caption'] == ['Actual spoken words.']
    assert not assembler.lines
    engine.close()


def test_refiner_error_preserves_live_words_and_capture_can_resume():
    class Broken:
        def transcribe(self, *_):
            raise RuntimeError('Unavailable model')
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Broken)
    events = []
    engine.begin(events.append)
    engine.audio(packet(), 16000)
    engine.draft.emit(line())
    engine.pause()
    assert [e['text'] for e in events if e.get('final')] == ['Original spoken words.']
    assert any(e['type'] == 'warning' for e in events)
    engine.audio(packet(1, .8, 32000), 16000)
    engine.draft.emit({**line('two'), 'start': 2, 'end': 2.5, 'text': 'Next.'})
    engine.finish()
    assert [e['start'] for e in events if e.get('final')] == [0, 2]
    engine.close()


def test_timed_out_job_cannot_publish_into_new_session(monkeypatch):
    import nimdaydu.refinement as module
    monkeypatch.setattr(module, 'FINISH_TIMEOUT', .015)
    gate = threading.Event()
    class Slow(Acoustic):
        def transcribe(self, *args):
            gate.wait(2)
            return super().transcribe(*args)
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Slow)
    old = []; engine.begin(old.append)
    engine.audio(packet(), 16000)
    engine.draft.emit(line())
    engine.pause()
    assert len([e for e in old if e.get('final')]) == 1
    new = []; engine.begin(new.append)
    gate.set(); engine.close()
    assert not new


def test_same_words_in_acoustic_context_are_owned_once():
    from nimdaydu.refinement import recognize_region
    class Neighbor:
        def transcribe(self, samples, rate):
            return 'old yes yes next', [('old', 0, .1), ('yes', .75, .85),
                                        ('yes', 1.1, 1.2), ('next', 1.55, 1.65)]
    words = recognize_region(Neighbor(), np.ones(32000, dtype=np.float32), 16000, 0, .5, 1.45)
    assert [w for w, _, _ in words] == ['yes', 'yes']
