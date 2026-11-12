"""Summarise or translate the text of a PDF.

  text_tools.py summarize SRC DST LENGTH            -> Markdown summary
  text_tools.py translate SRC DST FROM TO FORMAT ENGINE -> translated .pdf, .docx or .md
  text_tools.py langs                               -> JSON list of installed offline (Argos) pairs

Summaries are extractive: sentences are scored by how many of the document's key terms
they carry and the best ones are kept in reading order. Translation has two engines that can
be used interchangeably: DeepL (online, key in DEEPL_AUTH_KEY, can hand back a PDF with its
layout kept) and Argos Translate (offline, needs language packs, text output only).
"""
import json
import math
import os
import re
import sys
from collections import Counter

import pdfplumber

from textfix import fix

# ---------------------------------------------------------------- reading

def read_blocks(src):
    """Headings, list items and paragraphs, in reading order, with a marker per page."""
    pages = []
    with pdfplumber.open(src) as pdf:
        for page in pdf.pages:
            lines = []
            for ln in page.extract_text_lines(layout=False, strip=True, return_chars=True):
                text = re.sub(r"\s+", " ", fix(ln["text"])).strip()
                if not text:
                    continue
                sizes = [c.get("size", 0) for c in ln.get("chars", []) if c.get("text", "").strip()]
                lines.append({"text": text, "top": ln["top"], "bottom": ln["bottom"], "size": max(sizes) if sizes else 10})
            pages.append(lines)

    sizes = Counter(round(l["size"] * 2) / 2 for p in pages for l in p)
    body = sizes.most_common(1)[0][0] if sizes else 10
    blocks = []
    for lines in pages:
        para = []

        def flush():
            if para:
                blocks.append({"t": "p", "text": re.sub(r"(\w)- (\w)", r"\1\2", " ".join(para))})
                para.clear()

        prev = None
        for l in lines:
            ratio = l["size"] / body
            if ratio > 1.15 and len(l["text"]) < 120:
                flush()
                blocks.append({"t": "h", "level": 1 if ratio > 1.8 else 2 if ratio > 1.4 else 3, "text": l["text"]})
            else:
                m = re.match(r"^([•●▪◦‣\-*–]|\d+[.)])\s+(.*)$", l["text"])
                if m:
                    flush()
                    blocks.append({"t": "li", "marker": m.group(1).replace(")", ".") if m.group(1)[0].isdigit() else None, "text": m.group(2)})
                else:
                    if prev and l["top"] - prev["bottom"] > l["size"] * 0.8:
                        flush()
                    para.append(l["text"])
            prev = l
        flush()
        blocks.append({"t": "page"})
    return blocks, len(pages)


# ---------------------------------------------------------------- summary

STOP = set("""a about above after again against all am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further had has have having he her here hers herself him
himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our
ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they
this those through to too under until up very was we were what when where which while who whom why will with would you
your yours yourself yourselves also may might must shall one two three per via within without upon however thus therefore
page le la les des du de et en un une est que qui pour dans sur pas par au aux el los las del y por con para una es se lo
der die das und ist mit den dem ein eine zu von nicht il di che non""".split())


UNSPACED = re.compile("[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]")


def sentences(text):
    text = re.sub(r"(\d)\.(\d)", "\\1\u2024\\2", re.sub(r"\s+", " ", text))
    out = []
    for s in re.findall(r"[^.!?\u3002\uff01\uff1f\u0964]+(?:[.!?\u3002\uff01\uff1f\u0964]+[\"')\]\u300d]*|$)", text):
        s = s.strip().replace("\u2024", ".")
        # Chinese, Japanese, Thai and Korean don't put spaces between words, so count characters
        long_enough = len(s.split()) >= 5 or len(UNSPACED.findall(s)) >= 8
        if long_enough and sum(ch.isdigit() for ch in s) < len(s) * 0.25:
            out.append(s)
    return out


def words(s):
    out = []
    for w in re.findall(r"[^\W\d_][\w'-]+", s.lower()):
        if UNSPACED.search(w):
            # pairs of characters stand in for words in unspaced scripts
            chars = [c for c in w if UNSPACED.match(c)]
            out += [a + b for a, b in zip(chars, chars[1:])]
        elif len(w) > 2 and w not in STOP:
            out.append(w)
    return out


