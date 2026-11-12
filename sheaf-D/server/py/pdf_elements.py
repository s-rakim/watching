"""What is on each PDF page, as separate pieces, for the editable Word converter.

    pdf_to_docx.py <in.pdf> <outdir> elements
        writes <outdir>/elements.json and the pictures under <outdir>/media/
    pdf_to_docx.py <in.pdf> <outdir> regions <regions.json>
        renders each { page, x, y, w, h, key } to <outdir>/<key>.png, without photos

The JSON matches the input of src/docxflow.js: text pieces, rectangles, lines, other
drawn shapes and pictures, all in points from the top-left of the page as it is shown.
"""

import hashlib
import io
import json
import os
import re
from collections import Counter

import numpy as np
import pymupdf
from PIL import Image

RTL = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")


def hexcolor(c, alpha=1.0):
    if c is None:
        return None
    if len(c) == 1:
        c = (c[0], c[0], c[0])
    elif len(c) == 4:
        k = c[3]
        c = ((1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k))
    if alpha is None:
        alpha = 1.0
    vals = [255 - (255 - v * 255) * alpha for v in c[:3]]
    return "".join("%02X" % max(0, min(255, round(v))) for v in vals)


# ------------------------------------------------------------------ drawings

def subpaths(items, m):
    """PyMuPDF path items -> subpaths of ['M'|'L'|'C', x, y, ...] in page-as-shown points."""
    out, cur, end = [], None, None

    def pt(p):
        q = pymupdf.Point(p) * m
        return [q.x, q.y]

    def start(p):
        nonlocal cur
        cur = [["M", *pt(p)]]
        out.append(cur)

    for it in items:
        kind = it[0]
        if kind == "re":
            r = pymupdf.Rect(it[1])
            sp = [["M", *pt(r.tl)], ["L", *pt(r.tr)], ["L", *pt(r.br)], ["L", *pt(r.bl)]]
            out.append(sp)
            cur, end = None, None
            continue
        if kind == "qu":
            q = it[1]
            out.append([["M", *pt(q.ul)], ["L", *pt(q.ur)], ["L", *pt(q.lr)], ["L", *pt(q.ll)]])
            cur, end = None, None
            continue
        p0 = pymupdf.Point(it[1])
        if cur is None or end is None or abs(p0.x - end.x) > 0.01 or abs(p0.y - end.y) > 0.01:
            start(p0)
        if kind == "l":
            cur.append(["L", *pt(it[2])])
            end = pymupdf.Point(it[2])
        elif kind == "c":
            cur.append(["C", *pt(it[2]), *pt(it[3]), *pt(it[4])])
            end = pymupdf.Point(it[4])
    return out


def bbox_of(sp):
    xs = [v for s in sp for v in s[1::2]]
    ys = [v for s in sp for v in s[2::2]]
    x, y = min(xs), min(ys)
    return {"x": x, "y": y, "w": max(xs) - x, "h": max(ys) - y}


def classify(sp):
    """Rectangle, rounded rectangle, single line, or something else? Same rules as Sheaf."""
    b = bbox_of(sp)
    ends = [(s[-2], s[-1]) for s in sp]
    curves = [s for s in sp if s[0] == "C"]
    straight = all(s[0] != "L" or abs(s[1] - ends[k][0]) < 0.6 or abs(s[2] - ends[k][1]) < 0.6
                   for k, s in enumerate(sp[1:]))
    if not straight:
        return "shape", b
    if not curves:
        if len(sp) == 2:
            return "line", {**b, "x1": sp[0][1], "y1": sp[0][2], "x2": sp[1][1], "y2": sp[1][2]}
        if 4 <= len(sp) <= 6:
            return "rect", b
        return "shape", b
    reach = min(b["w"], b["h"]) / 2 + 1

    def near(x, y):
        return (min(x - b["x"], b["x"] + b["w"] - x) <= reach and
                min(y - b["y"], b["y"] + b["h"] - y) <= reach)

    if all(near(c[k], c[k + 1]) for c in curves for k in range(1, len(c), 2)) and b["w"] > 6 and b["h"] > 6:
        return "rect", {**b, "round": True}
    return "shape", b


