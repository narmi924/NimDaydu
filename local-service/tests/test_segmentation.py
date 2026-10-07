from nimdaydu.segmentation import SentenceAssembler


def setup():
    now = [0.0]
    emitted = []
    assembler = SentenceAssembler(emitted.append, clock=lambda: now[0])
    return assembler, now, emitted


def line(identifier, text, final=True, revision=1, start=0, end=1):
    return {'type': 'caption', 'id': identifier, 'text': text, 'final': final,
            'revision': revision, 'start': start, 'end': end}


def captions(emitted):
    return [event for event in emitted if event['type'] == 'caption']


def test_drafts_never_escape_and_final_sentence_waits_to_settle():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Open the', final=False))
    now[0] = 2
    assembler.tick()
    assert not captions(emitted)
    assembler.feed(line('a', 'Open the application form.', revision=2))
    now[0] = 2.7
    assembler.tick()
    assert not captions(emitted)
    now[0] = 2.9
    assembler.tick()
    assert captions(emitted)[0]['text'] == 'Open the application form.'
    assert emitted[-1] == {'type': 'pending', 'pending': False}


def test_short_prefix_and_continuation_form_one_sentence():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Next.', start=0, end=.5))
    now[0] = .7
    assembler.feed(line('b', 'We will review the code.', start=.6, end=2))
    now[0] = 1.6
    assembler.tick()
    assert len(captions(emitted)) == 1
    assert captions(emitted)[0]['text'] == 'Next, We will review the code.'
    assert captions(emitted)[0]['rawText'] == ['Next.', 'We will review the code.']


def test_date_fragments_merge_and_numbers_are_preserved():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'The deadline is Friday.', end=1))
    now[0] = .5
    assembler.feed(line('b', 'October ninth, at 3.5 hours.', start=1.1, end=2))
    now[0] = 1.4
    assembler.tick()
    assert captions(emitted)[0]['text'] == 'The deadline is Friday, October ninth, at 3.5 hours.'


def test_pause_breaks_paragraph_and_prevents_unrelated_fragment_merge():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Next.', end=.3))
    assembler.feed(line('b', 'A new topic starts here.', start=4, end=5))
    now[0] = 2
    assembler.tick()
    result = captions(emitted)
    assert len(result) == 2 and result[0]['incomplete'] is True
    assert result[0]['paragraph'] != result[1]['paragraph']


def test_late_revisions_do_not_rewrite_a_committed_sentence():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'The price is 10 dollars.'))
    now[0] = .9
    assembler.tick()
    assembler.feed(line('a', 'The price is 100 dollars.', revision=2))
    assembler.flush()
    assert [c['text'] for c in captions(emitted)] == ['The price is 10 dollars.']


def test_flush_preserves_unfinished_words_without_inventing_a_complete_sentence():
    assembler, _, emitted = setup()
    assembler.feed(line('a', 'We will', final=False))
    assembler.flush()
    assert captions(emitted)[0]['text'] == 'We will…'
    assert captions(emitted)[0]['incomplete'] is True


def test_abbreviation_remains_intact_and_blank_drafts_are_ignored():
    assembler, now, emitted = setup()
    assembler.feed(line('empty', '  '))
    assembler.feed(line('a', 'Ask Dr.', end=1))
    assembler.feed(line('b', 'Smith about the release.', start=1.1, end=2))
    now[0] = .9
    assembler.tick()
    assert captions(emitted)[0]['text'] == 'Ask Dr. Smith about the release.'


def test_one_acoustic_line_can_contain_separate_complete_sentences():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Ask Dr. Smith to review v1.2. then open the form.', end=4))
    now[0] = .9
    assembler.tick()
    result = captions(emitted)
    assert [c['text'] for c in result] == ['Ask Dr. Smith to review v1.2.', 'then open the form.']
    assert result[0]['end'] == result[1]['start']


def test_date_continuation_gets_time_to_arrive_and_topic_marker_stays_separate():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'The deadline is Friday.', end=1))
    now[0] = 1.2
    assembler.tick()
    assert not captions(emitted)
    assembler.feed(line('b', 'October ninth Next.', start=1.2, end=2))
    assembler.feed(line('c', 'We will review the code.', start=2.1, end=3))
    now[0] = 2.1
    assembler.tick()
    assert [c['text'] for c in captions(emitted)] == ['The deadline is Friday, October ninth.', 'Next, We will review the code.']
    assert captions(emitted)[0]['paragraph'] != captions(emitted)[1]['paragraph']
