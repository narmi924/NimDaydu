# NimDaydu

在 Chrome 侧栏显示网页声音的英文转录与中文翻译。默认采用 **本机 Moonshine Small 流式识别 + 本机英中翻译**，不需要新增付费服务、API 密钥或 Lightsail。

当前版本 **0.2.0**。主页面保留来源、状态、字幕与开始/暂停/继续/结束；设置独立打开，搜索与导出收进“更多”。默认中文、英文同时显示。识别草稿留在内部，完整语句整理、翻译完成后才显示，已经显示的中文不会随转录反复改写。

这台电脑的依赖、模型与扩展构建已经准备好。本机服务只监听 `127.0.0.1:8765`。

## 现在开始使用

1. 双击项目根目录的 **Start-NimDaydu.cmd**，启动本机服务。
2. 在日常 Chrome 打开 `chrome://extensions`，开启右上角 **开发者模式**，点击 **加载未打包的扩展程序**，选择：

   ```text
   E:\Projects\UniBuni\Nimdaydu\extension\.output\chrome-mv3
   ```

   选择包含 `manifest.json` 的整个文件夹。可以将 NimDaydu 固定在工具栏。
3. 在 Discord 网页版、YouTube、Slack 网页版或其他播放声音的标签页点击 NimDaydu 图标，再点侧栏底部的 **开始**。本机服务自动连接，不需要填写配对码或选择模型。

**从 v0.1 升级：**本次加入固定扩展身份，用来自动连接本机服务。若你已安装旧版，先导出需要保留的字幕，再移除旧 NimDaydu，并按第 2 步重新加载一次。之后的代码更新通常只需在扩展管理页点击“重新加载”。

日常通常只需要第 1、3 步。快捷键 **Alt + Shift + N** 打开当前标签页的侧栏；若被占用，可在 `chrome://extensions/shortcuts` 修改。

启动服务仍是一次本机操作；Chrome 也要求你主动选择要捕获的标签页。默认配置无需手动调整。本版不会在后台自动采集其他标签页。

## 字幕如何显示

- 主页面默认显示中文主行与英文次行，英文始终可见。
- 识别中的英文草稿不进入阅读区。模型定稿后，默认再等待 **0.8 秒**，合并可能的短语续接；日期和不完整短语通常等待约 **1.8 秒**。关联的下一句仍在识别时，会继续等它定稿。
- 结合停顿、连接词、主题提示词和段落长度，整理成句与短段落。单个模型音频片段包含多句时会再拆分；未说完的话标注“语句未完”。
- 只翻译整理完成的句子，每句翻译一次；中文完成后与英文一起出现，后续句子只追加。错误时保留英文并显示提示。
- 句子合并、标点整理不会通过 LLM 补造英文词语。这里采用保守规则，并非完整的语义理解模型。
- 暂停时原网页继续播放，但暂停识别。继续后，时间轴包含暂停期间的时间；暂停期间的音频不会补录。

低延迟与完整理解之间仍有取舍：本机合成样本的完整链路中，模型标记的句尾到中文完成约 **1.1–1.4 秒**；不是所有真实会议的保证。详见 [测试记录](docs/benchmarks.md)。

## 支持范围

同一套 Chrome 标签页采音链路用于所有能播放音频的普通网页，无需分别配置 Discord、YouTube 或 Slack。界面会根据网址自动识别常见平台，包括 Discord、YouTube、Slack、Google Meet、Teams、Zoom、Twitch、哔哩哔哩与 Vimeo；未知网站使用通用网页模式。

这是**平台识别与通用采音**，不会读取 Discord 账号、Slack 消息或会议 DOM，也不依赖各平台的字幕功能。进入会话或播放视频后再开始；开始后固定音源，切换标签页不会自动换音源。

实际已验证：独立 Chrome 中的网页音频捕获、真实模型识别和离线翻译。尚未用你的真实 Discord/Slack 会议验收，也不能保证受保护媒体、所有播放器或公司受管浏览器均可捕获。Windows 桌面客户端、系统音频、麦克风、说话人身份、悬浮字幕暂未实现。

## 设置与导出

右上角 **设置** 在单独标签页打开，修改自动保存：

| 项目 | 默认 |
|---|---|
| 显示内容 | 中文和英文 |
| 文字大小 | 18 px；英文较小 |
| 句子整理等待 | 0.8 秒；下一次开始时生效 |
| 翻译方式 | 本机离线模型 |
| 语音识别 | Moonshine Small Streaming，CPU 单线程 |
| 本机连接 | 自动连接 |

右上角 **更多** 提供搜索、双语 TXT / JSON 导出与会话结束后的清空。滚动回看时可点“回到最新”。

字幕当前保存在扩展本次运行的内存中，最多 5,000 句。**关闭 Chrome、重载扩展、清空或开始新会话前，请导出需要保留的字幕。** JSON 保留原识别片段、整理后的句子、译文、段落及不完整标记；时间是模型估计，拆分句的时间按片段长度分配，不能当作精确词级时间轴。

关闭来源标签页会停止采集；最后一个字幕视图关闭后约 **10 秒**停止采集。本机服务断开会停止捕获并保留已显示字幕；重新开始会建立新会话。

## 翻译选择

| 方式 | 网络与费用 | 使用方式 |
|---|---|---|
| 本机离线模型 | 首次下载模型；使用时无 API 费用 | 默认，安装后即可使用 |
| Chrome 本地翻译 | Chrome 自行下载英中语言包 | 设置中选择并准备；日常 Chrome 已验证中→英翻译可用，仍需在插件中点一次准备 |
| DeepSeek API | 联网，产生已有 API 的用量费用 | 设置中选择，填写已有密钥并保存；不会自动切换到付费模式 |
| 关闭翻译 | 无 | 仅显示英文 |

