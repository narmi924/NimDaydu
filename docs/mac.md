# NimDaydu · Mac 安装与使用

适用于 Apple 芯片的 Mac（M1 及以后），需要 macOS 15 或更新版本，以及 Chrome 142 或更新版本。推荐 16 GB 内存。安装大约需要 4 GB 磁盘空间，过程中会下载约 2.5 GB 的文件。

安装不需要管理员密码，也不需要 Homebrew。所有内容都放在 NimDaydu 文件夹里，删掉文件夹就能完全卸载。

## 第一次安装

### 1. 下载 NimDaydu

下面两种方式任选一种：

- **下载压缩包（推荐）**
  1. 在项目的 GitHub 页面点 **Code → Download ZIP**。
  2. 在“下载”文件夹里双击 ZIP 解压，会得到一个 `NimDaydu-main` 文件夹。
  3. 把它改名为 `NimDaydu`，然后拖到你的个人文件夹里，也就是访达侧边栏里带小房子图标的那个。
  4. 放在个人文件夹里，可以避免 macOS 反复询问“终端想访问‘下载’或‘文稿’”。
- **用 Git 克隆**：打开终端，运行下面这行。第一次使用 Git 时，macOS 会提示安装“命令行开发者工具”，点安装即可。

  ```bash
  git clone https://github.com/narmi924/NimDaydu.git ~/NimDaydu
  ```

### 2. 运行安装脚本

1. 打开 **终端**：按 Command + 空格，输入“终端”，回车。
2. 输入下面这行并回车：

   ```bash
   cd ~/NimDaydu && bash setup.sh
   ```

   如果文件夹放在别处：先输入 cd 和一个空格，把 NimDaydu 文件夹拖进终端窗口，回车，再输入 `bash setup.sh` 回车。

3. 等它显示“安装完成”。网络中断时，重新运行 `bash setup.sh` 即可，已下载的部分会接着用。

安装脚本做了这些事：

- 下载固定版本的 uv、Node.js 和 Python 3.12
- 下载识别模型和翻译模型
- 构建 Chrome 扩展

### 3. 把扩展加载到 Chrome

1. 在 Chrome 地址栏打开 `chrome://extensions`，打开右上角的 **开发者模式**。
2. 点 **加载未打包的扩展程序**。
3. 在弹出的窗口里按 **Command + Shift + G**，粘贴 `~/NimDaydu/extension/.output/chrome-mv3`，回车，然后点 **选择**。
4. 点工具栏上的拼图图标，把 NimDaydu 固定到工具栏。

## 日常使用

1. 在访达中打开 NimDaydu 文件夹，双击 **Start-NimDaydu.command**。会弹出一个终端窗口。
   - 看到“NimDaydu 已就绪”后，可以关掉这个窗口，服务会继续在后台运行。
   - 第一次启动要准备显卡，可能需要半分钟左右。
2. 在 Chrome 打开有英文声音的网页，点工具栏里的 NimDaydu 图标，或按 **Option + Shift + N**，然后在侧栏点 **开始**。
3. 网页全屏时，悬浮字幕会自动出现。随时按 **Option + Shift + O** 可以显示或隐藏它。
4. 用完先在侧栏点 **结束**。不用时双击 **Stop-NimDaydu.command** 释放内存。

<table><tr>
<td width="36%" valign="top"><img src="images/sidepanel.png" alt="侧栏：每个英文短句上方是它的中文，最下面是正在说的英文"></td>
<td valign="top"><img src="images/overlay.png" alt="悬浮字幕：半透明字幕框叠在网页画面上"></td>
</tr><tr>
<td align="center"><sub>侧栏</sub></td>
<td align="center"><sub>悬浮字幕，拖动可以移动，拖顶部横条调高度</sub></td>
</tr></table>

也可以在终端里运行：`bash ~/NimDaydu/start.sh` 和 `bash ~/NimDaydu/stop.sh`。

第一次双击 `.command` 时，macOS 可能提示“无法打开”或“无法验证开发者”，因为这个文件是从网上下载的。任选一种办法：

- 在访达里按住 Control 点这个文件，选 **打开**，再点 **打开**。macOS 以后会记住这个选择。Stop-NimDaydu.command 也照样做一次。
- 如果新版 macOS 没有“打开”选项：先双击一次，然后打开 **系统设置 → 隐私与安全性**，在页面下方点 **仍要打开**。
- 或者不用双击，直接在终端里运行 `bash ~/NimDaydu/start.sh`。

## 使用建议

- NimDaydu 运行时大约占用 3 GB 内存。如果“活动监视器 → 内存”里的内存压力变成黄色或红色，关掉一些不用的标签页。
- 合上盖子或睡眠后，字幕会停止。唤醒后在侧栏重新点 **开始**。
- 插电使用时最稳定。

## 更新到新版本

1. 在侧栏点 **结束**，双击 **Stop-NimDaydu.command**。
2. 获取新版代码：用 Git 的话运行 `cd ~/NimDaydu && git pull`；用压缩包的话，下载新的 ZIP，用其中的文件覆盖原来的文件夹。
3. 在终端运行 `cd ~/NimDaydu && bash setup.sh`。已下载的模型会保留。
4. 在 `chrome://extensions` 里点 NimDaydu 的 **重新加载**，然后双击 **Start-NimDaydu.command**。

## 卸载

1. 双击 **Stop-NimDaydu.command**。
2. 在 `chrome://extensions` 里移除 NimDaydu。
3. 先把 `OUTPUTS` 里想留下的字幕复制出来，然后删除整个 NimDaydu 文件夹。uv 的下载缓存在 `~/.cache/uv`，也可以一起删除。

## 常见问题

| 情况 | 处理 |
|---|---|
| 安装时提示需要 Apple 芯片或 macOS 15 | 这个版本只支持 M 系列芯片和 macOS 15 及以上 |
| 启动后提示“服务已退出” | 查看 NimDaydu 文件夹里的 `.nimdaydu/service.err.log`。按 Command + Shift + . 可以显示隐藏文件夹 |
| 设置页显示翻译模型是 OPUS-MT | 说明 HY-MT 没有启动成功。重新运行 `bash setup.sh`。日志在 `.nimdaydu/translator.log` |
| 提示“语音识别持续积压” | 关闭其他占用 CPU 很多的程序，然后重新开始 |
| Chrome 提示无法连接本机服务 | 先双击 Start-NimDaydu.command，等它显示“已就绪” |

遇到其他问题，可以在项目的 GitHub 页面提交 issue，并附上上面两个日志文件。

更多使用说明见 [README](../README.md)。
