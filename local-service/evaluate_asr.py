"""Reproducible public-speech comparison; never records the user's audio.

Run with the optional evaluation dependencies documented in README.md.
LibriSpeech is read speech, not a substitute for a real meeting acceptance test.
"""
import argparse
import hashlib
import json
import os
import re
import tarfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import jiwer
import numpy as np
import psutil
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'artifacts/asr-evaluation'
PARAKEET = ROOT / 'models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'
NORMALIZE = jiwer.Compose([jiwer.ToLowerCase(), jiwer.RemovePunctuation(), jiwer.RemoveMultipleSpaces(), jiwer.Strip()])


def prepare(seconds):
    DATA.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=90, follow_redirects=True) as client:
        if not PARAKEET.exists():
            archive = DATA / 'parakeet.tar.bz2'
            if not archive.exists():
                temporary = archive.with_suffix('.part')
                with client.stream('GET', MODEL_URL) as response:
                    response.raise_for_status()
                    with temporary.open('wb') as output:
                        for chunk in response.iter_bytes(1024 * 1024):
                            output.write(chunk)
                temporary.replace(archive)
            with tarfile.open(archive) as source:
                for member in source.getmembers():
                    resolved = (ROOT / 'models' / member.name).resolve()
                    if not resolved.is_relative_to((ROOT / 'models').resolve()):
                        raise ValueError('Model archive contains an unsafe path')
                source.extractall(ROOT / 'models', filter='data')
            print('Parakeet weights ready', flush=True)

        corpus_path = DATA / 'corpus.json'
        if corpus_path.exists():
            print('Public corpus already prepared', flush=True)
            return
        rows = []
        for offset in [0, 400, 800, 1200]:
            for config in ['clean', 'other']:
                response = client.get('https://datasets-server.huggingface.co/rows', params={
                    'dataset': 'openslr/librispeech_asr', 'config': config, 'split': 'test',
                    'offset': offset, 'length': 20, '_request_time': int(time.time()),
                })
                response.raise_for_status()
                rows.extend((config, item['row']) for item in response.json()['rows'])

        def download(item):
            config, row = item
            if not re.fullmatch(r'\d+-\d+-\d+', row['id']):
                raise ValueError('Unexpected public sample identifier')
            path = DATA / f"{config}-{row['id']}.flac"
            if not path.exists():
                response = client.get(row['audio'][0]['src'])
                response.raise_for_status()
                path.write_bytes(response.content)
            info = sf.info(path)
            return {'id': f"{config}-{row['id']}", 'condition': config,
                    'speaker': row['speaker_id'], 'reference': row['text'],
                    'path': str(path.relative_to(ROOT)), 'seconds': info.duration,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

        with ThreadPoolExecutor(max_workers=4) as pool:
            samples = list(pool.map(download, rows))
        # Alternate conditions so the duration cutoff does not select one subset.
        clean = [s for s in samples if s['condition'] == 'clean']
        other = [s for s in samples if s['condition'] == 'other']
        selected, total = [], 0
        for pair in zip(clean, other):
            for sample in pair:
                selected.append(sample)
                total += sample['seconds']
            if total >= seconds:
                break
        corpus = {'source': 'https://huggingface.co/datasets/openslr/librispeech_asr',
                  'license': 'CC-BY-4.0', 'selection': 'test clean/other; offsets 0,400,800,1200; alternate conditions',
                  'seconds': total, 'samples': selected}
        corpus_path.write_text(json.dumps(corpus, indent=2), encoding='utf-8')
        print(json.dumps({'samples': len(selected), 'audioSeconds': round(total, 2),
                          'speakers': len({s['speaker'] for s in selected})}), flush=True)


def evaluate(model, limit=None):
    os.environ['MOONSHINE_ORT_SINGLE_THREAD'] = '1'
    corpus = json.loads((DATA / 'corpus.json').read_text())
    selected = corpus['samples'][:limit] if limit else corpus['samples']
    started = time.perf_counter()
    if model == 'hybrid':
        from nimdaydu.refinement import RefinedEngine
        engine = RefinedEngine()
    elif model == 'parakeet':
        import sherpa_onnx
        engine = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(PARAKEET / 'encoder.int8.onnx'), decoder=str(PARAKEET / 'decoder.int8.onnx'),
            joiner=str(PARAKEET / 'joiner.int8.onnx'), tokens=str(PARAKEET / 'tokens.txt'),
            model_type='nemo_transducer', num_threads=4, provider='cpu')
    else:
        from moonshine_voice import ModelArch, Transcriber
        manifest = json.loads((ROOT / 'models/manifest.json').read_text())
        engine = Transcriber(ROOT / manifest[model]['path'], ModelArch(manifest[model]['arch']), update_interval=.5)
    load_seconds = time.perf_counter() - started
    results = []
    process = psutil.Process()
    peak_rss = process.memory_info().rss
    for index, sample in enumerate(selected):
        audio, rate = sf.read(ROOT / sample['path'], dtype='float32')
        before = time.perf_counter()
        if model == 'hybrid':
            from nimdaydu.protocol import AudioFrame
            lines = {}
            engine.begin(lambda event: lines.update({event['id']: event['text']})
                         if event.get('type') == 'caption' and event.get('final') else None)
            padded = np.concatenate([audio, np.zeros(rate, dtype=np.float32)])
            for sequence, offset in enumerate(range(0, len(padded), int(rate * .08))):
                engine.audio(AudioFrame(sequence, offset, padded[offset:offset + int(rate * .08)]), rate)
            engine.finish()
            hypothesis = ' '.join(lines.values())
        elif model == 'parakeet':
            stream = engine.create_stream()
            stream.accept_waveform(rate, audio)
            engine.decode_stream(stream)
            hypothesis = stream.result.text
        else:
            from moonshine_voice.transcriber import LineCompleted
            lines = {}
            stream = engine.create_stream(update_interval=.5)
            def listener(event):
                if isinstance(event, LineCompleted):
                    lines[event.line.line_id] = event.line.text
            stream.add_listener(listener)
            stream.start()
            # Same 80 ms framing as capture, fed without wall-clock sleeps.
            padded = np.concatenate([audio, np.zeros(rate, dtype=np.float32)])
            for offset in range(0, len(padded), int(rate * .08)):
                stream.add_audio(padded[offset:offset + int(rate * .08)].tolist(), rate)
            stream.stop()
            stream.close()
            hypothesis = ' '.join(lines.values())
        elapsed = time.perf_counter() - before
        peak_rss = max(peak_rss, process.memory_info().rss)
        reference = NORMALIZE(sample['reference'])
        recognized = NORMALIZE(hypothesis)
        result = {**{k: sample[k] for k in ['id', 'condition', 'speaker', 'seconds', 'reference']},
                  'hypothesis': hypothesis, 'computeSeconds': elapsed,
                  'wer': jiwer.wer(reference, recognized)}
        if model == 'hybrid':
            result['refinement'] = engine.metrics()
        results.append(result)
        if (index + 1) % 10 == 0:
            print(json.dumps({'model': model, 'completed': index + 1, 'total': len(selected)}), flush=True)
    if model != 'parakeet':
        engine.close()
    summary = {'model': model, 'loadSeconds': load_seconds, 'clips': len(results),
               'audioSeconds': sum(s['seconds'] for s in results),
               'computeSeconds': sum(s['computeSeconds'] for s in results), 'peakRssMiB': peak_rss / 2**20}
    summary['computeRtf'] = summary['computeSeconds'] / summary['audioSeconds']
    for condition in ['all', 'clean', 'other']:
        group = results if condition == 'all' else [s for s in results if s['condition'] == condition]
        summary[f'{condition}Wer'] = jiwer.wer([NORMALIZE(s['reference']) for s in group],
                                             [NORMALIZE(s['hypothesis']) for s in group])
    output = {'summary': summary, 'method': 'Individual public clips; unpaced 80ms Moonshine streaming vs whole-clip Parakeet. Compute RTF excludes input/endpoint waits.', 'results': results}
    (DATA / f'{model}{"-smoke" if limit else ""}.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--seconds', type=int, default=1200)
    parser.add_argument('--models', nargs='+', choices=['small', 'medium', 'parakeet', 'hybrid'], default=[])
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.prepare:
        prepare(args.seconds)
    for name in args.models:
        evaluate(name, args.limit)
