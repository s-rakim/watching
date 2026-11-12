"""PDF to Word.

Two ways to do it:

  layout (default)  The Word file looks like the PDF. Each page keeps its size. Boxes, rules,
                    charts, logos and photos go behind the page as one picture, and every piece
                    of text sits in a frame pinned where it was, in its own font, size, weight
                    and colour. The text is ordinary editable Word text.
  flow              pdf2docx rebuilds running paragraphs and tables. Easier to retype into,
                    but on designed pages (forms, report cards, flyers) it tends to scramble
                    the layout.

Usage: pdf_to_docx.py in.pdf out.docx [layout|flow]
"""
import io
import logging
import re
import sys
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

import numpy as np
import pymupdf
from PIL import Image

SAMPLE_SCALE = 4       # how finely the page is looked at for stroke widths and hidden text
BACKGROUND_DPI = 200   # resolution of the background picture in the Word file

KNOWN = {
    "arial": "Arial", "arialmt": "Arial", "helvetica": "Arial", "helveticaneue": "Helvetica Neue",
    "timesnewroman": "Times New Roman", "timesnewromanps": "Times New Roman", "times": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New", "symbol": "Symbol", "zapfdingbats": "Wingdings",
    "dejavusans": "DejaVu Sans", "dejavuserif": "DejaVu Serif", "calibri": "Calibri", "cambria": "Cambria",
    "georgia": "Georgia", "verdana": "Verdana", "tahoma": "Tahoma", "garamond": "Garamond",
}
STYLE_WORDS = re.compile(
    r"^(regular|roman|book|normal|medium|bold|semibold|demibold|extrabold|ultrabold|black|heavy|light|"
    r"extralight|ultralight|thin|italic|oblique|it|bolditalic|boldoblique|mt|ps|psmt|std|pro|condensed|cond)$",
    re.I,
)
FALLBACK = {"sans": ("Arial", "swiss", "variable"), "serif": ("Times New Roman", "roman", "variable"),
            "mono": ("Courier New", "modern", "fixed")}


def family_name(raw):
    """'ABCDEF+OpenSans-SemiboldItalic' -> 'Open Sans'."""
    n = re.sub(r"^[A-Z]{6}\+", "", raw or "")
    n = re.split(r"[-,]", n)[0]
    n = re.sub(r"(MT|PSMT|PS)$", "", n)
    key = re.sub(r"[^a-z]", "", n.lower())
    if key in KNOWN:
        return KNOWN[key]
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", n).split()
    while len(words) > 1 and STYLE_WORDS.match(words[-1]):
        words.pop()
    name = " ".join(words).strip()
    if name and not re.match(r"^(type3|t3|f\d+|font)", name, re.I):
        return name
    return ""


def font_kind(family, flags):
    if flags & 8 or re.search(r"mono|courier|consol", family, re.I):
        return "mono"
    if (flags & 4 or re.search(r"times|serif|georgia|garamond|cambria|roman|palatino", family, re.I)) \
            and not re.search(r"sans", family, re.I):
        return "serif"
    return "sans"


class Fonts:
    """Real names for the fonts on a page, including Type 3 fonts that only say 'Type3 (13 0 R)'."""

    def __init__(self, doc):
        self.doc = doc
        self.cache = {}

    def name(self, span_font):
        if span_font in self.cache:
            return self.cache[span_font]
        raw = span_font
        m = re.match(r"Type3 \((\d+) 0 R\)", span_font or "")
        if m:
            raw = ""
            kind, val = self.doc.xref_get_key(int(m.group(1)), "FontDescriptor")
            if kind == "xref":
                kind, val = self.doc.xref_get_key(int(val.split()[0]), "FontName")
                if kind == "name":
                    raw = val.lstrip("/")
        self.cache[span_font] = raw
        return raw


