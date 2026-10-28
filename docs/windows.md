# NimDaydu · Windows 安装与使用

适用于 Windows 10 或 11（64 位），需要 Chrome 142 或更新版本。安装大约需要 4 GB 磁盘空间，过程中会下载约 2.3 GB 的模型。

## 第一次安装

### 1. 安装两个工具

在开始菜单搜索并打开 **PowerShell**，依次运行下面两行：

```powershell
winget install --id astral-sh.uv -e
winget install --id OpenJS.NodeJS.LTS -e
```

装好后关闭 PowerShell。Python 不需要另外安装，安装脚本会自动准备。

### 2. 下载 NimDaydu

下面两种方式任选一种：

- **下载压缩包**
  1. 在项目的 GitHub 页面点 **Code → Download ZIP**。
  2. 在下载好的 ZIP 上点右键，选 **属性**。如果底部有 **解除锁定**，勾选后点确定。这样之后双击脚本时，Windows 不会反复弹出安全提示。
  3. 解压到一个简单的位置，例如 `D:\NimDaydu`。
- **用 Git 克隆**：

  ```powershell
  git clone https://github.com/narmi924/NimDaydu.git D:\NimDaydu
  ```

### 3. 运行安装脚本

1. 打开 NimDaydu 文件夹。
2. 在资源管理器的地址栏里输入 `powershell`，按回车，会打开一个已经位于这个文件夹的 PowerShell 窗口。
3. 运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
   ```

脚本会安装依赖、下载模型并构建 Chrome 扩展，所有内容都放在这个文件夹里。网络中断时，重新运行同一条命令即可，已下载的部分会接着用。

### 4. 把扩展加载到 Chrome

1. 在 Chrome 地址栏打开 `chrome://extensions`，打开右上角的 **开发者模式**。
2. 点 **加载未打包的扩展程序**，选择 NimDaydu 文件夹里的 `extension\.output\chrome-mv3`，也就是包含 `manifest.json` 的那个文件夹。
3. 点工具栏上的拼图图标，把 NimDaydu 固定到工具栏，方便以后点击。

## 日常使用

1. 双击 **Start-NimDaydu.cmd**。看到 “NimDaydu is ready” 就可以了。第一次启动要准备显卡，可能需要半分钟左右。
2. 打开有英文声音的网页，点工具栏里的 NimDaydu 图标，或按 **Alt + Shift + N**，然后在侧栏点 **开始**。
3. 网页全屏时，悬浮字幕会自动出现。随时按 **Alt + Shift + O** 可以显示或隐藏它。
4. 用完先在侧栏点 **结束**。不用时双击 **Stop-NimDaydu.cmd** 释放内存。

<table><tr>
<td width="36%" valign="top"><img src="images/sidepanel.png" alt="侧栏：每个英文短句上方是它的中文，最下面是正在说的英文"></td>
<td valign="top"><img src="images/overlay.png" alt="悬浮字幕：半透明字幕框叠在网页画面上"></td>
</tr><tr>
<td align="center"><sub>侧栏</sub></td>
<td align="center"><sub>悬浮字幕，拖动可以移动，拖顶部横条调高度</sub></td>
</tr></table>

可以把两个 `.cmd` 文件发送到桌面快捷方式。关闭 Chrome 不会自动关闭本机服务。

## 更新到新版本

1. 在侧栏点 **结束**，双击 **Stop-NimDaydu.cmd**。
2. 获取新版代码：用 Git 的话运行 `git pull`；用压缩包的话，下载新的 ZIP，覆盖到原来的文件夹。
3. 重新运行安装脚本：`powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1`。已下载的模型会保留，不会重新下载。
4. 在 `chrome://extensions` 里点 NimDaydu 的 **重新加载**，然后双击 **Start-NimDaydu.cmd**。

设置和已保存的字幕都会保留。

## 卸载

1. 双击 **Stop-NimDaydu.cmd**。
2. 在 `chrome://extensions` 里移除 NimDaydu。
3. 删除整个 NimDaydu 文件夹。先把 `OUTPUTS` 里想留下的字幕复制出来。

## 常见问题

| 情况 | 处理 |
|---|---|
| 双击 Start-NimDaydu.cmd 后窗口一闪而过 | 在 NimDaydu 文件夹的 PowerShell 里运行 `.\start.ps1` 查看提示。详细日志在 `.nimdaydu\service.err.log` |
| 提示找不到 uv 或 node | 回到第 1 步安装，然后关闭再重新打开 PowerShell |
| 设置页显示翻译模型是 OPUS-MT | 说明 HY-MT 没有启动成功。更新显卡驱动后，重新运行 `setup.ps1`。日志在 `.nimdaydu\translator.log` |
| 提示“语音识别持续积压” | 关闭视频剪辑、大型游戏等占用 CPU 很多的程序。笔记本插电使用效果更好 |
| 端口 8765 被占用 | 先双击 Stop-NimDaydu.cmd。如果还是不行，重启电脑 |

更多使用说明见 [README](../README.md)。
