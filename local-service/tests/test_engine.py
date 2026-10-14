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
