# Third-party notices

NimDaydu's personal development build uses these open-source components. Their original license terms remain applicable.

| Component | Source | License |
|---|---|---|
| Moonshine Voice 0.1.5 and English Small/Medium streaming models | https://github.com/moonshine-ai/moonshine | MIT for the English streaming models and code; see original repository notices |
| NVIDIA Parakeet TDT 0.6B v3 weights, INT8 conversion by k2-fsa/sherpa-onnx | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 | CC BY 4.0; NVIDIA model authors, quantized ONNX distribution from sherpa-onnx |
| sherpa-onnx 1.13.8 and sherpa-onnx-core | https://github.com/k2-fsa/sherpa-onnx | Apache 2.0 |
| Argos English → Chinese package 1.9, derived from OPUS-MT | https://argos-net.com/v1/translate-en_zh-1_9.argosmodel | Original OPUS model CC BY 4.0, as stated in the package README |
| CTranslate2 | https://github.com/OpenNMT/CTranslate2 | MIT |
| Tencent HY-MT1.5 (1.8B GGUF) | https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF | Tencent HY Community License; not licensed in the EU, UK or South Korea |
| llama.cpp release b11701 (llama-server) | https://github.com/ggml-org/llama.cpp | MIT |
| uv 0.11.6 and Node.js 24.22.1 (macOS setup downloads them into `.tools/`) | https://github.com/astral-sh/uv · https://nodejs.org | Apache 2.0 / MIT · MIT |
| SentencePiece | https://github.com/google/sentencepiece | Apache 2.0 |
| FastAPI | https://github.com/fastapi/fastapi | MIT |
| React | https://github.com/facebook/react | MIT |
| WXT | https://github.com/wxt-dev/wxt | MIT |

OPUS-MT model attribution: **Jörg Tiedemann and Santhosh Thottingal**, “OPUS-MT — Building open translation services for the World,” Proceedings of the 22nd Annual Conference of the European Association for Machine Translation (EAMT), Lisbon, Portugal, 2020. [Project](https://github.com/Helsinki-NLP/Opus-MT) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The original translation package README is retained at `models/translation/translate-en_zh-1_9/README.md`. NimDaydu uses the packaged model as downloaded; its weights are not modified. Captions are split into short sentences and decoded using the local runtime; the package's additional neural sentence segmenter is omitted.

Parakeet attribution: **NVIDIA**, [Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The downloaded INT8 ONNX conversion is provided by [k2-fsa/sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html). NimDaydu does not train or modify those converted weights.

The optional ASR evaluation uses a local subset of [LibriSpeech](https://huggingface.co/datasets/openslr/librispeech_asr), **Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur**, “LibriSpeech: An ASR corpus based on public domain audio books,” ICASSP 2015, distributed under CC BY 4.0. Downloaded audio, references and results stay in the ignored `artifacts/asr-evaluation/` directory and are not bundled with the extension.

The pinned translation package SHA256 is `433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab`. Moonshine downloads use the upstream downloader's supplied integrity metadata. Dependency licenses are also present in the installed Python/npm packages. If a future version is distributed beyond personal use, include the full applicable upstream notices in that distribution.

HY-MT notice: Tencent HY is licensed under the Tencent HY Community License Agreement, Copyright © 2025 Tencent. All Rights Reserved. The trademark rights of “Tencent HY” are owned by Tencent or its affiliate. `setup.ps1` / `setup.sh` download the unmodified GGUF weights from Tencent's Hugging Face repository (`License.txt` there) and pin their SHA256; the weights are not redistributed with this repository. The license excludes the European Union, the United Kingdom and South Korea, and forbids using the model or its outputs to improve other AI models. NimDaydu is not affiliated with or endorsed by Tencent. If HY-MT cannot be used, the OPUS-MT package remains available as the local translator.

llama.cpp downloads are pinned to release `b11701` and verified by SHA256 (`571794cc…` for Windows Vulkan x64, `e4219b14…` for macOS arm64; full values in `local-service/download_llm.py`).

The v0.6 evaluation also used, only inside the ignored `artifacts/` directory: [WMT24++](https://huggingface.co/datasets/google/wmt24pp) en→zh_CN (Apache 2.0); [EdAcc](https://huggingface.co/datasets/edinburghcstr/edacc) (CC BY-SA 4.0, Sanabria et al., ICASSP 2023); and two [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/) recordings (CC BY 4.0). Translation quality was scored with [COMET-22](https://huggingface.co/Unbabel/wmt22-comet-da) (Apache 2.0) in a separate environment that is not part of the app.
