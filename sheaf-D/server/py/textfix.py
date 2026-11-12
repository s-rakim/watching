"""Text as pdfplumber reads it, put right before anything is written out.

PDFs draw Arabic and Hebrew left to right one glyph at a time, so a right-to-left line comes
out backwards; Chrome and Skia write Kangxi radicals and presentation forms instead of the
real characters; and fonts with a broken ToUnicode map leave control characters behind.
"""
import re
import unicodedata

RTL = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")
LTR = re.compile(r"[^\W\d_]", re.UNICODE)
CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f�]")


def clean(s):
    return CONTROL.sub("", unicodedata.normalize("NFKC", s or ""))


def _kind(token):
    if RTL.search(token):
        return "R"
    return "L" if LTR.search(token) else "N"


def visual_to_logical(line):
    """A line read left to right off the page, in the order it is read."""
    if not RTL.search(line):
        return line
    tokens = line.split(" ")
    kinds = [_kind(t) for t in tokens]
    r, l = kinds.count("R"), kinds.count("L")
    tokens = [t[::-1] if k == "R" else t for t, k in zip(tokens, kinds)]
    if r < l:
        return " ".join(tokens)
    # a right-to-left line: words go the other way round, but runs of Latin words or
    # numbers inside it keep their own order
    tokens, kinds = tokens[::-1], kinds[::-1]
    out, i = [], 0
    while i < len(tokens):
        if kinds[i] != "L":
            out.append(tokens[i]); i += 1
            continue
        j = i
        while j < len(tokens) and kinds[j] != "R":
            j += 1
        k = j - 1
        while k > i and kinds[k] != "L":
            k -= 1
        out.extend(reversed(tokens[i:k + 1]))
        i = k + 1
    return " ".join(out)


def fix(line):
    return visual_to_logical(clean(line))
