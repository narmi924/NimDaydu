import json
import asyncio
import threading
from uuid import uuid4

import pytest

from nimdaydu.outputs import OutputStore


def caption(index=1, text='The complete spoken sentence.'):
    return {'id': f'sentence:{index}', 'revision': 1, 'final': True, 'text': text, 'start': index, 'end': index + 1,
            'preview': {'text': 'must never save this draft'}, 'token': 'must-never-save'}


@pytest.mark.asyncio
async def test_periodic_flush_saves_english_then_late_chinese_without_replacing_good_translation(tmp_path):
    store = OutputStore(tmp_path / 'OUTPUTS'); key = str(uuid4())
    store.begin(key, source={'title': 'Meeting / ../ title', 'site': 'YouTube', 'host': 'youtube.com', 'token': 'must-never-save'})
    store.caption(key, {**caption(), 'final': False})
    store.caption(key, caption())
    assert await store.flush()
    path = next(tmp_path.rglob('session.json'))
    before = json.loads(path.read_text(encoding='utf-8'))
    assert len(before['captions']) == 1 and 'translation' not in before['captions'][0]
    assert 'must never save' not in path.read_text(encoding='utf-8')
    assert 'must-never-save' not in path.read_text(encoding='utf-8')
    store.status(key, 'stopped'); await store.flush()
    store.translations(key, [{'id': 'sentence:1', 'revision': 2, 'text': '过期'},
                             {'id': 'sentence:1', 'revision': 1, 'text': '完整中文。'}])
    store.translations(key, [{'id': 'sentence:1', 'revision': 1, 'text': '不能覆盖'}])
    assert await store.flush()
    after = json.loads(path.read_text(encoding='utf-8'))
    assert after['captions'][0]['translation'] == '完整中文。'
    assert after['status'] == 'stopped'
    assert '完整中文。' in path.with_name('transcript.txt').read_text(encoding='utf-8')
    assert path.is_relative_to(store.directory)
    assert len(list(tmp_path.rglob('session.json'))) == 1


@pytest.mark.asyncio
async def test_disabled_never_creates_files_and_reenable_never_backfills_private_words(tmp_path):
    store = OutputStore(tmp_path / 'OUTPUTS'); key = str(uuid4())
    store.begin(key, enabled=False)
    store.caption(key, caption(text='private words before enabling'))
    await store.flush()
    assert not store.directory.exists()
    store.enable(key, True); store.caption(key, caption(2, 'Saved words.'))
    await store.flush()
    store.enable(key, False); await store.flush()
    store.caption(key, caption(3, 'private words while disabled'))
    store.enable(key, True)
    store.translations(key, [{'id': 'sentence:3', 'revision': 1, 'text': 'private translation'}])
    store.caption(key, caption(4, 'Later words.')); await store.flush()
    content = next(tmp_path.rglob('session.json')).read_text(encoding='utf-8')
    assert 'private' not in content
    assert [c['id'] for c in json.loads(content)['captions']] == ['sentence:2', 'sentence:4']
    assert len(json.loads(content)['savingPeriods']) == 2


@pytest.mark.asyncio
async def test_disk_failure_is_retryable_and_does_not_discard_pending_captions(tmp_path, monkeypatch):
    import nimdaydu.outputs as module
    store = OutputStore(tmp_path); key = str(uuid4()); store.begin(key)
    store.caption(key, caption())
    original = module.write_snapshot
    def fail(*_): raise PermissionError('synthetic disk error')
    monkeypatch.setattr(module, 'write_snapshot', fail)
    assert await store.flush() is False and store.failed
    monkeypatch.setattr(module, 'write_snapshot', original)
    assert await store.flush() is True and not store.failed
    assert len(json.loads(next(tmp_path.rglob('session.json')).read_text())['captions']) == 1


@pytest.mark.asyncio
async def test_session_ids_cannot_escape_output_root(tmp_path):
    store = OutputStore(tmp_path)
    with pytest.raises(ValueError):
        store.begin('/../../outside')


@pytest.mark.asyncio
async def test_cancelled_flush_cannot_race_and_overwrite_a_newer_snapshot(tmp_path, monkeypatch):
    import nimdaydu.outputs as module
    store = OutputStore(tmp_path); key = str(uuid4()); store.begin(key); store.caption(key, caption())
    original = module.write_snapshot
    entered = threading.Event(); release = threading.Event()
    def slow(*args):
        entered.set(); release.wait(2); original(*args)
    monkeypatch.setattr(module, 'write_snapshot', slow)
    first = asyncio.create_task(store.flush())
    assert await asyncio.to_thread(entered.wait, 1)
    store.caption(key, caption(2, 'Later complete sentence.'))
    first.cancel(); second = asyncio.create_task(store.flush())
    await asyncio.sleep(0)
    assert not second.done()
    release.set(); await asyncio.gather(first, return_exceptions=True)
    assert await second
    saved = json.loads(next(tmp_path.rglob('session.json')).read_text())
    assert len(saved['captions']) == 2
