"""Rebuilds a PDF as an editable Word document, keeping layout where it can."""
import logging
import sys

from pdf2docx import Converter


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    logging.disable(logging.CRITICAL)
    converter = Converter(src)
    try:
        converter.convert(dst)
    finally:
        converter.close()


if __name__ == "__main__":
    main()
