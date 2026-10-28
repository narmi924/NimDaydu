# architecture

- **给谁看、放在哪里**：GitHub README 的“它是怎么工作的”一节，显示宽度约 920px；读者是想装来用的人和想看代码的人。
- **只讲一件事**：声音在 Chrome 里采集，交给本机服务识别和翻译，字幕再回到侧栏和悬浮字幕；默认设置下全程在自己的电脑上。
- **形式与阅读方向**：系统架构（部署视角：Chrome 和本机服务两块，外面是“你的电脑”），主流程从左到右一条直线。
- **方向**：
  - 颜色：
    - 采音页用图标的炭黑 `#191a1d`（扩展图标里的 N）做加粗边框，它是所有线的汇合点；它也是最高的卡片，靠大小突出，不再用深色底。
    - 悬浮字幕画成它真实的样子：深色底、白字，文字取自公开会议录音的测试。
    - 识别这一路（Moonshine → Parakeet → 成句）用扩展里“采集中”状态点的绿 `#89b5a1`，加深成 `#3F7A60` 作卡片边和实时英文的线。
    - 翻译这一路（HY-MT、中文）用扩展里时间戳和“暂停”的琥珀 `#bfa980`，加深成 `#8A6A2E`。
    - 发给侧栏和悬浮字幕的线用炭黑；其余框是中性灰。Chrome、FastAPI、NVIDIA、腾讯混元的 logo 保留原色。不用紫。
  - 字体：扩展界面用的 Inter，中文跟系统（Microsoft YaHei / PingFang SC）。
  - 版式：
    - 左边 Chrome，右边本机服务，中间留 64px 的间隔给跨边界的线。
    - 采音页是一张竖着的高卡片，四条线从它右边伸出去，各对一行：上面翻译、中间识别（主线）、下面回来的字幕、最下面存档。
    - 卡片里的小字和这四行对齐，说明它在这一行做什么。
    - 主线：网页声音 → 采音页 → Moonshine → Parakeet → 成句，全在同一条水平线上。
    - 实时英文绕过 Parakeet，走识别行上方的一条走廊直接进成句。
    - 成句出来的字幕从下面一条主干分两路：回采音页，和下到 OUTPUTS。
  - 这张图独有的东西：
    - 悬浮字幕画在网页标签页里面（它确实是注入网页的内容脚本），用真实截图。
    - 采音页卡片里四行和四条线一一对齐。
  - 和以前的图有什么不同：
    - 以前的图（Gantry 的蓝/琥珀、LCIMS 的靛紫）都以一个品牌主色为主。
    - 这张是浅底加一块炭黑，绿和琥珀只标两条路，色值都取自扩展自己的状态色。
    - 版式是“一个汇合点 + 四条平行的行”，不是并行分叉。
- **元素出处**：

  | 框或线 | 出处（文件、函数、文档） |
  |---|---|
  | 网页标签页 → 采音页（标签页声音） | `extension/entrypoints/background.ts` `tabCapture.getMediaStreamId`；`offscreen/main.ts` 采音 |
  | 采音页：每 80 ms 一帧 PCM | `extension/public/audio-worklet.js`（`sampleRate * 0.08`） |
  | 采音页 → Moonshine（WebSocket `/audio`） | `offscreen/main.ts` `new WebSocket(SOCKET)`；`local-service/nimdaydu/app.py` `@app.websocket("/audio")` |
  | Moonshine Small，实时英文约每 0.5 s | `local-service/nimdaydu/engine.py` `UPDATE_INTERVAL = 0.5` |
  | Parakeet TDT 0.6B v3 整句复核 | `local-service/nimdaydu/refinement.py` `SherpaRefiner`、`RefinedEngine` |
  | 实时英文绕过复核直接成行 | `segmentation.py` `_preview_snapshot`（`preview`，带 `units`） |
  | 成句 · 切短句（≤16 词，等 0.4 s） | `segmentation.py` `MAX_UNIT_WORDS = 16`、`split_units`；`extension/lib/types.ts` `sentenceHold: 0.4` |
  | 成句 → 采音页（字幕） | `app.py` 发送队列 `outgoing` → `ws.send_json` |
  | 成句 → OUTPUTS（英文） | `local-service/nimdaydu/outputs.py` `OutputStore` |
  | 采音页 → OUTPUTS（中文） | `extension/lib/output-sync.ts` `POST /outputs/{id}/translations`；`app.py` |
  | 采音页 ⇄ HY-MT（`/translate`，含早译） | `extension/lib/translation.ts` `serviceTranslate`；`offscreen/main.ts` `pumpDrafts`；`app.py` `/translate` |
  | HY-MT1.5-1.8B，llama.cpp，Vulkan / Metal | `local-service/nimdaydu/translation.py` `LlamaTranslator`；`download_llm.py` |
  | 启动失败时改用 OPUS-MT | `translation.py` `create_translator` |
  | 采音页 → 侧栏、悬浮字幕 | `offscreen/main.ts` 广播与 `runtime.onConnect('nimdaydu-overlay')`；`entrypoints/overlay.content.ts` |
  | 本机服务只听 127.0.0.1:8765 | `local-service/nimdaydu/app.py`、`start.ps1` / `start.sh` |

- **没有画的**：DeepSeek（可选、联网，`app.py` `/translate`）和 Chrome 内置翻译（只在侧栏里）。它们都不是默认路径；画进来会多出一条穿过 OUTPUTS 那一列的线。README 的隐私一节写了 DeepSeek。
- **用户对这张图说过的话**：2026-10-28：「README中需要用figure skill来画一个架构图和时序图」
