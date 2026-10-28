"""Local English→Chinese translation: HY-MT1.5 via llama.cpp, OPUS-MT as fallback."""
import ctypes
import json
import logging
import re
import socket
import subprocess
import time

import httpx

from .config import ROOT
from .system import IS_WINDOWS

log = logging.getLogger('nimdaydu')
CJK = '⺀-鿿　-〿＀-￯'
# OPUS emits SentencePiece spaces between Chinese words ("使用 案件 下降").
SPACES_IN_CHINESE = re.compile(rf'(?<=[{CJK}])\s+|\s+(?=[{CJK}])')


def load_glossary():
    glossary_file = ROOT / 'glossary.json'
    glossary = json.loads(glossary_file.read_text(encoding='utf-8')) if glossary_file.exists() else {}
    if not isinstance(glossary, dict) or len(glossary) > 100 or any(not isinstance(k, str) or not isinstance(v, str) or not k or len(k) > 64 or len(v) > 64 for k, v in glossary.items()):
        raise ValueError('glossary.json must map up to 100 short English spellings to their canonical forms')
    return [(re.compile(r'(?<!\w)' + re.escape(term) + r'(?!\w)', re.IGNORECASE), spelling) for term, spelling in glossary.items()]


def normalize_terms(terms, text):
    # ASR often loses brand capitalization. Keep raw English captions
    # unchanged; only normalize known spellings before translation.
    for pattern, spelling in terms:
        text = pattern.sub(lambda _match: spelling, text)
    return text


class OfflineTranslator:
    """OPUS-MT (Argos en→zh 1.9) on CTranslate2: small, but context-free and literal."""
    name = 'OPUS-MT'

    def __init__(self):
        import ctranslate2
        import sentencepiece as spm

        manifest = json.loads((ROOT / 'models/translation/manifest.json').read_text())
        directory = ROOT / manifest['path'].replace('\\', '/')
        self.tokenizer = spm.SentencePieceProcessor(model_file=str(directory / 'sentencepiece.model'))
        self.translator = ctranslate2.Translator(str(directory / 'model'), device='cpu', compute_type='int8', inter_threads=1, intra_threads=2)
        self.prefix = json.loads((directory / 'metadata.json').read_text(encoding='utf-8')).get('target_prefix', '')
        self.terms = load_glossary()

    def translate(self, text: str, context=()) -> str:
        text = normalize_terms(self.terms, text)
        # ASR lines are short; split at sentence boundaries without installing
        # another neural sentence segmenter and its Torch runtime.
        sentences = [s for s in re.split(r'(?<=[.!?])\s+', text.strip()) if s]
        tokens = [self.tokenizer.encode(sentence, out_type=str) for sentence in sentences]
        if any(len(piece) > 512 for piece in tokens):
            raise ValueError('Caption exceeds local translation model limit')
        result = self.translator.translate_batch(tokens, target_prefix=[[self.prefix]] * len(tokens) if self.prefix else None,
                                                 beam_size=3, replace_unknowns=True, max_input_length=512, max_decoding_length=512)
        output = ''.join(self.tokenizer.decode(item.hypotheses[0]).replace('▁', ' ') for item in result).strip()
        if self.prefix and output.startswith(self.prefix):
            output = output[len(self.prefix):].strip()
        return SPACES_IN_CHINESE.sub('', output)

    def close(self):
        pass


def _kill_with_parent(process):
    """Windows: tie the server to this service so a forced stop cannot orphan it."""
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.CreateJobObjectW.restype = ctypes.c_void_p
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.SetInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    kernel32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]

    class Basic(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', ctypes.c_uint32), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', ctypes.c_uint32),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', ctypes.c_uint32), ('SchedulingClass', ctypes.c_uint32)]

    class Extended(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', ctypes.c_uint64 * 6),
                    ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                    ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]

    job = kernel32.CreateJobObjectW(None, None)
    limits = Extended()
    limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    handle = kernel32.OpenProcess(0x0101, False, process.pid)  # PROCESS_SET_QUOTA | PROCESS_TERMINATE
    ok = job and handle and kernel32.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) \
        and kernel32.AssignProcessToJobObject(job, handle)
    if handle:
        kernel32.CloseHandle(handle)
    if not ok:
        log.warning('Translator process is not tied to the service (error %s)', ctypes.get_last_error())
    # The job handle stays open for the service's lifetime; closing it kills the server.
    return job


