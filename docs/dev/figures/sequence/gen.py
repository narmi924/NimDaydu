"""What happens to one line of speech, for the README. Run with `fig build gen.py --look readme`."""
from pathlib import Path

from paperfig import Figure, Theme, glyph, si

HERE = Path(__file__).parent

# Same colours as the architecture figure: charcoal for 采音页, green for sound and English, amber for Chinese.
CHAR = "#191A1D"
GREEN = "#3F7A60"
AMBER = "#8A6A2E"
th = Theme.board(accent=GREEN, font="Inter").with_(scale=1.1, line="#5A626B", back=AMBER)
f = Figure("sequence", th)
ICON = "#3A444D"
SPEAKER = glyph('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>'
                '<path d="M19 7a7 7 0 0 1 0 10"/>', ICON)
WAVE = glyph('<path d="M3 12h1.5M7 8v8M11 4v16M15 8v8M19 10.5v3"/>', ICON)
PANEL = glyph('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M14.5 5v14M17 9h2M17 12h2"/>', ICON)

# ---------------------------------------------------------------- grid
PAGE, VIEW, HUB, MT, ASR = 124, 338, 552, 776, 990    # lifelines
PW, PH, PY = 188, 52, 54                               # participant cards
LIFE_TOP, LIFE_END = PY + PH, 676
ROW = {"sound": 182, "pcm": 218, "live": 254, "show": 290,
       "done": 316,
       "draft": 364, "draft_zh": 400, "draft_show": 436,
       "settle": 462,
       "final": 510, "same": 546, "redo": 584, "redo_zh": 616, "final_show": 652}
BRACKET = (1028, 1052)

# ---------------------------------------------------------------- participants
PAD = 8                                                # group padding around the cards
f.group(PAGE - PW / 2 - PAD, 14, HUB - PAGE + PW + 2 * PAD, 106, "Chrome")
f.group(MT - PW / 2 - PAD, 14, ASR - MT + PW + 2 * PAD, 106, "本机服务")
f.card(PAGE - PW / 2, PY, PW, PH, "会议网页", "标签页声音", icon=SPEAKER)
f.card(VIEW - PW / 2, PY, PW, PH, "侧栏 · 悬浮字幕", "显示字幕", icon=PANEL)
f.box(HUB - PW / 2, PY, PW, PH, fill="#FFFFFF", stroke=CHAR, width=1.6, role="card")
f.text(HUB - PW / 2 + 14, PY, PW - 20, PH, f.t("采音页", color=CHAR, weight=700) + "<br>" + f.sub("offscreen 文档"))
f.card(MT - PW / 2, PY, PW, PH, "HY-MT1.5-1.8B", "本机翻译", icon=si("tencenthy"), tone="brand", brand=AMBER)
f.card(ASR - PW / 2, PY, PW, PH, "识别", "Moonshine · Parakeet", icon=WAVE, tone="brand", brand=GREEN)

def phase(y, text):
    """A phase title over the lifelines, on the page colour so the dashed lines break behind it."""
    style = ("text;html=1;align=left;verticalAlign=middle;spacing=0;spacingRight=6;whiteSpace=nowrap;"
             f"{th.font_style()}fontSize={th.size('card')};fontStyle=1;fontColor={th.ink};"
             f"labelBackgroundColor={th.canvas};")
    f._vertex("labels", text, style, 24, y, 220, 20, "label", lines=1)


# lifelines stop where an activation bar covers them
BARS = {MT: [("draft", "draft_zh"), ("redo", "redo_zh")], ASR: [("done", "final")]}
for x in (PAGE, VIEW, HUB, MT, ASR):
    edges = [LIFE_TOP] + [ROW[k] for bar in BARS.get(x, []) for k in bar] + [LIFE_END]
    for top, bottom in zip(edges[0::2], edges[1::2]):
        f.line([(x, top), (x, bottom)], color="#B9C0C7", width=1, end=False, dashed=True, flow=None, check=False)

# activations: the second pass of recognition, and the two translations
f.box(ASR - 5, ROW["done"], 10, ROW["final"] - ROW["done"], fill="#E3EEE8", stroke=GREEN, r=2,
      check=False)
f.text(ASR - 150, (ROW["done"] + ROW["final"]) / 2 - 20, 138, 40,
       f.sub("Parakeet 复核", color=th.ink) + "<br>" + f.sub("再等 0.4 s 成句"), align="right")