def read_drawings(page, m, sample):
    rects, lines, shapes = [], [], []
    stack = []  # (level, scissor) of the clips and groups around the current path
    for d in page.get_drawings(extended=True):
        level = d.get("level", 0)
        while stack and stack[-1][0] >= level:
            stack.pop()
        if d["type"] in ("clip", "group"):
            stack.append((level, pymupdf.Rect(d["scissor"]) if d["type"] == "clip" and d.get("scissor") else None))
            continue
        # Chrome often draws a box's coloured edge as the whole box clipped to a thin strip.
        clip = pymupdf.Rect(-1e9, -1e9, 1e9, 1e9)
        for _, sc in stack:
            if sc is not None:
                clip &= sc
        clip = clip * m if clip.width < 1e8 else None
        if clip is not None and clip.is_empty:
            continue
        fills = "f" in d["type"]
        strokes = "s" in d["type"]
        fill = hexcolor(d.get("fill"), d.get("fill_opacity")) if fills else None
        stroke = hexcolor(d.get("color"), d.get("stroke_opacity")) if strokes else None
        lw = max(0.25, d.get("width") or 1) if strokes else 0
        for sp in subpaths(d["items"], m):
            if len(sp) < 2:
                continue
            kind, b = classify(sp)
            if clip is not None:
                r = pymupdf.Rect(b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"])
                if not (clip.x0 - 0.5 <= r.x0 and r.x1 <= clip.x1 + 0.5 and clip.y0 - 0.5 <= r.y0 and r.y1 <= clip.y1 + 0.5):
                    cut = r & clip
                    if cut.is_empty or cut.width <= 0 or cut.height <= 0:
                        continue
                    if kind == "line":
                        b = {**b, "x1": max(min(b["x1"], cut.x1), cut.x0), "x2": max(min(b["x2"], cut.x1), cut.x0),
                             "y1": max(min(b["y1"], cut.y1), cut.y0), "y2": max(min(b["y2"], cut.y1), cut.y0)}
                    elif kind == "rect":
                        # a rounded box cut down to a strip is a plain strip
                        b = {"x": cut.x0, "y": cut.y0, "w": cut.width, "h": cut.height,
                             "round": bool(b.get("round")) and cut.width > r.width * 0.8 and cut.height > r.height * 0.8}
                    else:
                        b = {"x": cut.x0, "y": cut.y0, "w": cut.width, "h": cut.height}
            if kind == "rect":
                f = fill
                if fills and f is None:
                    f = sample(b)  # a gradient or pattern: its main colour
                rects.append({"x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "fill": f,
                              "stroke": stroke, "lw": lw, "round": bool(b.get("round"))})
            elif kind == "line" and strokes:
                lines.append({"x1": b["x1"], "y1": b["y1"], "x2": b["x2"], "y2": b["y2"], "color": stroke, "lw": lw})
            elif b["w"] > 0.5 or b["h"] > 0.5:
                shapes.append(b)
    return rects, lines, shapes


# ------------------------------------------------------------------ pictures

def to_pil(data):
    pix = pymupdf.Pixmap(data)
    if pix.colorspace and pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    mode = {1: "L", 2: "LA", 3: "RGB", 4: "RGBA"}[pix.n]
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


def oriented(img, mat):
    """The picture turned the way the page shows it, or None if it is skewed."""
    a, b, c, d = mat.a, mat.b, mat.c, mat.d
    if abs(b) < 1e-3 and abs(c) < 1e-3:
        if a < 0:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if d < 0:
            img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        return img
    if abs(a) < 1e-3 and abs(d) < 1e-3:
        img = img.transpose(Image.Transpose.TRANSPOSE)
        if c < 0:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if b < 0:
            img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        return img
    return None


def opacity(img, bare, box, s):
    """How strongly the picture shows on the page, from the page as drawn: a watermark drawn
    at 7% leaves a much paler mark than its own pixels."""
    x0, y0 = int(box["x"] * s), int(box["y"] * s)
    x1, y1 = int((box["x"] + box["w"]) * s), int((box["y"] + box["h"]) * s)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(bare.width, x1), min(bare.height, y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 1.0
    # where the picture is, relative to the cropped page area
    full = (int(box["w"] * s), int(box["h"] * s))
    if full[0] < 4 or full[1] < 4:
        return 1.0
    flat = Image.new("RGB", img.size, "white")
    flat.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[3])
    flat = flat.resize(full)
    ox, oy = x0 - int(box["x"] * s), y0 - int(box["y"] * s)
    src = np.asarray(flat, dtype=np.float32)[oy:oy + (y1 - y0), ox:ox + (x1 - x0)]
    seen = np.asarray(bare.crop((x0, y0, x1, y1)), dtype=np.float32)[:src.shape[0], :src.shape[1]]
    dark = (255 - src).sum(axis=2)
    keep = dark > 120
    if keep.sum() < 50:
        return 1.0
    ratio = (255 - seen).sum(axis=2)[keep] / dark[keep]
    return float(min(1.0, max(0.02, np.median(ratio))))


def flat_colour(img):
    """The colour of a picture that is all one colour, or None."""
    if img.mode in ("LA", "RGBA") and np.asarray(img)[:, :, -1].min() < 250:
        return None
    a = np.asarray(img.convert("RGB"), dtype=np.float32).reshape(-1, 3)
    if a.std(axis=0).max() > 4:
        return None
    return "%02X%02X%02X" % tuple(int(round(v)) for v in a.mean(axis=0))


class Media:
    def __init__(self, outdir):
        self.dir = os.path.join(outdir, "media")
        os.makedirs(self.dir, exist_ok=True)
        self.items = {}

    def add(self, key, data, ext):
        if key not in self.items:
            name = f"{key}.{'jpeg' if ext == 'jpeg' else 'png'}"
            with open(os.path.join(self.dir, name), "wb") as f:
                f.write(data)
            self.items[key] = {"file": f"media/{name}", "ext": "jpeg" if ext == "jpeg" else "png"}
        return key


def read_images(page, m, bare, s, media, shapes, rects):
    images = []
    visible = pymupdf.Rect(0, 0, bare.width / s, bare.height / s)
    for blk in page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT | pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]:
        if blk["type"] != 1 or not blk.get("image"):
            continue
        mat = pymupdf.Matrix(blk["transform"]) * m
        r = pymupdf.Rect(blk["bbox"]) * m
        if r.is_empty or not r.intersects(visible):
            continue
        box = {"x": r.x0, "y": r.y0, "w": r.width, "h": r.height}
        try:
            img = to_pil(blk["image"])
            if blk.get("mask"):
                mask = to_pil(blk["mask"]).convert("L").resize(img.size)
                img = img.convert("RGBA")
                img.putalpha(mask)
        except Exception:
            shapes.append(box)
            continue
        img = oriented(img, mat)
        if img is None:
            shapes.append(box)
            continue
        flat = flat_colour(img)
        if flat and box["w"] > 2 and box["h"] > 2:
            # Chrome paints some card backgrounds as a one-colour picture: that is a filled box
            rects.append({**box, "fill": flat, "stroke": None, "lw": 0, "round": False})
            continue
        alpha = opacity(img, bare, box, s)
        # Only watermarks are drawn see-through on purpose; a middling reading is thin
        # strokes blurred by the comparison, not real transparency.
        if alpha > 0.5:
            alpha = 1.0
        alpha = round(alpha, 2)
        digest = hashlib.md5(blk["image"] + (blk.get("mask") or b"")).hexdigest()[:16]
        key = f"{digest}-{int(alpha * 100)}-{int(mat.a < 0)}{int(mat.d < 0)}{int(abs(mat.b) > 1e-3)}"
        if key not in media.items:
            plain = (blk["ext"] in ("jpeg", "jpg") and not blk.get("mask") and alpha == 1.0
                     and abs(mat.b) < 1e-3 and mat.a > 0 and mat.d > 0 and blk.get("colorspace") in (1, 3))
            if plain:
                media.add(key, blk["image"], "jpeg")
            else:
                if alpha < 1:
                    img = img.convert("RGBA")
                    a = np.asarray(img).copy()
                    a[:, :, 3] = (a[:, :, 3].astype(np.float32) * alpha).astype(np.uint8)
                    img = Image.fromarray(a, "RGBA")
                buf = io.BytesIO()
                if img.mode in ("RGB", "L") and img.width * img.height > 250_000:
                    img.save(buf, "JPEG", quality=90)
                    media.add(key, buf.getvalue(), "jpeg")
                else:
                    img.save(buf, "PNG", optimize=True)
                    media.add(key, buf.getvalue(), "png")
        images.append({**box, "id": key, "alpha": alpha, "faint": alpha < 0.5})
    return images


