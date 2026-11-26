# Third-party notices

NimDaydu uses these third-party components under their respective licenses.

| Component | Source | License |
|---|---|---|
| Moonshine Voice 0.1.5 and English Small/Medium streaming models | https://github.com/moonshine-ai/moonshine | MIT for the English streaming models and code; see original repository notices |
| NVIDIA Parakeet TDT 0.6B v3 weights, INT8 conversion by k2-fsa/sherpa-onnx | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 | CC BY 4.0; NVIDIA model authors, quantized ONNX distribution from sherpa-onnx |
| sherpa-onnx 1.13.8 and sherpa-onnx-core | https://github.com/k2-fsa/sherpa-onnx | Apache 2.0 |
| Tencent Hy-MT2-1.8B GGUF | https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF | Apache 2.0 |
| llama.cpp release b11701 (llama-server) | https://github.com/ggml-org/llama.cpp | MIT |
| uv 0.11.6 and Node.js 24.22.1 (macOS setup downloads them into `.tools/`) | https://github.com/astral-sh/uv · https://nodejs.org | Apache 2.0 / MIT · MIT |
| FastAPI | https://github.com/fastapi/fastapi | MIT |
| React | https://github.com/facebook/react | MIT |
| WXT | https://github.com/wxt-dev/wxt | MIT |

Parakeet attribution: **NVIDIA**, [Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The downloaded INT8 ONNX conversion is provided by [k2-fsa/sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html). NimDaydu does not train or modify those converted weights.

The optional ASR evaluation uses a local subset of [LibriSpeech](https://huggingface.co/datasets/openslr/librispeech_asr), **Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur**, “LibriSpeech: An ASR corpus based on public domain audio books,” ICASSP 2015, distributed under CC BY 4.0. Downloaded audio, references and results stay in the ignored `artifacts/asr-evaluation/` directory and are not bundled with the extension.

Moonshine downloads use the upstream downloader's supplied integrity metadata. Dependency licenses are also present in the installed Python/npm packages.

The floating-caption screenshot, Chinese side-panel screenshot, and architecture example show machine-generated captions from the [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The floating-caption screenshot uses [Jitsi Meet gallery view](https://commons.wikimedia.org/wiki/File:Jitsi_Meet_gallery_view.jpg) by Sphere231 ([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)) as its background.

Hy-MT2 notice: The Hy-MT2-1.8B model is released by Tencent under Apache 2.0. The setup scripts download unmodified GGUF weights from Tencent's Hugging Face repositories and pin their SHA256; the weights are not redistributed with this repository. NimDaydu is not affiliated with or endorsed by Tencent.

llama.cpp downloads are pinned to release `b11701` and verified by SHA256 (`571794cc…` for Windows Vulkan x64, `e4219b14…` for macOS arm64; full values in `local-service/download_llm.py`).

The v0.6 evaluation also used, only inside the ignored `artifacts/` directory: [WMT24++](https://huggingface.co/datasets/google/wmt24pp) en→zh_CN (Apache 2.0); [EdAcc](https://huggingface.co/datasets/edinburghcstr/edacc) (CC BY-SA 4.0, Sanabria et al., ICASSP 2023); and two [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/) recordings (CC BY 4.0). Translation quality was scored with [COMET-22](https://huggingface.co/Unbabel/wmt22-comet-da) (Apache 2.0) in a separate environment that is not part of the app.
