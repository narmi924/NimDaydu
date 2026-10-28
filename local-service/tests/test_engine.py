from types import SimpleNamespace

from moonshine_voice.transcriber import LineCompleted, LineTextChanged

from nimdaydu.engine import MoonshineEngine
from nimdaydu.segmentation import SentenceAssembler


def event(identifier, text, final=False):
    line = SimpleNamespace(line_id=identifier, text=text, is_complete=final,
                           start_time=identifier * 2, duration=1, last_transcription_latency_ms=1)
    return (LineCompleted if final else LineTextChanged)(line=line, stream_handle=1)


def engine(emit):
    result = MoonshineEngine.__new__(MoonshineEngine)
    result.epoch = 1; result.base_seconds = 0; result.revisions = {}; result.emit = emit
    return result


def test_empty_acoustic_final_retracts_draft_and_releases_following_good_sentences():
    now = [0.0]; events = []
    assembler = SentenceAssembler(events.append, clock=lambda: now[0])
    speech = engine(assembler.feed)
    speech._event(event(1, 'Provisional noisy words'))
    speech._event(event(2, 'This is complete.', True))
    now[0] = 2; assembler.tick()
    assert not any(e['type'] == 'caption' for e in events)
    speech._event(event(1, '', True))
    assert not assembler.lines
    assert [e['text'] for e in events if e['type'] == 'caption'] == ['This is complete.']
    assert not any(e['type'] == 'retract' for e in events)


def test_temporarily_empty_hypothesis_can_resume_with_a_new_revision():
    events = []; speech = engine(events.append)
    speech._event(event(1, 'Maybe'))
    speech._event(event(1, ''))
    speech._event(event(1, 'The final spoken sentence.', True))
    assert [e['type'] for e in events] == ['caption', 'retract', 'caption']
    assert [e['revision'] for e in events] == [1, 2, 3]


def test_empty_late_event_does_not_revoke_already_finalized_words():
    events = []; speech = engine(events.append)
    speech._event(event(1, 'The final spoken sentence.', True))
    speech._event(event(1, '', True))
    assert len(events) == 1 and events[0]['final']


class Stream:
    def __init__(self, cost):
        self.cost = cost
        self.passes = []
        self.audio = 0

    def add_audio(self, samples, rate):
        self.audio += len(samples)

    def update_transcription(self):
        self.passes.append(self.audio)
        self.cost[1] += self.cost[0]


def scheduled(monkeypatch, seconds_per_pass):
    clock = [0.0, 0.0]
    cost = [seconds_per_pass, 0.0]
    monkeypatch.setattr('nimdaydu.engine.time.perf_counter', lambda: cost[1])
    speech = engine(lambda _: None)
    speech.stream = Stream(cost)
    speech.stream_seconds = speech.updated_at = speech.last_pass = 0.0
    return speech, speech.stream


def frames(speech, count, behind=False):
    from nimdaydu.protocol import AudioFrame
    import numpy as np
    for index in range(count):
        speech.audio(AudioFrame(index, index * 1280, np.zeros(1280, dtype=np.float32)), 16000, behind)


def test_cheap_draft_passes_keep_the_half_second_floor(monkeypatch):
    speech, stream = scheduled(monkeypatch, .05)
    frames(speech, 50)  # 4 s of audio in 80 ms frames
    # The first frame at or past each 0.5 s mark runs a pass.
    assert stream.passes == [7 * 1280 * n for n in range(1, 8)]


def test_expensive_passes_leave_headroom_instead_of_pinning_a_core(monkeypatch):
    speech, stream = scheduled(monkeypatch, 1.2)
    frames(speech, 125)  # 10 s of audio
    gaps = [b - a for a, b in zip(stream.passes, stream.passes[1:])]
    # Each pass waits for 1.5x its own cost in audio: at most 2/3 of a core.
    assert all(gap / 16000 >= 1.8 - .08 for gap in gaps)


def test_backlog_skips_draft_passes_until_caught_up(monkeypatch):
    speech, stream = scheduled(monkeypatch, .05)
    frames(speech, 40, behind=True)
    assert stream.passes == []
    frames(speech, 1)
    assert stream.passes == [41 * 1280]
