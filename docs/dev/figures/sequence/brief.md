# sequence

- **给谁看、放在哪里**：GitHub README 的“字幕是怎么出现的”一节，显示宽度约 920px。
- **只讲一件事**：一句话从声音到中文经过哪几步，为什么中文能在这一行说完后不到一秒就先出现。
- **形式与阅读方向**：时序图，从上到下；三段：边说边出、一行说完先翻一版、复核定稿。
- **方向**：
  - 颜色：和架构图一致。
    - 采音页是炭黑边框。
    - 声音和英文的消息用绿，翻译和中文用琥珀，发给侧栏和悬浮字幕的消息用炭黑。
    - 激活条用对应颜色的淡底。
  - 字体：Inter，中文跟系统。
  - 版式：
    - 参与者顺序是 会议网页 | 侧栏·悬浮字幕 | 采音页 | HY-MT | 识别。前三个在 Chrome，后两个在本机服务。
    - 发给显示端的消息都很短；识别在最右边，Parakeet 复核的激活条和说明不会被翻译的消息穿过。
    - 右侧两个括号标出从这一行说完到首个中文、到定稿中文的实测中位数。
  - 这张图独有的东西：“早译”这一步，以及右边两个实测的等待时间。
  - 和以前的图有什么不同：这是这个用户的第一张时序图。版式是生命线加按时间排的消息，颜色沿用同一项目的架构图。
- **元素出处**：

  | 框或线 | 出处（文件、函数、文档） |
  |---|---|
  | 声音 → 采音页；PCM 每 80 ms | `extension/public/audio-worklet.js`；`offscreen/main.ts` |
  | 实时英文约每 0.5 s，按行分好 | `local-service/nimdaydu/engine.py` `UPDATE_INTERVAL`；`segmentation.py` `_preview_snapshot`（`units`） |
  | 最下面一行英文 | `extension/lib/CaptionReader.tsx` `LiveRows`；`extension/lib/overlay.ts` `overlayRows` |
  | 一行说完、模型空闲时先翻 | `offscreen/main.ts` `pumpDrafts`（最后一行以 .!? 结尾才算说完；`draft: true`）；`app.py` 忙时对 draft 返回 429 |
  | 中文约 0.5 s | `docs/dev/benchmarks.md`：HY-MT 单句 p50 0.45–0.51 s |
  | 浅色中文 | `CaptionReader.tsx` `.chinese.draft`；`overlay.content.ts` `.zh.draft` |
  | Parakeet 复核，再等 0.4 s 成句 | `refinement.py` `RefinedEngine`；`segmentation.py` `SentenceAssembler`（`hold`）；`types.ts` `sentenceHold: 0.4` |
  | 英文没变：沿用早译；变了：重新翻译 | `offscreen/main.ts` 翻译队列先查 `draftModel`（键为 `draftKey`） |
  | 首个中文中位 0.94 s，定稿中文中位 1.72 s | `docs/dev/benchmarks.md` v0.7“中文提前出现”：AMI ES2004a 580–760 s，Chrome for Testing 中的真实侧栏 |

- **用户对这张图说过的话**：2026-10-28：「README中需要用figure skill来画一个架构图和时序图」
