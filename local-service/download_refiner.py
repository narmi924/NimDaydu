"""Download the second-pass recognizer (sherpa-onnx INT8 release) and record the choice."""
import argparse
import hashlib
import json
import tarfile

import httpx

from nimdaydu.config import ROOT
from nimdaydu.refinement import REFINER_CHOICE, REFINERS

RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
# v2 and v3 measured within 0.3 WER points on accented conversation (docs/dev/benchmarks.md);
# v3 stays the default so existing installs keep their weights.
DEFAULT = 'parakeet-v3'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refiner', choices=REFINERS, default=DEFAULT)
    name = parser.parse_args().refiner
    folder, sha256 = REFINERS[name]
    directory = ROOT / 'models'
    directory.mkdir(exist_ok=True)
    if not (directory / folder / 'tokens.txt').exists():
        archive = directory / f'{folder}.tar.bz2'
        temporary = archive.with_suffix('.part')
        digest = hashlib.sha256()
        with httpx.stream('GET', f'{RELEASE}/{folder}.tar.bz2', follow_redirects=True, timeout=120) as response:
            response.raise_for_status()
            with temporary.open('wb') as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    output.write(chunk); digest.update(chunk)
        if digest.hexdigest() != sha256:
            temporary.unlink()
            raise RuntimeError(f'{name} archive SHA256 differs from the tested release. Re-run setup.')
        temporary.replace(archive)
        with tarfile.open(archive) as source:
            for member in source.getmembers():
                if not (directory / member.name).resolve().is_relative_to(directory.resolve()):
                    raise ValueError('Unsafe model archive path')
            source.extractall(directory, filter='data')
        archive.unlink()
        if not (directory / folder / 'tokens.txt').exists():
            raise RuntimeError('Incomplete model archive')
    REFINER_CHOICE.write_text(json.dumps({'refiner': name}), encoding='utf-8')
    print(f'Second-pass recognizer ready: {name}', flush=True)


if __name__ == '__main__':
    main()
