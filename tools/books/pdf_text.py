"""A textbook PDF with a real text layer (the English reader) → the same { page, text, conf } records OCR writes.

Odia and Devanagari board PDFs are set in legacy fonts or scanned, so they go through render.py + OCR instead; the
English book is set in Unicode Times/Arial and its own text is exact. Private-use glyphs (bullets, dingbats) dropped.

usage: python -P tools/books/pdf_text.py <book.pdf> <out.json>
"""
import json
import re
import sys
from pathlib import Path

import pymupdf


def main():
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    doc = pymupdf.open(pdf)
    pages = []
    for i, page in enumerate(doc):
        # blocks in reading order (sort=True: top-to-bottom, left-to-right), one line per printed line
        text = page.get_text("text", sort=True)
        text = re.sub(r"[-]", " ", text)
        text = re.sub(r"[ \t]+", " ", text)
        pages.append({"page": i + 1, "text": text.strip(), "conf": 100, "by": "text"})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(pages)} pages -> {out}")


if __name__ == "__main__":
    main()
