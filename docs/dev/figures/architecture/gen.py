"""NimDaydu architecture for the README. Run with `fig build gen.py --look readme`."""
from pathlib import Path

from paperfig import Figure, Theme, glyph, logo, si, tint

HERE = Path(__file__).parent
ROOT = HERE.parents[3]

# Colours from the extension itself (brief.md): the icon's charcoal, the "capturing" green and the amber of
# timestamps, deepened for lines and borders on a light page.
CHAR = "#191A1D"
GREEN = "#3F7A60"      # sound and English
AMBER = "#8A6A2E"      # translation and Chinese
th = Theme.board(accent=GREEN, font="Inter").with_(scale=1.1, line="#5A626B", back=AMBER)
f = Figure("architecture", th)
ICON = "#3A444D"


def line_icon(body):
    return glyph(body, ICON)


SPEAKER = line_icon('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>'
                    '<path d="M19 7a7 7 0 0 1 0 10"/>')
WAVE = line_icon('<path d="M3 12h1.5M7 8v8M11 4v16M15 8v8M19 10.5v3"/>')
LINES = line_icon('<path d="M4 6h16M4 11h10M4 16h16M4 21h7"/>')
FOLDER = line_icon('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15'
                   'A1.5 1.5 0 0 1 3 17.5z"/>')
PANEL = line_icon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M14.5 5v14M17 9h2M17 12h2"/>')

# ---------------------------------------------------------------- grid
TOP = 76                     # top of the two groups
Y_LIVE = 158                 # corridor: live English skips the second pass
Y_MAIN = 210                 # sound → 采音页 → Moonshine → Parakeet → 成句
Y_BACK = 272                 # English lines come back; the same row fans out to the two caption views
Y_TR = 330                   # translation
Y_SAVE = 390                 # saving
BOTTOM = 436

CH_X, CH_W = 36, 444         # Chrome group
SV_X, SV_W = 556, 636        # local service group
LEFT_X, LEFT_W = 52, 228     # the web page frame and the side panel
HUB_X, HUB_W = 318, 146      # 采音页
HUB_R = HUB_X + HUB_W
TRUNK = 299                  # captions fan out here
INNER = 138                  # first row under a group's title and note
SIDE = 362                   # the side panel, under the web page
GAP = (CH_X + CH_W + SV_X) / 2   # labels for the lines that cross from Chrome to the service
COL = [SV_X + 16 + k * (180 + 32) for k in range(3)]   # Moonshine, Parakeet, 成句 / OUTPUTS
CW, CH = 180, 52
MID = [x + CW / 2 for x in COL]

# ---------------------------------------------------------------- frames
f.group(16, 16, SV_X + SV_W, BOTTOM, "你的电脑", note="Windows 或 Mac · 识别和翻译都在本机",
        tone="clear")
f.group(CH_X, TOP, CH_W, BOTTOM - TOP, "Chrome", note="NimDaydu 扩展",
        logos=(si("googlechrome"), logo(ROOT / "extension/public/icon.svg")))
f.group(SV_X, TOP, SV_W, BOTTOM - TOP, "本机服务", note="FastAPI · 127.0.0.1:8765", logos=(si("fastapi"),))

# legend, on the title row of the outer frame
lx = SV_X + SV_W - 286
for k, (colour, text) in enumerate([(GREEN, "声音和英文"), (AMBER, "翻译和中文")]):
    x = lx + k * 146
    f.line([(x, 32), (x + 30, 32)], color=colour, end=False, flow=None, check=False)
    f.text(x + 38, 22, 100, 20, f.sub(text))

# ---------------------------------------------------------------- Chrome
f.group(LEFT_X, INNER, LEFT_W, Y_BACK + 30 + 26 - INNER, "会议 / 视频网页", note="Meet · YouTube · Discord")
f.card(LEFT_X + 16, Y_MAIN - 18, LEFT_W - 32, 36, "标签页声音", icon=SPEAKER, isize=18)

# the caption overlay, drawn as it looks: a dark box with real lines from a public meeting recording
OV_X, OV_Y, OV_W, OV_H = LEFT_X + 16, Y_BACK - 32, LEFT_W - 32, 64
f.box(OV_X, OV_Y, OV_W, OV_H, fill="#2A2D31", stroke="#2A2D31", r=6)
f.text(OV_X + 10, OV_Y + 6, OV_W - 16, 52,
       f.t("我推测应该是这样。", size=13, weight=400, color="#FFFFFF") + "<br>"
       + f.sub("I presume so.", size=11.5, color="#C9CDD3") + "<br>"
       + f.sub("You've got market range…", size=11.5, color="#8E959E"))