def summarize(blocks, count):
    items, since = [], 0
    for b in blocks:
        if b["t"] == "h":
            since = 0
            continue
        if b["t"] not in ("p", "li"):
            continue
        for s in sentences(b["text"]):
            items.append({"s": s, "pos": len(items), "early": since < 2})
            since += 1
    tf = Counter(w for it in items for w in words(it["s"]))
    top = max(tf.values(), default=1)
    for it in items:
        ws = words(it["s"])
        score = sum(tf[w] / top for w in ws) / math.sqrt(len(ws) or 1)
        it["score"] = score * (1.25 if it["early"] else 1) * (0.7 if len(it["s"]) > 400 else 1)
    seen, best = set(), []
    for it in sorted(items, key=lambda x: -x["score"]):
        key = it["s"].lower()
        if key in seen:
            continue
        seen.add(key)
        best.append(it)
        if len(best) == count:
            break
    return [it["s"] for it in sorted(best, key=lambda x: x["pos"])]


def cmd_summarize(src, dst, length):
    blocks, n_pages = read_blocks(src)
    plain = " ".join(b["text"] for b in blocks if b["t"] != "page")
    if len(plain.split()) < 20:
        fail("This PDF does not have enough text to summarise. If it is a scan, run OCR PDF on it first.")
    points = summarize(blocks, {"short": 5, "medium": 10, "long": 18}.get(length, 10))
    if not points:
        fail("This PDF does not have enough running text to summarise.")
    heads = [b["text"] for b in blocks if b["t"] == "h" and b["level"] <= 2][:12]
    md = [f"# Summary", "", f"{n_pages} page{'s' if n_pages != 1 else ''}, about {len(plain.split()):,} words.", "", "## Key points", ""]
    md += [f"- {p}" for p in points] + [""]
    if heads:
        md += ["## Sections", ""] + [f"- {h}" for h in heads] + [""]
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(md))


# ------------------------------------------------------------- translation

def deepl_target(code):
    code = code.upper()
    # DeepL wants a regional English or Portuguese as a target
    return {"EN": "EN-US", "PT": "PT-PT", "ZH": "ZH-HANS"}.get(code, code)


def cmd_translate(src, dst, source, target, fmt, engine="deepl"):
    (translate_argos if engine == "argos" else translate_deepl)(src, dst, source, target, fmt)


def translate_deepl(src, dst, source, target, fmt):
    try:
        import deepl
    except ImportError:
        fail("The DeepL library is not installed. Run pip install deepl on the machine running Sheaf-D.")
    key = os.environ.get("DEEPL_AUTH_KEY", "").strip()
    if not key:
        fail("Translate needs a DeepL API key. Set DEEPL_AUTH_KEY for Sheaf-D and restart it.")
    translator = deepl.DeepLClient(key, send_platform_info=False)
    source_lang = None if source == "auto" else source.upper().split("-")[0]
    target_lang = deepl_target(target)
    if source_lang and target_lang.startswith(source_lang):
        fail("The PDF is already in that language.")
    try:
        if fmt == "pdf":
            # DeepL rebuilds the PDF itself, so headings, tables and pictures stay where they were
            translator.translate_document_from_filepath(src, dst, source_lang=source_lang, target_lang=target_lang)
            return
        blocks, _ = read_blocks(src)
        todo = [i for i, b in enumerate(blocks) if b["t"] != "page" and b["text"].strip()]
        if not todo:
            fail("This PDF has no text to translate. If it is a scan, run OCR PDF on it first.")
        out = [dict(b) for b in blocks]
        # DeepL takes up to 50 texts per request
        for start in range(0, len(todo), 50):
            chunk = todo[start:start + 50]
            results = translator.translate_text([blocks[i]["text"] for i in chunk], source_lang=source_lang, target_lang=target_lang)
            for i, r in zip(chunk, results):
                out[i]["text"] = r.text
    except deepl.AuthorizationException:
        fail("DeepL turned down the API key. Check DEEPL_AUTH_KEY.")
    except deepl.QuotaExceededException:
        fail("Your DeepL quota for this month is used up.")
    except deepl.DocumentTranslationException as e:
        fail(f"DeepL could not translate this PDF: {e}. Try Word or Markdown output instead.")
    except deepl.DeepLException as e:
        fail(f"DeepL returned an error: {e}")
    if fmt == "md":
        write_md(out, dst)
    else:
        write_docx(out, dst)


