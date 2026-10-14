"""Download NVIDIA Parakeet TDT 0.6B v3 INT8 (CC-BY-4.0), via sherpa-onnx."""
import hashlib
import tarfile
import httpx

from nimdaydu.config import ROOT
from nimdaydu.refinement import MODEL_DIR

URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'

if __name__ == '__main__':
    required = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
    if all((MODEL_DIR / filename).exists() for filename in required):
        print('Parakeet weights already ready.')
    else:
        directory = ROOT / 'models'
        directory.mkdir(exist_ok=True)
        archive = directory / 'parakeet-tdt-v3-int8.tar.bz2'
        temporary = archive.with_suffix('.part')
        digest = hashlib.sha256()
        with httpx.stream('GET', URL, follow_redirects=True, timeout=120) as response:
            response.raise_for_status()
            with temporary.open('wb') as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    output.write(chunk); digest.update(chunk)
        temporary.replace(archive)
        with tarfile.open(archive) as source:
            for member in source.getmembers():
                if not (directory / member.name).resolve().is_relative_to(directory.resolve()):
                    raise ValueError('Unsafe model archive path')
            source.extractall(directory, filter='data')
        if not all((MODEL_DIR / filename).exists() for filename in required):
            raise RuntimeError('Incomplete model archive')
        print(f'Parakeet ready. Download SHA256: {digest.hexdigest()}')