f.text(LEFT_X + 16, OV_Y + OV_H + 4, OV_W, 18, f.sub("悬浮字幕", size=12), align="center")

f.card(LEFT_X, SIDE - 23, LEFT_W, 46, "侧栏", "中英对照 · 回看 · 导出", icon=PANEL, isize=20)

# 采音页: every line of the figure meets here, one row per job
f.box(HUB_X, INNER, HUB_W, Y_SAVE + 24 - INNER, fill="#FFFFFF", stroke=CHAR, width=1.6, role="card")
f.text(HUB_X + 12, INNER + 6, HUB_W - 20, 36, f.t("采音页", color=CHAR, weight=700) + "<br>" + f.sub("offscreen 文档"))
for y, text in [(Y_MAIN, "取声音 · 每 80 ms"), (Y_BACK, "分发字幕"), (Y_TR, "翻译队列 · 早译"), (Y_SAVE, "补存中文")]:
    f.text(HUB_X + 12, y - 10, HUB_W - 20, 20, f.sub(text, color=th.ink))

# ---------------------------------------------------------------- local service
rec = dict(tone="brand", brand=GREEN, isize=22)
f.card(COL[0], Y_MAIN - CH / 2, CW, CH, "Moonshine Small", "实时英文 · 每 0.5 s", icon=WAVE, **rec)
f.card(COL[1], Y_MAIN - CH / 2, CW, CH, "Parakeet TDT", "整句复核定稿", icon=si("nvidia"), **rec)
f.card(COL[2], Y_MAIN - CH / 2, CW, CH, "成句 · 切短句", "≤16 词一行 · 等 0.4 s", icon=LINES, **rec)
f.card(COL[0], Y_TR - 24, 240, 48, "HY-MT1.5-1.8B", "llama.cpp · Vulkan / Metal", icon=si("tencenthy"),
       tone="brand", brand=AMBER)
f.text(COL[0] + 256, Y_TR - 10, 200, 20, f.sub("启动失败时改用 OPUS-MT", color=th.ink_faint))
f.card(COL[2], Y_SAVE - 24, CW, 48, "OUTPUTS", "按日期保存文字", icon=FOLDER)

# ---------------------------------------------------------------- lines
# sound, straight along the main line
f.line([(LEFT_X + LEFT_W - 16, Y_MAIN), (HUB_X, Y_MAIN)], color=GREEN)
f.line([(HUB_R, Y_MAIN), (COL[0], Y_MAIN)], color=GREEN)
f.label(GAP - 22, Y_MAIN, 44, "PCM")
f.line([(COL[0] + CW, Y_MAIN), (COL[1], Y_MAIN)], color=GREEN)
f.line([(COL[1] + CW, Y_MAIN), (COL[2], Y_MAIN)], color=GREEN)
# live English goes round the second pass
f.line([(MID[0], Y_MAIN - CH / 2), (MID[0], Y_LIVE), (MID[2], Y_LIVE), (MID[2], Y_MAIN - CH / 2)], color=GREEN)
f.label(MID[1] - 34, Y_LIVE, 68, "实时英文", bg=th.group_fill)
# finished lines leave 成句 on one trunk: back to Chrome, and down to OUTPUTS
f.line([(MID[2], Y_MAIN + CH / 2), (MID[2], Y_BACK), (HUB_R, Y_BACK)], color=GREEN)
f.line([(MID[2], Y_MAIN + CH / 2), (MID[2], Y_SAVE - 24)], color=GREEN)
f.label(GAP - 22, Y_BACK, 44, "英文")
# captions fan out to the overlay and the side panel
f.line([(HUB_X, Y_BACK), (TRUNK, Y_BACK), (OV_X + OV_W, Y_BACK)], color=CHAR)
f.line([(HUB_X, Y_BACK), (TRUNK, Y_BACK), (TRUNK, SIDE), (LEFT_X + LEFT_W, SIDE)], color=CHAR)
# translation: English out, Chinese back
f.line([(HUB_R, Y_TR), (COL[0], Y_TR)], color=AMBER, start=True)
f.label(GAP - 22, Y_TR, 44, "翻译")
# Chinese is saved next to the English
f.line([(HUB_R, Y_SAVE), (COL[2], Y_SAVE)], color=AMBER)
f.label(GAP - 22, Y_SAVE, 44, "中文")

f.export(HERE / "architecture", formats=("png", "svg"), motion=False)
