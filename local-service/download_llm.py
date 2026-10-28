"""Install the local translation model and a pinned llama.cpp server for this platform."""
import argparse
import hashlib
import json
import platform
import shutil
import sys
import tarfile
import time
import zipfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
BUILD = 'b11701'
SERVERS = {
    # Vulkan uses the integrated or discrete GPU and falls back to the CPU.
    ('win32', 'AMD64'): (f'llama-{BUILD}-bin-win-vulkan-x64.zip', '571794ccf8d44351253a644cfc406bcf094cf01e902aad7f6f65e8a0859eb0af', 'llama-server.exe'),
    ('darwin', 'arm64'): (f'llama-{BUILD}-bin-macos-arm64.tar.gz', 'e4219b1442dcf0b68e860ea6f06d417163326391e8514b04019080f2444ff47c', 'llama-server'),
}
MODELS = {
    'hy-mt1.5-1.8b-q4': ('HY-MT1.5-1.8B', 'tencent/HY-MT1.5-1.8B-GGUF', 'HY-MT1.5-1.8B-Q4_K_M.gguf',
                         '4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7'),
    'hy-mt1.5-7b-q4': ('HY-MT1.5-7B', 'tencent/HY-MT1.5-7B-GGUF', 'HY-MT1.5-7B-Q4_K_M.gguf',
                       'fc87637e4dd29547811a28170770c2ac17725fb7690b7c4aafa4f463c3e77568'),
}
# docs/dev/benchmarks.md (v0.6): Q8 scored no better than Q4 at twice the latency;
# 7B gains about one COMET point for 3.5 GB more memory and 3x the latency.
DEFAULT_MODEL = 'hy-mt1.5-1.8b-q4'


def download(url, destination, sha256):
    if destination.exists() and digest(destination) == sha256:
        return
    temporary = destination.with_name(destination.name + '.part')
    offset = temporary.stat().st_size if temporary.exists() else 0
    headers = {'Range': f'bytes={offset}-'} if offset else {}
    with httpx.stream('GET', url, headers=headers, follow_redirects=True, timeout=120) as response:
        response.raise_for_status()
        if offset and response.status_code != 206:
            offset = 0
        total = int(response.headers.get('content-length', '0')) + offset
        received, last = offset, 0.0
        with temporary.open('ab' if offset else 'wb') as output:
            for chunk in response.iter_bytes(1024 * 1024):
                output.write(chunk)
                received += len(chunk)
                if time.monotonic() - last > 5:
                    print(f'{destination.name}: {received / total:.0%}' if total else f'{destination.name}: {received >> 20} MiB', flush=True)
                    last = time.monotonic()
    if digest(temporary) != sha256:
        temporary.unlink()
        raise RuntimeError(f'{destination.name} SHA256 differs from the tested release. Re-run setup to download again.')
    temporary.replace(destination)


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def install_server(tools):
    key = (sys.platform, platform.machine())
    if key not in SERVERS:
        raise RuntimeError(f'No tested llama.cpp build for {key}; the basic offline translator stays available.')
    archive_name, sha256, executable = SERVERS[key]
    downloads = tools / 'downloads'
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / archive_name
    download(f'https://github.com/ggml-org/llama.cpp/releases/download/{BUILD}/{archive_name}', archive, sha256)
    target = tools / 'llama.cpp' / BUILD
    if not (target / executable).exists():
        staging = target.with_name(BUILD + '.staging')
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        if archive_name.endswith('.zip'):
            with zipfile.ZipFile(archive) as package:
                for member in package.infolist():
                    if not (staging / member.filename).resolve().is_relative_to(staging.resolve()):
                        raise RuntimeError('Unsafe llama.cpp archive entry')
                package.extractall(staging)
        else:
            with tarfile.open(archive) as package:
                # The macOS archive nests files in llama-<build>/ with dylib symlinks.
                package.extractall(staging, filter='data')
        found = next(staging.rglob(executable))
        shutil.rmtree(target, ignore_errors=True)
        found.parent.rename(target)
        shutil.rmtree(staging, ignore_errors=True)
    return (target / executable).relative_to(ROOT).as_posix()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=MODELS, default=DEFAULT_MODEL)
    args = parser.parse_args()
    tools = ROOT / '.tools'
    server = install_server(tools)
    name, repository, filename, sha256 = MODELS[args.model]
    directory = ROOT / 'models/llm'
    directory.mkdir(parents=True, exist_ok=True)
    download(f'https://huggingface.co/{repository}/resolve/main/{filename}', directory / filename, sha256)
    manifest = {'name': name, 'key': args.model, 'profile': 'hy-mt', 'model': (directory / filename).relative_to(ROOT).as_posix(),
                'sha256': sha256, 'server': server, 'build': BUILD,
                'license': 'Tencent HY Community License (not licensed in the EU, UK or South Korea)'}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Local translation ready: {name} ({filename}) with llama.cpp {BUILD}.', flush=True)


if __name__ == '__main__':
    main()