# A cheap language guess for "Detect it" when translating offline: count common words.
HINTS = {
    "en": "the and of to is in that for with this are was on as be by",
    "es": "el la de que y en los del se las por un para con una es",
    "fr": "le la de et les des est que un une pour dans qui sur pas du",
    "de": "der die und das ist nicht ein eine zu den mit von sich auf für",
    "it": "il di che la per un una non sono con del della è le gli",
    "pt": "o a de que e do da em um uma para com não os no se",
    "nl": "de het een en van is dat op te in niet zijn met voor",
}


def guess(text, choices):
    ws = Counter(re.findall(r"[^\W\d_]+", text.lower()))
    scored = [(sum(ws[w] for w in HINTS[c].split()), c) for c in choices if c in HINTS]
    scored.sort(reverse=True)
    return scored[0][1] if scored and scored[0][0] > 3 else None


def installed():
    try:
        from argostranslate import translate
    except ImportError:
        return []
    langs = translate.get_installed_languages()
    return [[a.code, b.code] for a in langs for b in langs if a.code != b.code and a.get_translation(b) is not None]


def translate_argos(src, dst, source, target, fmt):
    try:
        from argostranslate import translate
    except ImportError:
        fail("Offline translation is not installed. Rebuild the Docker image with TRANSLATE_LANGS set, see the README.")
    if fmt == "pdf":
        fail("Offline translation can't keep the layout. Save as Word or Markdown, or use DeepL for a PDF.")
    # DeepL-style codes like en-us or zh-hans become Argos's plain ones
    target = target.lower().split("-")[0]
    source = source.lower().split("-")[0]
    blocks, _ = read_blocks(src)
    text = " ".join(b["text"] for b in blocks if b["t"] != "page")
    if not text.strip():
        fail("This PDF has no text to translate. If it is a scan, run OCR PDF on it first.")
    codes = {l.code: l for l in translate.get_installed_languages()}
    if source == "auto":
        source = guess(text[:4000], [c for c in codes if c != target])
        if not source:
            fail("Could not tell which language the PDF is in. Pick it under From.")
    if source == target:
        fail("The PDF is already in that language.")
    if source not in codes or target not in codes:
        fail(f"The {source} to {target} language pack is not installed.")
    tr = codes[source].get_translation(codes[target])
    if tr is None:
        # Argos can pivot through English when both directions are installed
        if "en" in codes and codes[source].get_translation(codes["en"]) and codes["en"].get_translation(codes[target]):
            a, b = codes[source].get_translation(codes["en"]), codes["en"].get_translation(codes[target])
            tr = type("Pivot", (), {"translate": lambda self, t: b.translate(a.translate(t))})()
        else:
            fail(f"The {source} to {target} language pack is not installed.")
    out = [dict(b, text=tr.translate(b["text"])) if b["t"] != "page" else b for b in blocks]
    if fmt == "md":
        write_md(out, dst)
    else:
        write_docx(out, dst)


def write_md(blocks, dst):
    md = []
    for b in blocks:
        if b["t"] == "h":
            md += ["#" * b["level"] + " " + b["text"], ""]
        elif b["t"] == "li":
            md.append(f"{b['marker'] or '-'} {b['text']}")
        elif b["t"] == "p":
            if md and re.match(r"^(- |\d+\. )", md[-1]):
                md.append("")
            md += [b["text"], ""]
        else:
            md += ["---", ""]
    while md and md[-1] in ("", "---"):
        md.pop()
    with open(dst, "w", encoding="utf-8") as f:
        f.write(re.sub(r"\n{3,}", "\n\n", "\n".join(md)) + "\n")


def write_docx(blocks, dst):
    from docx import Document
    from docx.enum.text import WD_BREAK

    doc = Document()
    for i, b in enumerate(blocks):
        if b["t"] == "h":
            doc.add_heading(b["text"], level=b["level"])
        elif b["t"] == "li":
            doc.add_paragraph(b["text"], style="List Number" if b["marker"] else "List Bullet")
        elif b["t"] == "p":
            doc.add_paragraph(b["text"])
        elif any(n["t"] != "page" for n in blocks[i + 1:]):
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.save(dst)


def fail(msg):
    # The server shows lines starting with USER: to the person as they are.
    print(f"USER: {msg}", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "summarize":
        cmd_summarize(*sys.argv[2:5])
    elif cmd == "translate":
        cmd_translate(*sys.argv[2:8])
    elif cmd == "langs":
        print(json.dumps(installed()))
