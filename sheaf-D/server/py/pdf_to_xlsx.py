"""Pulls tables out of a PDF into a spreadsheet, one sheet per page.

Ruled tables keep their rows and columns. Text around them (titles, labels, notes) goes in
the rows above, between and below, split into columns wherever words sit far apart, so
nothing on the page is dropped and everything stays in page order.
"""
import re
import sys

import pdfplumber
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from textfix import fix


def as_number(text):
    text = ILLEGAL_CHARACTERS_RE.sub("", fix(text or "")).strip()
    cleaned = text.replace(",", "")
    if re.fullmatch(r"-?\d+", cleaned) and len(cleaned.lstrip("-")) < 16 and not re.fullmatch(r"-?0\d+", cleaned):
        return int(cleaned)
    if re.fullmatch(r"-?\d*\.\d+", cleaned):
        return float(cleaned)
    return text


def put(sheet, row, column, text):
    """A cell with the value as a number where it is one, shown the way the PDF shows it."""
    value = as_number(text)
    cell = sheet.cell(row=row, column=column, value=value)
    if isinstance(value, (int, float)):
        raw = (text or "").strip()
        decimals = len(raw.rsplit(".", 1)[1]) if "." in raw else 0
        if "," in raw or decimals:
            cell.number_format = ("#,##0" if "," in raw else "0") + ("." + "0" * decimals if decimals else "")
    return cell


def text_rows(words):
    """Words -> rows of cells, a new cell wherever the gap is wider than a couple of spaces."""
    lines = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        line = next((l for l in lines if abs(l["top"] - word["top"]) < max(2.0, (word["bottom"] - word["top"]) * 0.4)), None)
        if line is None:
            lines.append(line := {"top": word["top"], "words": []})
        line["words"].append(word)
    rows = []
    for line in lines:
        cells, current, last_x = [], "", None
        for word in sorted(line["words"], key=lambda w: w["x0"]):
            size = word["bottom"] - word["top"]
            if last_x is not None and word["x0"] - last_x > max(14, size * 1.5):
                cells.append(current)
                current = word["text"]
            else:
                current = f"{current} {word['text']}".strip()
            last_x = word["x1"]
        cells.append(current)
        # a right-to-left line was read from the left, so its columns go the other way round
        if sum(bool(re.search("[֐-ࣿיִ-﷿ﹰ-ﻼ]", c)) for c in cells) * 2 > len(cells):
            cells = cells[::-1]
        rows.append((line["top"], cells))
    return rows


def table_cells(page, table):
    """The table's text, with words that fell outside every cell (a row whose outer borders
    are a rounded box, say) put back in the cell their row and column agree on."""
    data = [list(r) for r in table.extract()]
    cols = {}
    for row in table.rows:
        for c, cell in enumerate(row.cells):
            # the narrowest cell in a column, since a merged cell spans several
            if cell and (c not in cols or cell[2] - cell[0] < cols[c][2] - cols[c][0]):
                cols[c] = cell
    boxes = [cell for row in table.rows for cell in row.cells if cell]
    x0, top, x1, bottom = table.bbox
    for w in page.extract_words():
        cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
        if not (x0 - 1 <= cx <= x1 + 1 and top - 1 <= cy <= bottom + 1):
            continue
        if any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in boxes):
            continue
        r = next((i for i, row in enumerate(table.rows) if row.bbox[1] - 1 <= cy <= row.bbox[3] + 1), None)
        c = next((k for k, b in cols.items() if b[0] - 1 <= cx <= b[2] + 1), None)
        if r is None or c is None or c >= len(data[r]):
            continue
        data[r][c] = f"{data[r][c] or ''} {w['text']}".strip()
    return data


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    book = Workbook()
    book.remove(book.active)
    with pdfplumber.open(src) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            sheet = book.create_sheet(f"Page {number}")
            tables = [t for t in page.find_tables() if t.bbox]
            boxes = [t.bbox for t in tables]

            def outside(w):
                cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
                return not any(x0 - 1 <= cx <= x1 + 1 and top - 1 <= cy <= bottom + 1 for x0, top, x1, bottom in boxes)

            words = [w for w in page.extract_words(keep_blank_chars=False, use_text_flow=False) if outside(w)]
            pieces = [(top, "text", cells) for top, cells in text_rows(words)]
            pieces += [(t.bbox[1], "table", table_cells(page, t)) for t in tables]
            pieces.sort(key=lambda p: p[0])

            row_index = 1
            last = None
            for _, kind, data in pieces:
                if kind == "table":
                    if last is not None:
                        row_index += 1  # a blank row before a table
                    for r, row in enumerate(data):
                        for c, value in enumerate(row, start=1):
                            cell = put(sheet, row_index, c, value)
                            if r == 0:
                                cell.font = Font(bold=True)
                        row_index += 1
                    row_index += 1
                else:
                    for c, value in enumerate(data, start=1):
                        put(sheet, row_index, c, value)
                    row_index += 1
                last = kind
            for column in sheet.columns:
                width = max((len(str(cell.value)) for cell in column if cell.value is not None), default=8)
                sheet.column_dimensions[get_column_letter(column[0].column)].width = min(60, max(8, width + 2))
    if not book.sheetnames:
        book.create_sheet("Page 1")
    book.save(dst)


if __name__ == "__main__":
    main()
