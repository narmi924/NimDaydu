"""Session transcripts, written off the audio executor. Never stores PCM/drafts."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
from uuid import UUID

SGT = timezone(timedelta(hours=8), 'Asia/Singapore')


def now():
    return datetime.now(SGT).isoformat(timespec='milliseconds')


def stamp(seconds):
    seconds = max(0, int(seconds))
    return f'{seconds // 60:02}:{seconds % 60:02}'


def write_snapshot(directory, document):
    directory.mkdir(parents=True, exist_ok=True)
    text = [f"NimDaydu · {document['source'].get('title') or '网页字幕'}",
            document['startedAt'], f"会话：{document['sessionId']}", '']
    for caption in document['captions']:
        text.append(f"[{stamp(caption['start'])}–{stamp(caption['end'])}]" + (' [语句未完整]' if caption.get('incomplete') else ''))
        text.extend([caption.get('translation') or '[译文未保存]', caption['text'], ''])
    for name, content in [('session.json', json.dumps(document, ensure_ascii=False, indent=2)),
                          ('transcript.txt', '\n'.join(text))]:
        destination = directory / name
        temporary = destination.with_suffix(destination.suffix + '.tmp')
        temporary.write_text(content, encoding='utf-8', errors='replace')
        temporary.replace(destination)


class OutputStore:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        self.sessions = OrderedDict()
        self.lock = asyncio.Lock()
        self.failed = False

    def begin(self, identifier, enabled=True, source=None, model='small'):
        identifier = str(UUID(identifier))
        source = source or {}
        # Titles never enter paths. No URL/query, token or provider credentials.
        source = {key: re.sub(r'[\x00-\x1f]', ' ', str(source.get(key, '')))[:500]
                  for key in ['title', 'site', 'host']}
        created = datetime.now(SGT)
        platform = re.sub(r'[^a-z0-9]+', '-', source['site'].lower()).strip('-')[:24] or 'web'
        path = self.directory / created.strftime('%Y-%m-%d') / f"{created:%Y%m%d-%H%M%S}_{platform}_{identifier}"
        if not path.resolve().is_relative_to(self.directory):
            raise ValueError('Invalid output path')
        self.sessions[identifier] = {'path': path, 'enabled': enabled, 'dirty': enabled, 'failed': False, 'captions': OrderedDict(),
            'document': {'product': 'NimDaydu', 'version': 3, 'sessionId': identifier,
                'startedAt': created.isoformat(timespec='milliseconds'), 'timeZone': 'Asia/Singapore',
                'source': source, 'model': model, 'status': 'capturing', 'autoSaveEnabled': enabled,
                'savingPeriods': [{'from': now(), 'to': None}] if enabled else []}}

    def caption(self, identifier, caption):
        session = self.sessions.get(identifier)
        if not session or not session['enabled'] or not caption.get('final'):
            return
        # The assembler's internal preview must not be saved with the final.
        saved = {key: caption[key] for key in ['id', 'revision', 'final', 'text', 'start', 'end',
                 'paragraph', 'incomplete', 'continued', 'rawText'] if key in caption}
        session['captions'].setdefault(saved['id'], saved)
        session['dirty'] = True

    def translations(self, identifier, updates):
        session = self.sessions.get(identifier)
        if not session:
            raise KeyError(identifier)
        if not session['enabled']:
            return
        for update in updates:
            caption = session['captions'].get(update['id'])
            if caption and caption['revision'] == update['revision'] and not caption.get('translation'):
                session['captions'][update['id']] = {**caption, 'translation': update['text'],
                                                    'translationRevision': update['revision']}
                session['dirty'] = True

    def enable(self, identifier, enabled):
        session = self.sessions[identifier]
        if session['enabled'] == enabled:
            return
        session['enabled'] = enabled
        session['document']['autoSaveEnabled'] = enabled
        if enabled:
            session['document']['savingPeriods'].append({'from': now(), 'to': None})
        elif session['document']['savingPeriods']:
            session['document']['savingPeriods'][-1]['to'] = now()
        # Closing a saving period records its boundary, without backfilling
        # any words spoken while disabled. Existing files are never deleted.
        session['dirty'] = True

    def status(self, identifier, value):
        session = self.sessions.get(identifier)
        if session:
            session['document']['status'] = value
            if value in {'stopped', 'disconnected', 'error'}:
                session['document']['endedAt'] = now()
            if session['enabled']:
                session['dirty'] = True

    async def flush(self, identifier=None):
        async with self.lock:
            failed = False
            for key, session in list(self.sessions.items()):
                if (identifier and identifier != key) or not session['dirty']:
                    continue
                document = {**session['document'], 'savedAt': now(),
                            'savingPeriods': [dict(period) for period in session['document']['savingPeriods']],
                            'captions': list(session['captions'].values())}
                session['dirty'] = False
                try:
                    writing = asyncio.create_task(asyncio.to_thread(write_snapshot, session['path'], document))
                    try:
                        await asyncio.shield(writing)
                    except asyncio.CancelledError:
                        # Cancellation does not stop a filesystem thread. Keep
                        # the lock until it ends so an older write cannot race
                        # the final flush and replace a newer transcript.
                        try:
                            await writing
                        except OSError:
                            session['dirty'] = True; session['failed'] = True
                        raise
                    session['failed'] = False
                except OSError:
                    session['dirty'] = True
                    session['failed'] = True
                    failed = True
            self.failed = any(session['failed'] for session in self.sessions.values())
            # Keep recent stopped sessions for late Chrome translations.
            for key, session in list(self.sessions.items()):
                if len(self.sessions) <= 16:
                    break
                if not session['dirty'] and session['document']['status'] in {'stopped', 'disconnected', 'error'}:
                    self.sessions.pop(key)
            return not failed

    async def run(self):
        while True:
            await asyncio.sleep(1)
            await self.flush()