# ------------------------------------------------------------------ text

def text_items(chars, fonts):
    """Characters -> pieces of one style, cut at spaces and at gaps between words."""
    items, cur, prev = [], None, None

    def flush():
        nonlocal cur
        if cur:
            items.append(cur)
        cur = None

    for c in chars:
        f = fonts[c["font"]]
        size = c["size"]
        if c["c"].isspace():
            flush()
            items.append({"str": " ", "x": c["x0"], "w": max(0.1, c["x1"] - c["x0"]), "base": c["base"], "size": size,
                          "font": f["family"], "kind": f["kind"], "bold": bool(f.get("bold")),
                          "italic": bool(f["italic"]), "color": c["color"], "link": c["link"]})
            prev = c
            continue
        same = (cur and prev and abs(prev["base"] - c["base"]) < 0.3 and prev["font"] == c["font"]
                and abs(prev["size"] - size) < 0.1 and prev["color"] == c["color"] and prev["link"] == c["link"])
        if same:
            rtl = RTL.search(c["c"])
            gap = (prev["x0"] - c["x1"]) if rtl else (c["x0"] - prev["x1"])
            if gap > size * 0.15 or gap < -size * 0.6:
                same = False
        if not same:
            flush()
            cur = {"str": "", "x": c["x0"], "w": 0, "base": c["base"], "size": size, "font": f["family"],
                   "kind": f["kind"], "bold": bool(f.get("bold")), "italic": bool(f["italic"]),
                   "color": c["color"], "link": c["link"]}
        cur["str"] += c["c"]
        x0, x1 = min(cur["x"], c["x0"]), max(cur["x"] + cur["w"], c["x1"])
        cur["x"], cur["w"] = x0, x1 - x0
        prev = c
    flush()
    for it in items:
        it["str"] = clean(it["str"])
    return [it for it in items if it["str"]]