class LlamaTranslator:
    """HY-MT1.5 in a private llama.cpp server listening only on localhost."""
    PROMPT = '将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}'
    START_TIMEOUT = 90

    def __init__(self):
        manifest = json.loads((ROOT / 'models/llm/manifest.json').read_text(encoding='utf-8'))
        self.name = manifest['name']
        self.model = ROOT / manifest['model']
        self.server = ROOT / manifest['server']
        if not self.model.exists() or not self.server.exists():
            raise RuntimeError('Local translation model missing; run setup again.')
        self.terms = load_glossary()
        self.client = httpx.Client(timeout=20)
        self.process = None
        self.job = None
        self.gpu = True
        self._start()

    def _start(self):
        # GPU first (Vulkan on Windows, Metal on macOS); CPU if the driver refuses.
        for gpu in ([self.gpu, False] if self.gpu else [False]):
            try:
                self._launch(gpu)
                self.gpu = gpu
                self.translate('Warm up the translation model.')
                return
            except Exception:
                log.warning('llama.cpp %s start failed', 'GPU' if gpu else 'CPU', exc_info=True)
                self._stop()
        raise RuntimeError('Local translation server could not start; see .nimdaydu/translator.log')

    def _launch(self, gpu):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        arguments = [str(self.server), '-m', str(self.model), '--host', '127.0.0.1', '--port', str(self.port),
                     '-c', '2048', '-np', '1', '--jinja', '--no-webui', '-ngl', '99' if gpu else '0', '-t', '4']
        logs = (ROOT / '.nimdaydu').resolve()
        logs.mkdir(exist_ok=True)
        output = (logs / 'translator.log').open('w', encoding='utf-8')
        if IS_WINDOWS:
            # Below the recognizer: if translation lands on the CPU, captions still keep up.
            flags = subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS
            self.process = subprocess.Popen(arguments, stdout=output, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                            cwd=self.server.parent, creationflags=flags)
            self.job = _kill_with_parent(self.process)
        else:
            # nice execs the server in place, so the PID stays the server's own.
            self.process = subprocess.Popen(['/usr/bin/nice', '-n', '5', *arguments], stdout=output, stderr=subprocess.STDOUT,
                                            stdin=subprocess.DEVNULL, cwd=self.server.parent)
        output.close()
        deadline = time.monotonic() + self.START_TIMEOUT
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f'llama-server exited with {self.process.returncode}')
            try:
                if self.client.get(f'http://127.0.0.1:{self.port}/health', timeout=2).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(.25)
        raise RuntimeError('llama-server did not become ready')

    def translate(self, text: str, context=()) -> str:
        # Context stays unused: HY-MT's contextual prompt makes the 1.8B model
        # translate earlier lines into short replies ("Uh so so so."), which
        # scored COMET 77.4 against 81.3 without it on real Discord captions.
        if self.process is None or self.process.poll() is not None:
            log.warning('Local translation server stopped; restarting')
            self._stop()
            self._start()
        source = normalize_terms(self.terms, text.strip())
        response = self.client.post(f'http://127.0.0.1:{self.port}/v1/chat/completions', json={
            'messages': [{'role': 'user', 'content': self.PROMPT.format(text=source)}],
            'max_tokens': min(1024, max(64, len(source) * 2)),
            'temperature': 0, 'top_k': 1, 'repeat_penalty': 1.05})
        response.raise_for_status()
        output = response.json()['choices'][0]['message']['content'].strip()
        if not output:
            raise RuntimeError('Empty translation')
        return output

    def _stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None
        if self.job:
            ctypes.WinDLL('kernel32').CloseHandle(ctypes.c_void_p(self.job))
            self.job = None

    def close(self):
        self._stop()
        self.client.close()


def create_translator():
    try:
        return LlamaTranslator()
    except Exception:
        log.warning('HY-MT translation unavailable; using OPUS-MT', exc_info=True)
        return OfflineTranslator()