离线翻译使用 Argos 英中 1.9 包中的 OPUS 模型，由 CTranslate2 在 CPU 上运行。完整、稳定的显示并不等于内容一定准确：专业术语、人名、口音、噪声和多人同时说话仍可能识别或翻译错。当前样本中的 NimDaydu 就曾被识别为 Nim Daedoo；英文保留识别结果，方便核对。

使用 Chrome 翻译：打开 NimDaydu 的 **设置 → 翻译方式 → Chrome 本地翻译 → 准备语言包**，等待“语言包已就绪”，再在声音所在标签页开始字幕。模型由 Chrome 按需下载，无需另找安装包。[Chrome 官方说明](https://developer.chrome.com/docs/ai/translator-api)。同一语言包在不同网页来源上的可用状态可能显示不同，准备按钮仍需在扩展内点击一次。

Chrome 使用专用翻译模型，但没有与当前 OPUS 模型完成同句英译中对照，不能保证更准确。2026-10-07 已在用户日常 Chrome 的官方测试页成功把公开中文测试句译为英文；此前隔离 Chrome 的下载超时不代表日常 Chrome 不可用。

项目根目录 `glossary.json` 可规范翻译输入的品牌拼写，比如 `discord → Discord`，避免被译成“不和”。它不会修改显示的英文，也不是任意中文术语词典。修改后重启本机服务。

DeepSeek 密钥仅存到本机 `.nimdaydu/providers.json`，不写入扩展存储，也不会在接口响应中返回。只发送完整英文句子及最近两句上下文；不发送音频。默认模型 `deepseek-flash`，关闭 thinking。也可以使用 `.env.example` 中的环境变量；设置页保存的值优先，移除密钥后本机记录会显式保持为空。

## 安装与开发

环境要求：Windows x64、Chrome 142+、Python 3.12、Node.js 22+、uv。这台电脑已具备；无需重新下载模型。

移动到其他电脑或依赖丢失时，在项目目录打开 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

脚本根据 `uv.lock` 与 `package-lock.json` 安装项目内依赖，下载语音和英中模型，再构建扩展。Python 使用 `local-service/.venv`，前端依赖在 `extension/node_modules`；无需 CUDA、WSL 或 Docker。

启停服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\stop.ps1
```

通常先在侧栏点“结束”，让最后一句完成。停止脚本检查进程路径及启动时间，避免结束其他程序。修改服务端代码后要停止并重新启动。

前端开发检查：

```powershell
cd extension
npm run typecheck
npm test
npm run build
```

然后在 `chrome://extensions` 点“重新加载”。构建输出为 `extension/.output/chrome-mv3`。`extension/identity.json` 是固定的公开身份信息，请保留；重新生成会改变自动连接所使用的扩展 ID。

Python 测试：

```powershell
cd local-service
.\.venv\Scripts\python.exe -m pytest -q
```

## 自行验证音频链路

```powershell
.\scripts\New-Sample.ps1
& .\local-service\.venv\Scripts\python.exe -m http.server 8800 --bind 127.0.0.1 --directory samples
```

Chrome 打开 `http://127.0.0.1:8800`，在该标签页点插件图标并开始，再播放测试音频。终端 Ctrl+C 停止样本服务器。样本由 Windows 已安装的英语语音合成，不采集麦克风。

完整服务链路基准（先结束浏览器字幕会话）：

```powershell
cd local-service
.\.venv\Scripts\python.exe benchmark_pipeline.py
```

结果写入 `artifacts/benchmark-pipeline.json`，用于检查句子稳定和耗时，不是准确率评测。

## 常见问题

| 情况 | 处理 |
|---|---|
| 本机服务未连接 | 双击 Start-NimDaydu.cmd；已运行旧版时停止并重新启动 |
| 开始按钮不可用 | 在声音所在网页点一次 NimDaydu 图标；等待本机连接完成 |
| 自动连接被拒绝 | 重启本机服务；从 v0.1 升级需重新加载新版扩展，固定 ID 为 kmjdcdmffbieodadiegbnfjopendpblp |
| 等待完整语句 | 确认选中网页在播放英文；安静、讲话未完或模型仍在整理时不会显示草稿 |
| 英文出现但翻译失败 | 设置中选择本机离线模型；缺少模型时运行 setup.ps1 并重启服务 |
| Chrome 语言包一直等待 | 切回本机离线模型；Chrome 模式约 3 分钟超时 |
| 转录积压或断开 | 结束后重新开始，关闭高负载任务；不会无限积压音频 |
| 桌面客户端无字幕 | 本版捕获 Chrome 标签页，请使用网页版 |
| 全屏看不到侧栏 | 退出全屏或使用普通窗口 |
| 扩展被关闭 | 保持开发者模式开启，并确认 NimDaydu 已启用 |

## 文件与数据

```text
extension/             扩展源码、独立设置页及构建
local-service/         本机识别、句子整理、翻译与 API
models/                下载模型、来源与许可证
scripts/               测试音频、图标和公开身份工具
.nimdaydu/             连接令牌、可选 API 密钥、进程与日志
Plan.md                调研方案与最新决策
docs/benchmarks.md     实测结果及验证边界
THIRD_PARTY_NOTICES.md  开源模型与库的署名
```

默认不保存原始音频，不上传音频，不在服务日志记录字幕全文或密钥。自动连接接口只向固定 NimDaydu 扩展 Origin 返回本机令牌，后续接口仍需鉴权。密钥、令牌、模型、依赖和日志已加入 `.gitignore`。无需配置 Lightsail。
