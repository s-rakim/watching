"""Pulls tables out of a PDF into a spreadsheet, one sheet per page.

Pages with no detectable table fall back to their text, split into columns
wherever the words sit far apart, so nothing on the page is dropped.
"""
import re
import sys

import pdfplumber
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter


def as_number(text):
    cleaned = text.replace(",", "").strip()
    if re.fullmatch(r"-?\d+", cleaned):
        return int(cleaned)
    if re.fullmatch(r"-?\d*\.\d+", cleaned):
        return float(cleaned)
    return text


def text_rows(page):
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    lines = {}
    for word in words:
        lines.setdefault(round(word["top"] / 3), []).append(word)
    rows = []
    for key in sorted(lines):
        cells, current, last_x = [], "", None
        for word in sorted(lines[key], key=lambda w: w["x0"]):
            if last_x is not None and word["x0"] - last_x > 14:
                cells.append(current)
                current = word["text"]
            else:
                current = f"{current} {word['text']}".strip()
            last_x = word["x1"]
        cells.append(current)
        rows.append(cells)
    return rows


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    book = Workbook()
    book.remove(book.active)
    with pdfplumber.open(src) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            sheet = book.create_sheet(f"Page {number}")
            tables = page.extract_tables()
            row_index = 1
            if tables:
                for table in tables:
                    for r, row in enumerate(table):
                        for c, value in enumerate(row, start=1):
                            cell = sheet.cell(row=row_index, column=c, value=as_number(value or ""))
                            if r == 0:
                                cell.font = Font(bold=True)
                        row_index += 1
                    row_index += 1
            else:
                for row in text_rows(page):
                    for c, value in enumerate(row, start=1):
                        sheet.cell(row=row_index, column=c, value=as_number(value))
                    row_index += 1
            for column in sheet.columns:
                width = max((len(str(cell.value)) for cell in column if cell.value is not None), default=8)
                sheet.column_dimensions[get_column_letter(column[0].column)].width = min(60, max(8, width + 2))
    if not book.sheetnames:
        book.create_sheet("Page 1")
    book.save(dst)


if __name__ == "__main__":
    main()
