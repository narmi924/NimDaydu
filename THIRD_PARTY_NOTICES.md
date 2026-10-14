# Third-party notices

NimDaydu's personal development build uses these open-source components. Their original license terms remain applicable.

| Component | Source | License |
|---|---|---|
| Moonshine Voice 0.1.5 and English Small/Medium streaming models | https://github.com/moonshine-ai/moonshine | MIT for the English streaming models and code; see original repository notices |
| NVIDIA Parakeet TDT 0.6B v3 weights, INT8 conversion by k2-fsa/sherpa-onnx | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 | CC BY 4.0; NVIDIA model authors, quantized ONNX distribution from sherpa-onnx |
| sherpa-onnx 1.13.8 and sherpa-onnx-core | https://github.com/k2-fsa/sherpa-onnx | Apache 2.0 |
| Argos English → Chinese package 1.9, derived from OPUS-MT | https://argos-net.com/v1/translate-en_zh-1_9.argosmodel | Original OPUS model CC BY 4.0, as stated in the package README |
| CTranslate2 | https://github.com/OpenNMT/CTranslate2 | MIT |
| SentencePiece | https://github.com/google/sentencepiece | Apache 2.0 |
| FastAPI | https://github.com/fastapi/fastapi | MIT |
| React | https://github.com/facebook/react | MIT |
| WXT | https://github.com/wxt-dev/wxt | MIT |

OPUS-MT model attribution: **Jörg Tiedemann and Santhosh Thottingal**, “OPUS-MT — Building open translation services for the World,” Proceedings of the 22nd Annual Conference of the European Association for Machine Translation (EAMT), Lisbon, Portugal, 2020. [Project](https://github.com/Helsinki-NLP/Opus-MT) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The original translation package README is retained at `models/translation/translate-en_zh-1_9/README.md`. NimDaydu uses the packaged model as downloaded; its weights are not modified. Captions are split into short sentences and decoded using the local runtime; the package's additional neural sentence segmenter is omitted.

Parakeet attribution: **NVIDIA**, [Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The downloaded INT8 ONNX conversion is provided by [k2-fsa/sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html). NimDaydu does not train or modify those converted weights.

The optional ASR evaluation uses a local subset of [LibriSpeech](https://huggingface.co/datasets/openslr/librispeech_asr), **Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur**, “LibriSpeech: An ASR corpus based on public domain audio books,” ICASSP 2015, distributed under CC BY 4.0. Downloaded audio, references and results stay in the ignored `artifacts/asr-evaluation/` directory and are not bundled with the extension.

The pinned translation package SHA256 is `433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab`. Moonshine downloads use the upstream downloader's supplied integrity metadata. Dependency licenses are also present in the installed Python/npm packages. If a future version is distributed beyond personal use, include the full applicable upstream notices in that distribution.
