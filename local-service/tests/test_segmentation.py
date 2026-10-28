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


def test_english_drafts_are_immediate_but_translation_sentences_wait_to_settle():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Open the', final=False))
    preview = next(event for event in emitted if event['type'] == 'preview')
    assert preview['text'] == 'Open the' and preview['revision'] == 1
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
    assert captions(emitted)[0]['preview']['text'] == ''
    assert emitted[-1] == {'type': 'pending', 'pending': False}


def test_preview_revision_replaces_words_and_commit_retires_only_its_own_words():
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Open the from', final=False))
    assembler.feed(line('a', 'Open the form.', revision=2))
    assembler.feed(line('b', 'Then check the', final=False, start=1.2, end=2))
    previews = [event for event in emitted if event['type'] == 'preview']
    assert previews[1]['text'] == 'Open the form.'
    assert previews[-1]['text'] == 'Open the form. Then check the'
    now[0] = .9
    assembler.tick()
    committed = captions(emitted)[0]
    assert committed['text'] == 'Open the form.'
    assert committed['preview']['text'] == 'Then check the'
    assert committed['preview']['revision'] > previews[-1]['revision']
    assembler.feed(line('a', 'Late incorrect revision.', revision=100))
    assert len(captions(emitted)) == 1


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


def test_long_sentence_becomes_clause_units_that_translate_separately():
    assembler, now, emitted = setup()
    text = ("I don't want to make you guys wait until the very end of this super long video to talk "
            "about the trade cash cups, so I'll put it up the front.")
    assembler.feed(line('a', text, end=6))
    now[0] = 1
    assembler.tick()
    units = captions(emitted)
    assert [unit['text'] for unit in units] == [
        "I don't want to make you guys wait until the very end of this super long video to talk about the trade cash cups,",
        "so I'll put it up the front."]
    assert [unit['continued'] for unit in units] == [True, False]
    assert units[0]['paragraph'] == units[1]['paragraph']
    assert units[0]['start'] == 0 and units[0]['end'] == units[1]['start'] and units[1]['end'] == 6
    assert units[0]['rawText'] == [text] and units[1]['rawText'] == []
    # Only the last unit retires the preview, so the reader replaces it once.
    assert 'preview' not in units[0] and units[1]['preview']['text'] == ''


def test_short_sentences_and_unbreakable_clauses_stay_whole():
    from nimdaydu.segmentation import split_units
    assert split_units('Make a huge comeback on day number two.') == ['Make a huge comeback on day number two.']
    run_on = 'We spent the whole afternoon reviewing every single field in the booking form together yesterday.'
    assert split_units(run_on) == [run_on]
    parts = split_units("They kind of come into Twitch streamers' chats, or they kind of interact with more people "
                        'on Twitter and kind of announce things in these more informal ways.')
    assert all(len(part.split()) <= 16 for part in parts) and len(parts) == 3


def test_live_preview_is_already_cut_into_stable_rows():
    from nimdaydu.segmentation import split_units
    assembler, now, emitted = setup()
    assembler.feed(line('a', 'Check availability. It is like after you select the package, it shows the departure', final=False))
    preview = [event for event in emitted if event['type'] == 'preview'][-1]
    assert preview['units'] == ['Check availability.', 'It is like after you select the package, it shows the departure']
    # Rows already cut never move as the speaker continues.
    spoken = ("It is like after you select the package, it shows the departure, and then you select the tour group "
              "because the tour group is based on the departure date.")
    words = spoken.split()
    previous = []
    for size in range(1, len(words) + 1):
        units = split_units(' '.join(words[:size]))
        # Only the trailing row may still grow or split; finished rows are kept.
        assert units[:len(previous) - 1] == previous[:-1]
        previous = units
    assert split_units(spoken) == ['It is like after you select the package,', 'it shows the departure, and then you select the tour group',
                                   'because the tour group is based on the departure date.']