def render(page, scale):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def stem_width(diff, box):
    """Typical horizontal stroke width, in pixels, of the text inside box."""
    x0, y0, x1, y1 = box
    crop = diff[max(0, y0):y1, max(0, x0):x1]
    if crop.size == 0:
        return 0.0, 0
    peak = crop.max()
    if peak < 40:
        return 0.0, 0
    a = crop / peak
    a[a <= 0.15] = 0
    # Each row is padded with a zero so runs never wrap from one row into the next.
    flat = np.pad(a, ((0, 0), (0, 1))).ravel()
    on = (flat > 0).astype(np.int8)
    edges = np.diff(np.concatenate(([0], on, [0])))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    if not len(starts):
        return 0.0, 0
    sums = np.cumsum(np.concatenate(([0.0], flat)))
    runs = np.sort(sums[ends] - sums[starts])
    return float(runs[len(runs) // 2]), len(runs)


def read_page(doc, bare_doc, index, fonts, pieces=False):
    page = doc[index]
    w, h = page.rect.width, page.rect.height
    s = SAMPLE_SCALE
    raw = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    full_img = render(page, s)

    # The same page without its upright text. Rotated text can't sit in a Word frame, so it
    # stays in the picture.
    # Text positions come in the page's unrotated space; rm takes them to the page as shown.
    rm = page.rotation_matrix
    turn = pymupdf.Matrix(rm.a, rm.b, rm.c, rm.d, 0, 0)

    def upright(line):
        d = pymupdf.Point(line["dir"]) * turn
        return abs(d.y) < 0.02 and d.x > 0

    bare = bare_doc[index]
    rotation = bare.rotation
    bare.set_rotation(0)
    for block in bare.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            if upright(line):
                bare.add_redact_annot(pymupdf.Rect(line["bbox"]))
    bare.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    bare.set_rotation(rotation)
    bare_img = render(bare, s)
    diff = np.abs(np.asarray(full_img, dtype=np.int16) - np.asarray(bare_img, dtype=np.int16)).sum(axis=2)

    links = [(pymupdf.Rect(l["from"]), l["uri"]) for l in page.get_links() if l.get("uri")]

    font_info = {}   # span font -> dict(family, kind, named_bold, italic, stems)
    chars = []
    for block in raw["blocks"]:
        for line in block.get("lines", []):
            if not upright(line):
                continue
            for span in line["spans"]:
                if rotation:
                    for c in span["chars"]:
                        c["bbox"] = tuple(pymupdf.Rect(c["bbox"]) * rm)
                        c["origin"] = tuple(pymupdf.Point(c["origin"]) * rm)
                raw_name = fonts.name(span["font"])
                info = font_info.get(span["font"])
                if info is None:
                    family = family_name(raw_name) or ("Times New Roman" if span["flags"] & 4 else "Arial")
                    is_type3 = span["font"].startswith("Type3")
                    bold_name = bool(re.search(r"bold|black|heavy|semibold|demi", raw_name, re.I))
                    info = {
                        "family": family,
                        "kind": font_kind(family, span["flags"]),
                        # Type 3 fonts often say "Regular" whatever they look like
                        "named": True if bold_name or (span["flags"] & 16 and not is_type3) else
                        (None if is_type3 or not raw_name else
                         (False if re.search(r"regular|roman|book|light", raw_name, re.I) else None)),
                        "italic": bool(span["flags"] & 2 or re.search(r"italic|oblique", raw_name, re.I)),
                        "stems": [], "samples": 0,
                    }
                    font_info[span["font"]] = info
                size = span["size"]
                asc = span["ascender"] if span["ascender"] > 0.5 else 0.8
                desc = span["descender"] if span["descender"] < -0.05 else -0.2
                color = "%06X" % span["color"]
                text_chars = [c for c in span["chars"]]
                if not text_chars:
                    continue
                ox, oy = text_chars[0]["origin"]
                x0 = min(c["bbox"][0] for c in text_chars)
                x1 = max(c["bbox"][2] for c in text_chars)
                box = (int(x0 * s), int((oy - asc * size) * s), int(x1 * s) + 1, int((oy - desc * size) * s) + 1)
                region = diff[max(0, box[1]):box[3], max(0, box[0]):box[2]]
                inked = region.size and region.max() >= 40
                if not inked and "".join(c["c"] for c in text_chars).strip():
                    continue  # leaves no mark: an OCR layer or hidden text, already in the picture
                # Ideographs have strokes of every width, so they say nothing about boldness
                text = "".join(c["c"] for c in text_chars)
                ideo = len(re.findall("[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]", text))
                if inked and len(info["stems"]) < 40 and ideo * 2 < len(text):
                    stem, n = stem_width(diff, box)
                    if n:
                        info["stems"].append(stem / (size * s))
                        info["samples"] += n
                for c in text_chars:
                    cx = (c["bbox"][0] + c["bbox"][2]) / 2
                    link = next((uri for r, uri in links if r.contains(pymupdf.Point(cx, oy - size * 0.3))), None)
                    chars.append({"c": c["c"], "x0": c["bbox"][0], "x1": c["bbox"][2], "base": c["origin"][1],
                                  "size": size, "font": span["font"], "color": color, "link": link})

    decide_weights(font_info)
    if pieces:
        return {"w": w, "h": h, "chars": chars, "fonts": font_info, "bare": bare_img, "scale": s}
    frames = to_frames(chars, font_info)
    background = background_png(bare_img, w)
    return {"w": w, "h": h, "background": background, "frames": frames}


def decide_weights(font_info):
    by_family = {}
    for f in font_info.values():
        f["stem"] = sorted(f["stems"])[len(f["stems"]) // 2] if f["stems"] else 0
        by_family.setdefault(f["family"], []).append(f)
    for fams in by_family.values():
        measured = [f for f in fams if f["stem"] and f["samples"] >= 6]
        light = min((f["stem"] for f in measured), default=0)
        for f in fams:
            if f["named"] is not None:
                f["bold"] = f["named"]
            elif not f["stem"]:
                f["bold"] = False
            else:
                f["bold"] = (len(measured) > 1 and f["stem"] > light * 1.28) or f["stem"] > 0.13


def to_frames(chars, font_info):
    """Characters on one baseline make a frame until a gap wide enough to be a column break."""
    lines = []
    for ch in sorted(chars, key=lambda c: (c["base"], c["x0"])):
        line = next((l for l in lines if abs(l["base"] - ch["base"]) < min(l["size"], ch["size"]) * 0.35), None)
        if line is None:
            line = {"base": ch["base"], "size": ch["size"], "chars": []}
            lines.append(line)
        line["chars"].append(ch)
        line["size"] = max(line["size"], ch["size"])
    frames = []
    for line in lines:
        line["chars"].sort(key=lambda c: c["x0"])
        cur = None
        for ch in line["chars"]:
            if not ch["c"].strip():
                if cur:
                    cur["space"] = True
                continue
            if cur and ch["x0"] - cur["end"] > max(cur["size"], ch["size"]) * 0.6:
                cur = None
            info = font_info[ch["font"]]
            run = {"text": ch["c"], "font": info["family"], "kind": info["kind"], "size": ch["size"],
                   "bold": info["bold"], "italic": info["italic"], "color": ch["color"], "link": ch["link"]}
            if cur is None:
                cur = {"x": ch["x0"], "base": line["base"], "size": ch["size"], "end": ch["x1"], "runs": [], "space": False}
                frames.append(cur)
            elif (cur["space"] or ch["x0"] - cur["end"] > ch["size"] * 0.15) and not cur["runs"][-1]["text"].endswith(" "):
                cur["runs"][-1]["text"] += " "
            cur["space"] = False
            last = cur["runs"][-1] if cur["runs"] else None
            same = last and all(last[k] == run[k] for k in ("font", "kind", "bold", "italic", "color", "link")) \
                and abs(last["size"] - run["size"]) < 0.25
            if same:
                last["text"] += run["text"]
            else:
                cur["runs"].append(run)
            cur["size"] = max(cur["size"], ch["size"])
            cur["end"] = max(cur["end"], ch["x1"])
    for f in frames:
        f["w"] = f["end"] - f["x"]
        f["runs"][-1]["text"] = f["runs"][-1]["text"].rstrip()
        fit(f)
    return [f for f in frames if any(r["text"] for r in f["runs"])]


METRIC = {("sans", False): "helv", ("sans", True): "hebo", ("serif", False): "tiro", ("serif", True): "tibo",
          ("mono", False): "cour", ("mono", True): "cobo"}


def fit(frame):
    """If the stand-in font Word is likely to use would make the text wider than it was, tighten it."""
    chars = sum(len(r["text"]) for r in frame["runs"])
    if chars < 2:
        return
    natural = 0.0
    for r in frame["runs"]:
        try:
            natural += pymupdf.get_text_length(r["text"], fontname=METRIC[(r["kind"], r["bold"])], fontsize=r["size"])
        except Exception:
            natural += len(r["text"]) * r["size"] * 0.6
    if natural > frame["w"] * 1.02:
        frame["tighten"] = max(-frame["size"] * 0.2, (frame["w"] - natural) / chars)


def background_png(img, page_w):
    k = min(1.0, (BACKGROUND_DPI / 72) / (img.width / page_w))
    small = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    lo, _ = zip(*small.getextrema())
    if min(lo) >= 250:
        return None
    buf = io.BytesIO()
    small.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ------------------------------------------------------------------ writer

def x(s):
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]", "", str(s))
    return escape(s, {'"': "&quot;"})


REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def build_docx(pages, title, dst):
    tw = lambda pt: round(pt * 20)
    emu = lambda pt: round(pt * 12700)
    rels = [("rId1", "styles", "styles.xml"), ("rId2", "settings", "settings.xml"), ("rId3", "fontTable", "fontTable.xml")]
    links = {}
    fonts_used = {}
    media = {}
    body = []
    tiny = '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>'

    def run_xml(r, tighten):
        fonts_used[r["font"]] = r["kind"]
        f = x(r["font"])
        sz = max(2, round(r["size"] * 2))
        rpr = f'<w:rPr><w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}" w:eastAsia="{f}"/>'
        if r["bold"]:
            rpr += "<w:b/><w:bCs/>"
        if r["italic"]:
            rpr += "<w:i/><w:iCs/>"
        if r["color"] != "000000":
            rpr += f'<w:color w:val="{r["color"]}"/>'
        if tighten:
            rpr += f'<w:spacing w:val="{round(tighten * 20)}"/>'
        rpr += f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/></w:rPr>'
        return f'<w:r>{rpr}<w:t xml:space="preserve">{x(r["text"])}</w:t></w:r>'

    for i, pg in enumerate(pages):
        if pg["background"]:
            rid = f"rIdP{i + 1}"
            rels.append((rid, "image", f"media/page{i + 1}.png"))
            media[f"word/media/page{i + 1}.png"] = pg["background"]
            cx, cy = emu(pg["w"]), emu(pg["h"])
            body.append(
                f'<w:p><w:pPr>{tiny}</w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing>'
                f'<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{i + 1}" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">'
                '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>'
                '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>'
                f'<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="{i + 1}" name="Page {i + 1}"/>'
                '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
                '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                f'<pic:pic><pic:nvPicPr><pic:cNvPr id="{i + 1}" name="page{i + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr>'
                f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
                f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
                '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>')
        for f in pg["frames"]:
            line = f["size"] * 1.2
            top = max(0.0, f["base"] - line + f["size"] * 0.24)
            width = min(max(f["w"] * 1.25 + 4, f["w"] + 2), max(f["w"] + 2, pg["w"] - f["x"]))
            parts = []
            for r in f["runs"]:
                xml = run_xml(r, f.get("tighten"))
                if r["link"] and parts and parts[-1][0] == r["link"]:
                    parts[-1][1] += xml
                else:
                    parts.append([r["link"], xml])
            inner = ""
            for link, xml in parts:
                if link:
                    rid = links.setdefault(link, f"rIdL{len(links) + 1}")
                    inner += f'<w:hyperlink r:id="{rid}" w:history="1">{xml}</w:hyperlink>'
                else:
                    inner += xml
            body.append(
                f'<w:p><w:pPr><w:framePr w:w="{tw(width)}" w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:x="{tw(f["x"])}" w:y="{tw(top)}"/>'
                f'<w:spacing w:before="0" w:after="0" w:line="{tw(line)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/><w:jc w:val="left"/></w:pPr>{inner}</w:p>')
        orient = ' w:orient="landscape"' if pg["w"] > pg["h"] else ""
        sect = (f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="{tw(pg["w"])}" w:h="{tw(pg["h"])}"{orient}/>'
                '<w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
        if i < len(pages) - 1:
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>{sect}</w:pPr></w:p>')
        else:
            body.append(f'<w:p><w:pPr>{tiny}</w:pPr></w:p>{sect}')

    ns = (f'{W} xmlns:r="{REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    font_xml = ""
    for name, kind in fonts_used.items():
        alt, fam, pitch = FALLBACK.get(kind, FALLBACK["sans"])
        alt_xml = f'<w:altName w:val="{alt}"/>' if alt != name else ""
        font_xml += f'<w:font w:name="{x(name)}">{alt_xml}<w:family w:val="{fam}"/><w:pitch w:val="{pitch}"/></w:font>'
    rel_xml = "".join(f'<Relationship Id="{i}" Type="{REL}/{t}" Target="{tg}"/>' for i, t, tg in rels)
    rel_xml += "".join(f'<Relationship Id="{rid}" Type="{REL}/hyperlink" Target="{x(url)}" TargetMode="External"/>'
                       for url, rid in links.items())
    parts = {
        "[Content_Types].xml": XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
        "_rels/.rels": XML + f'<Relationships xmlns="{PKG_REL}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/>'
        f'<Relationship Id="rId2" Type="{PKG_REL}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        "docProps/core.xml": XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f'<dc:title>{x(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>',
        "word/_rels/document.xml.rels": XML + f'<Relationships xmlns="{PKG_REL}">{rel_xml}</Relationships>',
        "word/styles.xml": XML + f'<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>'
        '<w:sz w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/>'
        '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr></w:style></w:styles>',
        "word/settings.xml": XML + f'<w:settings {W}><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>'
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
        "word/fontTable.xml": XML + f'<w:fonts {W}>{font_xml}</w:fonts>',
        "word/document.xml": XML + f'<w:document {ns}><w:body>{"".join(body)}</w:body></w:document>',
    }
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
        for name, data in media.items():
            z.writestr(name, data, compress_type=zipfile.ZIP_STORED)


def layout(src, dst):
    doc = pymupdf.open(src)
    bare_doc = pymupdf.open(src)
    fonts = Fonts(doc)
    pages = [read_page(doc, bare_doc, i, fonts) for i in range(doc.page_count)]
    title = doc.metadata.get("title") or re.sub(r"\.[^.]+$", "", src.rsplit("/", 1)[-1])
    build_docx(pages, title, dst)


def flow(src, dst):
    from pdf2docx import Converter
    converter = Converter(src)
    try:
        converter.convert(dst)
    finally:
        converter.close()


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "layout"
    logging.disable(logging.CRITICAL)
    pymupdf.TOOLS.mupdf_display_errors(False)
    if mode == "elements":
        from pdf_elements import elements
        elements(src, dst, read_page, Fonts)
    elif mode == "regions":
        from pdf_elements import regions
        regions(src, dst, sys.argv[4])
    else:
        (flow if mode == "flow" else layout)(src, dst)


if __name__ == "__main__":
    main()
