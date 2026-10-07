"""Install the official Argos English→Chinese package, without Torch/Stanza."""
import hashlib
import json
import time
import zipfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
URL = "https://argos-net.com/v1/translate-en_zh-1_9.argosmodel"
EXPECTED_SHA256 = '433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab'


def main():
    directory = ROOT / "models/translation"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / "translate-en_zh-1_9.argosmodel"
    if not archive.exists():
        temporary = archive.with_suffix('.part')
        with httpx.stream("GET", URL, follow_redirects=True, timeout=120) as response, temporary.open('wb') as output:
            response.raise_for_status()
            total = int(response.headers.get('content-length', '0'))
            received, last = 0, 0
            for chunk in response.iter_bytes(1024 * 256):
                output.write(chunk)
                received += len(chunk)
                if time.monotonic() - last > 4:
                    print(f"Offline translation: {received / total:.0%}" if total else f"Offline translation: {received // 1024**2} MiB", flush=True)
                    last = time.monotonic()
        temporary.replace(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise RuntimeError('Translation package SHA256 differs from the tested release. Do not extract it.')
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None:
            raise RuntimeError('Translation archive CRC failed. Remove the archive and retry.')
        for member in package.infolist():
            destination = (directory / member.filename).resolve()
            if not destination.is_relative_to(directory.resolve()) or member.file_size > 250_000_000:
                raise RuntimeError('Unsafe translation archive entry')
            # Sentence segmentation models are unnecessary for short ASR captions.
            if '/stanza/' not in member.filename:
                package.extract(member, directory)
        metadata_file = next(directory.glob('*/metadata.json'))
    metadata = json.loads(metadata_file.read_text(encoding='utf-8'))
    if metadata['from_code'] != 'en' or metadata['to_code'] != 'zh':
        raise RuntimeError('Unexpected translation language pair')
    (directory / 'manifest.json').write_text(json.dumps({'path': str(metadata_file.parent.relative_to(ROOT)), 'url': URL, 'sha256': digest}, indent=2), encoding='utf-8')
    print(f'Offline English-to-Chinese ready. SHA256: {digest}', flush=True)


if __name__ == '__main__':
    main()