def clean(s):
    import unicodedata
    s = unicodedata.normalize("NFKC", s)
    return re.sub("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f�]", "", s)


def hidden_text(page, m):
    """Every word on the page, seen or not: the OCR layer of a scan."""
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        r = pymupdf.Rect(x0, y0, x1, y1) * m
        size = max(4.0, r.height * 0.85)
        out.append({"str": clean(word), "x": r.x0, "w": r.width, "base": r.y1 - r.height * 0.2, "size": size,
                    "font": "Arial", "kind": "sans", "bold": False, "italic": False, "color": "000000", "link": None})
        out.append({"str": " ", "x": r.x1, "w": size * 0.25, "base": r.y1 - r.height * 0.2, "size": size,
                    "font": "Arial", "kind": "sans", "bold": False, "italic": False, "color": "000000", "link": None})
    return [t for t in out if t["str"]]


def slanted_text(page, m):
    """Boxes around text that is not upright; it goes into a picture with what's around it."""
    turn = pymupdf.Matrix(m.a, m.b, m.c, m.d, 0, 0)
    out = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            d = pymupdf.Point(line["dir"]) * turn
            if abs(d.y) < 0.02 and d.x > 0:
                continue
            if not "".join(c["c"] for s in line["spans"] for c in s["chars"]).strip():
                continue
            r = pymupdf.Rect(line["bbox"]) * m
            pad = 2
            out.append({"x": r.x0 - pad, "y": r.y0 - pad, "w": r.width + pad * 2, "h": r.height + pad * 2})
    return out