for a, b in (("draft", "draft_zh"), ("redo", "redo_zh")):
    f.box(MT - 5, ROW[a], 10, ROW[b] - ROW[a], fill="#F1EADD", stroke=AMBER, r=2, check=False)


ACTIVE = {(MT, "draft"), (MT, "draft_zh"), (MT, "redo"), (MT, "redo_zh"), (ASR, "final")}


def message(a, b, row, text, colour, back=False, at=None):
    """A message from lifeline a to b; the label sits above it, inside one gap between lifelines."""
    y = ROW[row]
    step = 5 if b > a else -5          # start and end on the edge of an activation bar
    x1 = a + step if (a, row) in ACTIVE else a
    x2 = b - step if (b, row) in ACTIVE else b
    f.line([(x1, y), (x2, y)], color=colour, dashed=back, check=False)
    lo, hi = at or (min(a, b), max(a, b))
    f.text(lo + 8, y - 21, hi - lo - 16, 18, f.sub(text, color=th.ink), align="center")


# ① while someone is speaking
phase(ROW["sound"] - 40, "① 边说边出")
message(PAGE, HUB, "sound", "声音", GREEN, at=(PAGE, VIEW))
message(HUB, ASR, "pcm", "PCM · 每 80 ms", GREEN, at=(HUB, MT))
message(ASR, HUB, "live", "实时英文 · 约每 0.5 s", GREEN, at=(MT, ASR))
message(HUB, VIEW, "show", "最下面一行英文", CHAR)

# ② the line is finished: translate it at once while the model is idle
f.line([(24, ROW["done"]), (BRACKET[1] + 140, ROW["done"])], color="#C9CED3", width=1, end=False, dashed=True,
       flow=None, check=False)
phase(ROW["done"] + 8, "② 一行说完，先翻一版")
message(HUB, MT, "draft", "这一行英文 · 模型空闲时", AMBER)
message(MT, HUB, "draft_zh", "中文 · 约 0.5 s", AMBER, back=True)
message(HUB, VIEW, "draft_show", "浅色中文", CHAR)

# ③ the second pass settles the line
f.line([(24, ROW["settle"]), (ASR - 12, ROW["settle"])], color="#C9CED3", width=1, end=False, dashed=True,
       flow=None, check=False)
phase(ROW["settle"] + 8, "③ 复核定稿")
message(ASR, HUB, "final", "定稿英文", GREEN, at=(MT, ASR))
y = ROW["same"]
f.line([(HUB, y - 8), (HUB + 36, y - 8), (HUB + 36, y + 8), (HUB, y + 8)], color=AMBER, check=False)
f.text(HUB + 46, y - 10, 170, 20, f.sub("英文没变：沿用早译", color=th.ink))
message(HUB, MT, "redo", "英文变了：重新翻译", AMBER)
message(MT, HUB, "redo_zh", "中文", AMBER, back=True)
message(HUB, VIEW, "final_show", "定稿中文", CHAR)

# how long the reader waits, measured on a public meeting recording
for x, bottom, title, value in ((BRACKET[1], ROW["draft_show"], "首个中文", "中位 0.94 s"),
                                (BRACKET[0], ROW["final_show"], "定稿中文", "中位 1.72 s")):
    f.line([(x - 6, ROW["done"]), (x, ROW["done"]), (x, bottom), (x - 6, bottom)], color=th.ink_soft, width=1.2,
           end=False, flow=None, check=False)
lx = BRACKET[1] + 12
f.text(lx, (ROW["done"] + ROW["draft_show"]) / 2 - 20, 130, 40,
       f.t("首个中文", size=12.5) + "<br>" + f.sub("中位 0.94 s"))
f.text(BRACKET[0] + 12, (ROW["draft_show"] + ROW["final_show"]) / 2 - 20, 150, 40,
       f.t("定稿中文", size=12.5) + "<br>" + f.sub("中位 1.72 s"))
f.text(BRACKET[0] - 6, ROW["done"] - 22, 170, 18, f.sub("从这一行说完算起", color=th.ink_faint))
f.text(BRACKET[0] - 6, LIFE_END - 4, 170, 18, f.sub("AMI 会议录音实测", color=th.ink_faint))

f.export(HERE / "sequence", formats=("png", "svg"), motion=False)
