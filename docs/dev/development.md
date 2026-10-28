# 开发说明

> 维护者文档。安装和使用请看 [README](../../README.md)。

## 结构

```text
extension/              Chrome 扩展（WXT + React）
  entrypoints/background.ts        选择音源、启动采集、注入悬浮字幕
  entrypoints/offscreen/main.ts    采音、与本机服务通信、本机模型/DeepSeek 翻译队列
  entrypoints/sidepanel/           侧栏阅读器；只有 Chrome 内置翻译在这里执行
  entrypoints/overlay.content.ts   网页悬浮字幕（运行时注入，Shadow DOM + Popover 顶层）
  entrypoints/options/             设置页
local-service/          本机服务（FastAPI）
  nimdaydu/engine.py               Moonshine 实时草稿（自定义刷新节奏、积压时跳过刷新）
  nimdaydu/refinement.py           Parakeet 整句复核（合并上限 15 秒，重叠词去重）
  nimdaydu/segmentation.py         成句、按从句切成字幕单元（≤16 词）
  nimdaydu/translation.py          HY-MT（llama.cpp 子进程）与 OPUS-MT 备用
  nimdaydu/system.py               平台差异：脚本名、Windows 关闭后台节能降速
setup.ps1 / start.ps1 / stop.ps1   Windows
setup.sh / start.sh / stop.sh      macOS（Apple 芯片）
```

## 数据流

1. 侧栏“开始”经 background 取得 tabCapture 流，offscreen 文档把 48 kHz PCM 发送到 `ws://127.0.0.1:8765/audio`。
2. 服务端 Moonshine 产生实时英文，Parakeet 复核定稿，`SentenceAssembler` 成句并切成字幕单元（`continued` 表示句子在下一条继续）。
3. offscreen 收到定稿后，本机模型与 DeepSeek 模式直接在 offscreen 翻译（侧栏隐藏或关闭也不受影响）；Chrome 内置翻译需要可见页面，仍由侧栏“认领”翻译。
4. offscreen 通过 runtime 消息更新侧栏，通过 `runtime.connect('nimdaydu-overlay')` 端口推送给悬浮字幕；悬浮字幕连接期间也算作打开的视图。
5. 侧栏和悬浮字幕都关闭约 10 秒后停止采集。

悬浮字幕用 `popover="manual"` 放进顶层，进入/退出全屏时重新 `showPopover()`，因此能盖在全屏元素之上。注入使用 `activeTab` + `scripting`：工具栏点击、快捷键或开始采集时注入，网页刷新后需要再按一次快捷键。

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

两个平台使用同一组模型，只有 llama.cpp 后端不同（Windows：Vulkan，macOS：Metal）：

- **复核**：Parakeet TDT v3 INT8。在 EdAcc 150 段非母语对话上，v2 13.9% / v3 14.2%（噪声内），Cohere Transcribe INT8 31.1%。公开榜单更准的 Qwen3-ASR-1.7B 在 macOS 需要 MLX 运行时，未在真机验证前不采用。
- **翻译**：HY-MT1.5-1.8B Q4_K_M。真实 Discord 字幕 COMET 81.3、WMT24++ 85.8（OPUS-MT 73.9 / 71.2）；Q8 不更好；7B 只高约 1 分，却多占约 3.5 GB、慢约 3 倍，对 16 GB 的 Mac 和 Windows 核显都不划算，作为 `download_llm.py --model hy-mt1.5-7b-q4` 的可选项。1.8B 带上下文时会把上一句一起译出（COMET 降到 77.4），所以每句单独翻译。

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
