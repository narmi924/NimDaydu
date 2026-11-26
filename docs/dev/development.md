# 开发说明

> 维护者文档。安装和使用请看 [README](../../README.md)。

NimDaydu 专注实时转录和翻译。开启自动保存后，外部 agent 可以在会中或会后读取 `OUTPUTS` 下的 `session.json`。文件按字幕 ID 保存定稿英文、起止时间和随后补入的中文。会议纪要、决定、待办及其与原话的关联由读取文件的 agent 生成和更新。

## 结构

```text
extension/              Chrome 扩展（WXT + React）
  entrypoints/background.ts        选择音源、启动采集、注入悬浮字幕
  entrypoints/offscreen/main.ts    采音、与本机服务通信、本机模型翻译队列
  entrypoints/sidepanel/           侧栏阅读器
  entrypoints/overlay.content.ts   网页悬浮字幕（运行时注入，Shadow DOM + Popover 顶层）
  entrypoints/options/             设置页
local-service/          本机服务（FastAPI）
  nimdaydu/engine.py               Moonshine 实时草稿（自定义刷新节奏、积压时跳过刷新）
  nimdaydu/refinement.py           Parakeet 整句复核（合并上限 15 秒，重叠词去重）
  nimdaydu/segmentation.py         成句、按标点和从句边界分行，保留完整词组
  nimdaydu/translation.py          Hy-MT2-1.8B（llama.cpp 子进程）
  nimdaydu/system.py               平台差异：脚本名、Windows 关闭后台节能降速
setup.ps1 / start.ps1 / stop.ps1   Windows
setup.sh / start.sh / stop.sh      macOS（Apple 芯片）
```

## 数据流

1. 侧栏“开始”经 background 取得 tabCapture 流，offscreen 文档把 48 kHz PCM 发送到 `ws://127.0.0.1:8765/audio`。
2. 服务端 Moonshine 产生实时英文，Parakeet 复核定稿，`SentenceAssembler` 成句并切成字幕单元（`continued` 表示句子在下一条继续）。
3. offscreen 在本机 Hy-MT2 空闲时先翻已说完的行或稳定的从句。定稿与早译的英文匹配时复用中文，其余定稿优先排队翻译。侧栏隐藏或关闭也不受影响。
4. offscreen 通过 runtime 消息更新侧栏，通过 `runtime.connect('nimdaydu-overlay')` 端口推送给悬浮字幕；悬浮字幕连接期间也算作打开的视图。
5. 侧栏和悬浮字幕都关闭约 10 秒后停止采集。

悬浮字幕用 `popover="manual"` 放进顶层，进入/退出全屏时重新 `showPopover()`，因此能盖在全屏元素之上。注入使用 `activeTab` + `scripting`：工具栏点击、快捷键或开始采集时注入，网页刷新后需要再按一次快捷键。

侧栏“导出诊断”的 `capture.events` 按句记录耗时，单位为毫秒。英文定稿时先写 `english_settled`，中文定稿后再写 `caption_timing`。以模型估计的句尾为起点，`previewMs` 是匹配定稿英文的预览出现时间（能匹配时才有），`settledMs` 是英文定稿时间，`firstChineseMs` 和 `finalChineseMs` 是对应中文首次可用和定稿的时间。提前出现记为 0。复核等待和计算分别见 `refineQueueMs`、`refineMs`，定稿翻译等待和模型调用分别见 `translationQueueMs`、`modelMs`。复用早译时定稿的模型耗时为 0。

## 检查

```bash
cd extension && npm run typecheck && npm test && npm run build
```

```powershell
cd local-service; $env:PYTHONUTF8 = '1'; .\.venv\Scripts\python.exe -m pytest -q   # Windows
```

```bash
cd local-service && PYTHONUTF8=1 .venv/bin/python -m pytest -q   # macOS
```

可复现的评测与重放脚本：

- `local-service/benchmark_pipeline.py`：按真实时钟把 WAV 送过 WebSocket 与翻译接口。
- `local-service/evaluate_asr.py`：LibriSpeech 子集上的识别比较（需要 `uv sync --group evaluation`）。
- `scripts/New-Sample.ps1`：Windows 语音合成的测试音频，可用 `python -m http.server 8800 --directory samples` 在 Chrome 中播放。

v0.6 的翻译与复核模型比较（COMET-22、EdAcc WER、AMI 会议重放）见 [benchmarks.md](benchmarks.md#v06-最佳方案实验2026-10-28)。

## 模型选择

实时字幕优先启动速度、翻译延迟和方便停止；翻译只使用 Hy-MT2-1.8B Q4，不保留较大模型、其他翻译方式或备用模型。

独立文本翻译工具位于相邻的 `OfflineTranslator` 文件夹，双击 `OfflineTranslator.exe` 启动。它只复用 GGUF 模型文件和 llama.cpp 程序，不依赖 NimDaydu 服务，也不加载 Moonshine 或 Parakeet。关闭翻译窗口时同时退出它启动的翻译进程并释放内存，不驻留后台。

两个平台使用同一组模型，只有 llama.cpp 后端不同（Windows：Vulkan，macOS：Metal）：

- **复核**：Parakeet TDT v3 INT8。在 EdAcc 150 段非母语对话上，v2 13.9% / v3 14.2%（噪声内），Cohere Transcribe INT8 31.1%。公开榜单更准的 Qwen3-ASR-1.7B 在 macOS 需要 MLX 运行时，未在真机验证前不采用。
- **翻译**：Hy-MT2-1.8B Q4_K_M，服务启动时与识别模型并行加载。每句单独翻译；小模型仍可能误译网络俚语。v0.6 的质量与速度分数只适用于当时的模型，不代表 Hy-MT2 的实测效果。

## macOS 版本的验证范围

在 Windows 上完成的检查：

- `uv.lock` 中所有原生依赖都有 macOS arm64 wheel（moonshine-voice 需要 macOS 15+）。
- llama.cpp `b11701` macOS 包的解压（含 dylib 符号链接）由 `download_llm.py` 的同一段代码完成。
- `llama-server` 的 Mach-O 加载路径为 `@rpath` → `@loader_path`，最低系统版本 13.3，带有内嵌签名。

尚未在 Mac 真机上运行：`setup.sh`、`start.sh`、`stop.sh`、Metal 推理速度和内存占用。首次在 Mac 上安装时，请收集 `.nimdaydu/service.err.log` 与 `.nimdaydu/translator.log`。

## 发布注意

- `.sh` / `.command` 在 `.gitattributes` 中固定为 LF。提交前设置可执行位，让 `git clone` 后可以直接双击：`git update-index --chmod=+x setup.sh start.sh stop.sh Start-NimDaydu.command Stop-NimDaydu.command`。
- 从浏览器下载 ZIP 的用户，第一次双击 `.command` 时会遇到 Gatekeeper 提示，Mac 安装文档已写明处理方法。
- `extension/identity.json` 固定扩展 ID，自动连接依赖它，不要重新生成。
