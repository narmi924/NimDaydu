import threading

import numpy as np

from nimdaydu.protocol import AudioFrame
from nimdaydu.refinement import AudioWindow, RefinedEngine


class Draft:
    def __init__(self, model):
        self.emit = lambda _: None
    def begin(self, emit): self.emit = emit
    def audio(self, frame, rate): pass
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


def test_second_pass_keeps_drafts_immediate_and_publishes_final_only_after_acoustic_result():
    gate = threading.Event()
    class Refiner:
        def transcribe(self, samples, rate):
            assert len(samples) == 1280 and rate == 16000
            gate.wait(2); return 'Corrected words.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    events = []; engine.begin(events.append)
    engine.audio(AudioFrame(0, 0, np.zeros(1280, dtype=np.float32)), 16000)
    engine.draft.emit(line())
    assert events[0]['text'] == 'Original spoken words.' and events[0]['final'] is False
    gate.set(); engine.pause()
    finals = [e for e in events if e.get('final')]
    assert len(finals) == 1 and finals[0]['text'] == 'Corrected words.' and finals[0]['revision'] == 3
    assert engine.metrics()['completed'] == 1
    engine.close()


def test_refiner_failure_preserves_acoustic_text_and_does_not_stop_capture():
    class Refiner:
        def transcribe(self, *_): raise RuntimeError('Synthetic failure')
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    events = []; engine.begin(events.append)
    engine.audio(AudioFrame(0, 0, np.zeros(1280, dtype=np.float32)), 16000)
    engine.draft.emit(line()); engine.pause()
    assert [e['text'] for e in events if e.get('final')] == ['Original spoken words.']
    assert any(e['type'] == 'warning' for e in events)
    assert not any(e['type'] == 'error' for e in events)
    assert engine.metrics()['failures'] == 1
    engine.close()


def test_refinement_backlog_is_bounded_and_never_publishes_a_sentence_twice():
    gate = threading.Event()
    class Refiner:
        def transcribe(self, *_): gate.wait(2); return 'Refined.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    events = []; engine.begin(events.append)
    engine.audio(AudioFrame(0, 0, np.zeros(1280, dtype=np.float32)), 16000)
    for identifier in ['one', 'two', 'three']:
        engine.draft.emit(line(identifier))
    assert len(engine.tasks) <= 2
    assert [event['id'] for event in events if event.get('final')] == ['three']
    gate.set(); engine.pause()
    finals = [event['id'] for event in events if event.get('final')]
    assert sorted(finals) == ['one', 'three', 'two'] and len(set(finals)) == len(finals)
    engine.close()


def test_pause_timeout_retains_original_and_late_results_cannot_cross_sessions(monkeypatch):
    import nimdaydu.refinement as module
    monkeypatch.setattr(module, 'FINISH_TIMEOUT', .01)
    gate = threading.Event()
    class Refiner:
        def transcribe(self, *_): gate.wait(2); return 'Late old sentence.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    old = []; engine.begin(old.append)
    engine.audio(AudioFrame(0, 0, np.zeros(1280, dtype=np.float32)), 16000)
    engine.draft.emit(line()); engine.pause()
    assert [event['text'] for event in old if event.get('final')] == ['Original spoken words.']
    new = []; engine.begin(new.append)
    gate.set(); engine.close()
    assert not any(event.get('text') == 'Late old sentence.' for event in new + old)


def test_forced_overlapping_native_regions_are_re_recognized_once_as_a_union():
    regions = []
    class Refiner:
        def transcribe(self, samples, rate):
            regions.append(len(samples) / rate)
            return 'A brilliant future opened before them.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    events = []; engine.begin(events.append)
    engine.audio(AudioFrame(0, 0, np.zeros(176000, dtype=np.float32)), 16000)
    engine.draft.emit({**line('first'), 'text': 'A brilliant future opened before', 'start': 0, 'end': 10})
    engine.draft.emit({**line('second'), 'final': False, 'text': 'before them', 'start': 9.5, 'end': 10.8})
    engine.draft.emit({**line('second'), 'text': 'before them.', 'start': 9.5, 'end': 11})
    engine.pause()
    assert regions == [11]
    assert {event['id'] for event in events if event['type'] == 'caption'} == {'first'}
    assert [event['text'] for event in events if event.get('final')] == ['A brilliant future opened before them.']
    engine.close()


def test_shifted_tail_cannot_leave_a_stale_preview_blocking_later_sentences():
    from nimdaydu.segmentation import SentenceAssembler
    class Refiner:
        def transcribe(self, *_): return 'This is complete.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    now = [0.0]
    events = []
    assembler = SentenceAssembler(events.append, clock=lambda: now[0])
    engine.begin(assembler.feed)
    engine.audio(AudioFrame(0, 0, np.zeros(160000, dtype=np.float32)), 16000)
    engine.draft.emit({**line('held'), 'text': 'Got it.', 'start': 0, 'end': 1})
    for revision in range(2, 6):
        engine.draft.emit({**line('tail'), 'revision': revision, 'final': False,
                           'text': 'We are trying', 'start': 1.2, 'end': 2})
    # Native timing can shift forward while the tail is being recognized.
    engine.draft.emit({**line('tail'), 'revision': 6, 'text': 'We are trying this.', 'start': 3, 'end': 4})
    engine.pause()
    now[0] = 3
    assembler.tick()
    assert not assembler.lines
    assert len([event for event in events if event['type'] == 'caption']) == 2
    assert assembler.last_preview[0] == ''
    engine.close()


def test_retracted_live_tail_releases_the_held_acoustic_predecessor():
    from nimdaydu.segmentation import SentenceAssembler
    class Refiner:
        def transcribe(self, samples, rate):
            assert len(samples) == 1280
            return 'The acoustic result.'
    engine = RefinedEngine(draft_factory=Draft, refiner_factory=Refiner)
    now = [0.0]; events = []
    assembler = SentenceAssembler(events.append, clock=lambda: now[0])
    engine.begin(assembler.feed)
    engine.audio(AudioFrame(0, 0, np.zeros(2560, dtype=np.float32)), 16000)
    engine.draft.emit({**line('held'), 'text': 'Got it.'})
    engine.draft.emit({**line('tail'), 'final': False, 'text': 'Noisy temporary words', 'start': .08, 'end': .16})
    engine.draft.emit({'type': 'retract', 'id': 'tail', 'revision': 3})
    engine.pause(); now[0] = 3; assembler.tick()
    assert not assembler.lines
    assert [event['text'] for event in events if event['type'] == 'caption'] == ['The acoustic result.']
    engine.close()
