"""Real-time WAV replay through the actual WebSocket/translation API.

Run while browser capture is stopped. Caption times are model estimates, not
ground-truth word alignment. This measures behavior, not recognition accuracy.
"""
import argparse
import asyncio
import json
import struct
import time
import wave
from pathlib import Path

import httpx
import numpy as np
import websockets

from nimdaydu.config import ROOT


async def benchmark(wav_path, output, sample_rate=None, pause_at=None, pause_for=0, provider='offline', auto_save=False):
    with wave.open(str(wav_path), 'rb') as audio:
        assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype('<f4') / 32768
    if sample_rate and sample_rate != rate:
        samples = np.interp(np.arange(round(len(samples) * sample_rate / rate)) / sample_rate,
                            np.arange(len(samples)) / rate, samples).astype('<f4')
        rate = sample_rate
    token = json.loads((ROOT / '.nimdaydu/config.json').read_text())['token']
    extension_origin = 'chrome-extension://' + json.loads((ROOT / 'extension/identity.json').read_text())['extensionId']
    events = []
    previews = []
    timeline = []
    last_preview = None
    translations = asyncio.Queue()
    started = time.perf_counter()

    async with httpx.AsyncClient(timeout=22) as client:
        async def translate():
            while True:
                caption = await translations.get()
                if caption is None:
                    return
                request_time = time.perf_counter()
                try:
                    response = await client.post('http://127.0.0.1:8765/translate',
                        headers={'Authorization': f'Bearer {token}'}, json={'provider': 'offline', 'text': caption['text']})
                    response.raise_for_status()
                    caption['translation'] = response.json()['text']
                    caption['translationSeconds'] = round(time.perf_counter() - request_time, 3)
                    caption['bilingualAt'] = round(time.perf_counter() - started, 3)
                    timeline.append({'type': 'translation', 'sessionId': caption['sessionId'],
                        'id': caption['id'], 'revision': caption['revision'], 'text': caption['translation'],
                        'receivedAt': caption['bilingualAt']})
                    if auto_save:
                        saved = await client.post(f"http://127.0.0.1:8765/outputs/{caption['sessionId']}/translations",
                            headers={'Authorization': f'Bearer {token}', 'Origin': extension_origin},
                            json={'updates': [{'id': caption['id'], 'revision': caption['revision'], 'text': caption['translation']}]})
                        saved.raise_for_status()
                        caption['saved'] = True
                except Exception as error:
                    caption['translationError'] = str(error)
                finally:
                    translations.task_done()

        translator = asyncio.create_task(translate())
        async with websockets.connect('ws://127.0.0.1:8765/audio') as socket:
            await socket.send(json.dumps({'type': 'hello', 'sampleRate': rate, 'token': token, 'sentenceHold': .8, 'autoSave': auto_save,
                'source': {'title': 'NimDaydu synthetic audio QA', 'site': '测试网页', 'host': '127.0.0.1'}}))
            assert json.loads(await socket.recv())['type'] == 'ready'
            started = time.perf_counter()

            async def receive():
                nonlocal last_preview
                async for raw in socket:
                    message = json.loads(raw)
                    received_at = round(time.perf_counter() - started, 3)
                    if message['type'] == 'preview':
                        last_preview = {key: message[key] for key in ('sessionId', 'revision', 'text', 'start', 'end')}
                        previews.append({**last_preview, 'receivedAt': received_at})
                        timeline.append({'type': 'preview', 'preview': last_preview, 'receivedAt': received_at})
                    elif message['type'] == 'caption':
                        assert message['final'] and message['revision'] == 1
                        last_preview = {**message.pop('preview'), 'sessionId': message['sessionId']}
                        message['receivedAt'] = received_at
                        message['modelEndToSettled'] = round(message['receivedAt'] - message['end'], 3)
                        timeline.append({'type': 'caption', 'caption': dict(message),
                            'preview': last_preview, 'receivedAt': received_at})
                        events.append(message)
                        # English previews must never make translation requests.
                        if provider == 'offline':
                            translations.put_nowait(message)
                    elif message['type'] == 'error':
                        raise RuntimeError(message['message'])

            receiver = asyncio.create_task(receive())
            chunk_size = round(rate * .08)
            # The trailing silence makes finalization observable before stop.
            padded = np.concatenate([samples, np.zeros(rate * 3, dtype='<f4')])
            delivery_paused = False
            for sequence, offset in enumerate(range(0, len(padded), chunk_size)):
                target = started + offset / rate
                await asyncio.sleep(max(0, target - time.perf_counter()))
                if not delivery_paused and pause_at is not None and offset / rate >= pause_at:
                    # Simulate delayed worklet delivery, without skipping audio.
                    await asyncio.sleep(pause_for)
                    delivery_paused = True
                if receiver.done():
                    await receiver
                chunk = padded[offset:offset + chunk_size]
                await socket.send(struct.pack('<IQ', sequence, offset) + chunk.astype('<f4').tobytes())
            await socket.send(json.dumps({'type': 'stop'}))
            await receiver
        await translations.join()
        await translations.put(None)
        await translator

        health = (await client.get('http://127.0.0.1:8765/health')).json()
        service_audio = health.get('audio')
        service_refinement = health.get('refinement')

    assert events
    assert previews and last_preview is not None and not last_preview['text']
    first_english = next(event['receivedAt'] for event in previews if event['text'])
    if provider == 'offline':
        assert all(event.get('translation') for event in events)
        assert first_english < events[0]['bilingualAt']
        assert sum(event['type'] == 'translation' for event in timeline) == len(events)
    if service_audio:
        assert service_audio['framesReceived'] == service_audio['framesProcessed'] == sequence + 1
    result = {'sample': str(wav_path.name), 'audioSeconds': round(len(samples) / rate, 3),
              'sampleRate': rate, 'provider': provider, 'autoSave': auto_save, 'deliveryPause': {'at': pause_at, 'seconds': pause_for},
              'sentenceHold': .8, 'firstEnglishAt': first_english, 'firstBilingualAt': events[0].get('bilingualAt'),
              'serviceAudio': service_audio, 'serviceRefinement': service_refinement,
              'captions': events, 'previews': previews, 'timeline': timeline}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'audioSeconds': result['audioSeconds'], 'firstEnglishAt': first_english,
                      'firstBilingualAt': result['firstBilingualAt'], 'englishUpdates': len(previews),
                      'sentences': len(events), 'modelEndToSettled': [e['modelEndToSettled'] for e in events],
                      'translationSeconds': [e.get('translationSeconds') for e in events], 'serviceAudio': service_audio,
                      'serviceRefinement': service_refinement}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', type=Path, default=ROOT / 'samples/english.wav')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/benchmark-pipeline.json')
    parser.add_argument('--sample-rate', type=int, choices=[16000, 48000])
    parser.add_argument('--pause-at', type=float)
    parser.add_argument('--pause-for', type=float, default=0)
    parser.add_argument('--provider', choices=['offline', 'none'], default='offline')
    parser.add_argument('--auto-save', action='store_true', help='Also verify session files; disabled by default for benchmarks')
    args = parser.parse_args()
    asyncio.run(benchmark(args.wav, args.output, args.sample_rate, args.pause_at, args.pause_for, args.provider, args.auto_save))
