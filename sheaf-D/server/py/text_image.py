"""Draws lines of text as transparent PNGs, for watermarks and page numbers in scripts the
PDF's standard fonts can't show (Chinese, Arabic, Hindi and so on).

    text_image.py <spec.json>
    spec: { "items": [{ "text": "...", "out": "a.png" }], "size": 48, "color": "D0342C",
            "bold": false, "family": "sans" }
Prints [{ "w": points, "h": points }] for each item. Pictures are drawn at 4 pixels a point.

Each character is drawn with the first installed font that has it, and with libraqm, when
Pillow has it, Arabic letters join and Indic vowel signs attach the way they should.
"""
import json
import os
import re
import sys

from fontTools.ttLib import TTCollection, TTFont
from PIL import Image, ImageDraw, ImageFont, features

SCALE = 4
NOTO = "/usr/share/fonts/truetype/noto"
CJK = "/usr/share/fonts/opentype/noto"
DEJAVU = "/usr/share/fonts/truetype/dejavu"

FAMILY = {
    ("sans", False): [f"{DEJAVU}/DejaVuSans.ttf", f"{NOTO}/NotoSans-Regular.ttf"],
    ("sans", True): [f"{DEJAVU}/DejaVuSans-Bold.ttf", f"{NOTO}/NotoSans-Bold.ttf"],
    ("serif", False): [f"{DEJAVU}/DejaVuSerif.ttf", f"{NOTO}/NotoSerif-Regular.ttf"],
    ("serif", True): [f"{DEJAVU}/DejaVuSerif-Bold.ttf", f"{NOTO}/NotoSerif-Bold.ttf"],
    ("mono", False): [f"{DEJAVU}/DejaVuSansMono.ttf"],
    ("mono", True): [f"{DEJAVU}/DejaVuSansMono-Bold.ttf"],
}
SCRIPTS = [
    f"{NOTO}/NotoNaskhArabic-Regular.ttf", f"{NOTO}/NotoSansArabic-Regular.ttf",
    f"{NOTO}/NotoSansHebrew-Regular.ttf", f"{NOTO}/NotoSansDevanagari-Regular.ttf",
    f"{NOTO}/NotoSansBengali-Regular.ttf", f"{NOTO}/NotoSansTamil-Regular.ttf",
    f"{NOTO}/NotoSansTelugu-Regular.ttf", f"{NOTO}/NotoSansGujarati-Regular.ttf",
    f"{NOTO}/NotoSansThai-Regular.ttf", f"{NOTO}/NotoSansGeorgian-Regular.ttf",
    f"{NOTO}/NotoSansArmenian-Regular.ttf", f"{NOTO}/NotoSansEthiopic-Regular.ttf",
    f"{CJK}/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
]
RTL = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")


class Face:
    def __init__(self, path):
        self.path, self.index = path, 0
        if path.endswith(".ttc"):
            fonts = TTCollection(path).fonts
            # the Simplified Chinese face covers the most characters people type
            names = [f["name"].getDebugName(1) or "" for f in fonts]
            self.index = next((i for i, n in enumerate(names) if n.endswith(" SC")), 0)
            cmap = fonts[self.index].getBestCmap()
        else:
            cmap = TTFont(path, lazy=True).getBestCmap()
        self.chars = set(cmap or {})

    def has(self, ch):
        return ord(ch) in self.chars


def faces(family, bold):
    out = []
    for p in FAMILY.get((family, bold), FAMILY[("sans", bold)]) + SCRIPTS:
        if os.path.exists(p):
            try:
                out.append(Face(p))
            except Exception:
                pass
    return out


def runs(text, chain):
    """Pieces of the text that one font can draw; spaces and marks stay with their neighbours."""
    out = []
    for ch in text:
        if ch.isspace() or ch in "‌‍" or (out and chain[out[-1][0]].has(ch)):
            if out:
                out[-1][1] += ch
                continue
        k = next((i for i, f in enumerate(chain) if f.has(ch)), 0)
        if out and out[-1][0] == k:
            out[-1][1] += ch
        else:
            out.append([k, ch])
    return out


def draw(text, size, colour, chain, out):
    px = max(4, round(size * SCALE))
    engine = ImageFont.Layout.RAQM if features.check("raqm") else ImageFont.Layout.BASIC
    pieces = []
    for k, s in runs(text, chain):
        font = ImageFont.truetype(chain[k].path, px, index=chain[k].index, layout_engine=engine)
        pieces.append((s, font))
    # right-to-left text: the pieces are laid out from the right
    if sum(len(RTL.findall(s)) for s, _ in pieces) * 2 > len(text.strip() or " "):
        pieces.reverse()
    ascent = max(f.getmetrics()[0] for _, f in pieces)
    descent = max(f.getmetrics()[1] for _, f in pieces)
    widths = [f.getlength(s) for s, f in pieces]
    w, h = max(1, round(sum(widths))), ascent + descent
    img = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rgb = tuple(int(colour[i:i + 2], 16) for i in (0, 2, 4))
    x = 1
    for (s, f), sw in zip(pieces, widths):
        d.text((x, 1 + ascent), s, font=f, fill=rgb + (255,), anchor="ls")
        x += sw
    img.save(out, optimize=True)
    return {"w": img.width / SCALE, "h": img.height / SCALE, "ascent": ascent / SCALE}


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        spec = json.load(f)
    chain = faces(spec.get("family", "sans"), bool(spec.get("bold")))
    if not chain:
        raise SystemExit("no fonts installed")
    colour = re.sub("[^0-9A-Fa-f]", "", spec.get("color", "000000"))[:6].ljust(6, "0")
    print(json.dumps([draw(it["text"], float(spec.get("size", 12)), colour, chain, it["out"]) for it in spec["items"]]))


if __name__ == "__main__":
    main()
