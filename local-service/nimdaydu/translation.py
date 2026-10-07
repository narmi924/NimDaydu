import json
import re

from .config import ROOT


class OfflineTranslator:
    def __init__(self):
        import ctranslate2
        import sentencepiece as spm

        manifest = json.loads((ROOT / 'models/translation/manifest.json').read_text())
        directory = ROOT / manifest['path']
        self.tokenizer = spm.SentencePieceProcessor(model_file=str(directory / 'sentencepiece.model'))
        self.translator = ctranslate2.Translator(str(directory / 'model'), device='cpu', compute_type='int8', inter_threads=1, intra_threads=2)
        self.prefix = json.loads((directory / 'metadata.json').read_text(encoding='utf-8')).get('target_prefix', '')
        glossary_file = ROOT / 'glossary.json'
        glossary = json.loads(glossary_file.read_text(encoding='utf-8')) if glossary_file.exists() else {}
        if not isinstance(glossary, dict) or len(glossary) > 100 or any(not isinstance(k, str) or not isinstance(v, str) or not k or len(k) > 64 or len(v) > 64 for k, v in glossary.items()):
            raise ValueError('glossary.json must map up to 100 short English spellings to their canonical forms')
        self.terms = [(re.compile(r'(?<!\w)' + re.escape(term) + r'(?!\w)', re.IGNORECASE), spelling) for term, spelling in glossary.items()]

    def translate(self, text: str) -> str:
        # ASR often loses brand capitalization. Keep raw English captions
        # unchanged; only normalize known spellings before translation.
        for pattern, spelling in self.terms:
            text = pattern.sub(lambda _match: spelling, text)
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
        return output
