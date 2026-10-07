"""Real-time synthetic WAV replay through the actual WebSocket/translation API.

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


async def benchmark(wav_path, output):
    with wave.open(str(wav_path), 'rb') as audio:
        assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype('<f4') / 32768
    token = json.loads((ROOT / '.nimdaydu/config.json').read_text())['token']
    events = []
    translations = asyncio.Queue()
    started = time.perf_counter()

    async with httpx.AsyncClient(timeout=22) as client:
        async def translate():
            while True:
                caption = await translations.get()
                if caption is None:
                    return
                request_time = time.perf_counter()
                response = await client.post('http://127.0.0.1:8765/translate',
                    headers={'Authorization': f'Bearer {token}'}, json={'provider': 'offline', 'text': caption['text']})
                response.raise_for_status()
                caption['translation'] = response.json()['text']
                caption['translationSeconds'] = round(time.perf_counter() - request_time, 3)
                caption['bilingualAt'] = round(time.perf_counter() - started, 3)
                translations.task_done()

        translator = asyncio.create_task(translate())
        async with websockets.connect('ws://127.0.0.1:8765/audio') as socket:
            await socket.send(json.dumps({'type': 'hello', 'sampleRate': rate, 'token': token, 'sentenceHold': .8}))
            assert json.loads(await socket.recv())['type'] == 'ready'
            started = time.perf_counter()

            async def receive():
                async for raw in socket:
                    message = json.loads(raw)
                    if message['type'] == 'caption':
                        assert message['final'] and message['revision'] == 1
                        message['receivedAt'] = round(time.perf_counter() - started, 3)
                        message['modelEndToSettled'] = round(message['receivedAt'] - message['end'], 3)
                        events.append(message)
                        translations.put_nowait(message)
                    elif message['type'] == 'error':
                        raise RuntimeError(message['message'])

            receiver = asyncio.create_task(receive())
            chunk_size = round(rate * .08)
            # The trailing silence makes finalization observable before stop.
            padded = np.concatenate([samples, np.zeros(rate * 3, dtype='<f4')])
            for sequence, offset in enumerate(range(0, len(padded), chunk_size)):
                target = started + offset / rate
                await asyncio.sleep(max(0, target - time.perf_counter()))
                chunk = padded[offset:offset + chunk_size]
                await socket.send(struct.pack('<IQ', sequence, offset) + chunk.astype('<f4').tobytes())
            await socket.send(json.dumps({'type': 'stop'}))
            await receiver
        await translations.join()
        await translations.put(None)
        await translator

    assert events and all(event.get('translation') for event in events)
    result = {'sample': str(wav_path.name), 'audioSeconds': round(len(samples) / rate, 3),
              'sentenceHold': .8, 'firstBilingualAt': events[0]['bilingualAt'], 'captions': events}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'audioSeconds': result['audioSeconds'], 'firstBilingualAt': result['firstBilingualAt'],
                      'sentences': len(events), 'modelEndToSettled': [e['modelEndToSettled'] for e in events],
                      'translationSeconds': [e['translationSeconds'] for e in events]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', type=Path, default=ROOT / 'samples/english.wav')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/benchmark-pipeline.json')
    args = parser.parse_args()
    asyncio.run(benchmark(args.wav, args.output))