# ------------------------------------------------------------------ entry points

def elements(src, outdir, read_page, Fonts):
    os.makedirs(outdir, exist_ok=True)
    doc = pymupdf.open(src)
    bare_doc = pymupdf.open(src)
    fonts = Fonts(doc)
    media = Media(outdir)
    pages = []
    for i in range(doc.page_count):
        got = read_page(doc, bare_doc, i, fonts, pieces=True)
        page = doc[i]
        m = page.rotation_matrix
        bare, s = got["bare"], got["scale"]
        arr = np.asarray(bare)

        def sample(b):
            pts = [(b["x"] + b["w"] * fx, b["y"] + b["h"] * fy) for fx, fy in
                   ((0.1, 0.1), (0.9, 0.1), (0.1, 0.9), (0.9, 0.9), (0.5, 0.5))]
            cols = []
            for px, py in pts:
                X = min(arr.shape[1] - 1, max(0, round(px * s)))
                Y = min(arr.shape[0] - 1, max(0, round(py * s)))
                cols.append("%02X%02X%02X" % tuple(int(v) for v in arr[Y, X][:3]))
            return Counter(cols).most_common(1)[0][0]

        rects, lines, shapes = read_drawings(page, m, sample)
        images = read_images(page, m, bare, s, media, shapes, rects)
        texts = text_items(got["chars"], got["fonts"])
        shapes += slanted_text(page, m)
        # A scan with an OCR layer: the words are invisible, over one big picture. Word
        # gets the words as real text and the picture goes.
        area = got["w"] * got["h"]
        scan = next((im for im in images if im["w"] * im["h"] > area * 0.8), None)
        if scan:
            hidden = hidden_text(page, m)
            words = [t for t in hidden if t["str"].strip()]
            seen = [t for t in texts if t["str"].strip()]
            if len(words) > 20 and len(seen) < len(words) * 0.2:
                images = [im for im in images if im is not scan]
                texts = hidden
        pages.append({"w": got["w"], "h": got["h"], "texts": texts, "rects": rects, "lines": lines,
                      "shapes": shapes, "images": images})
    title = doc.metadata.get("title") or re.sub(r"\.[^.]+$", "", os.path.basename(src))
    with open(os.path.join(outdir, "elements.json"), "w", encoding="utf-8") as f:
        json.dump({"title": title, "pages": pages, "media": media.items}, f, ensure_ascii=False)


def regions(src, outdir, spec):
    """Charts and other drawings Word has nothing editable for, as pictures. Photos are
    already separate pictures in the document, so they are left out."""
    with open(spec, encoding="utf-8") as f:
        wanted = json.load(f)
    doc = pymupdf.open(src)
    cleared = set()
    os.makedirs(outdir, exist_ok=True)
    for r in wanted:
        page = doc[r["page"]]
        if r["page"] not in cleared:
            cleared.add(r["page"])
            rot = page.rotation
            page.set_rotation(0)
            page.add_redact_annot(page.rect, fill=False)
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                                  graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                                  text=getattr(pymupdf, "PDF_REDACT_TEXT_NONE", 1))
            page.set_rotation(rot)
        scale = min(3.0, (12e6 / max(1.0, r["w"] * r["h"])) ** 0.5)
        clip = pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
        # clip is in the page as shown, which is what get_pixmap takes
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
        pix.save(os.path.join(outdir, f"{r['key']}.png"))
