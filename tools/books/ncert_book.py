"""NCERT chapter PDFs (one PDF per chapter, as ncert.nic.in serves them) -> one book's pages for build_book.ts.

The English books have an exact Unicode text layer, so their text is taken as it is. The Hindi books' text layer
doubles vowel signs ("माात्रााएँ"), so with --ocr the pages are rendered for Tesseract (content/scripts/ocr_book.mjs)
and only the page numbers come from the PDF. Pages are numbered as printed (chapters continue the book's numbering),
so a citation says the page she sees.

usage: python -P tools/books/ncert_book.py <out_pages.json> <out_chapters.json> [--ocr <png_dir>] ch1.pdf ch2.pdf ...
  out_chapters.json: [{n, title, startPage, endPage}] (title as printed, English books only)
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

# private-use glyphs (bullets, icons) and the soft hyphen
JUNK = re.compile(r"[-­]")


def printed_number(page) -> int | None:
    """the page number printed in the header or footer, if the text layer has it"""
    h = page.rect.height
    blocks = page.get_text("blocks")
    for b in blocks:
        t = b[4].strip()
        if re.fullmatch(r"\d{1,3}", t) and (b[1] < h * 0.1 or b[3] > h * 0.9):
            return int(t)
    for b in blocks:
        m = re.search(r"(?:^|\s)(\d{1,3})\s*$", b[4].strip())
        if m and b[1] < h * 0.08:
            return int(m.group(1))
    return None


def title_of(page) -> str:
    """the chapter title: the second-largest text on the first page (the largest is the chapter number)"""
    spans = [s for b in page.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"] if s["text"].strip()]
    sizes = sorted({round(s["size"]) for s in spans if not re.fullmatch(r"\d+|Chapter|अध्याय", s["text"].strip())}, reverse=True)
    if not sizes:
        return ""
    words = [s["text"].strip() for s in spans if round(s["size"]) == sizes[0] and not re.fullmatch(r"\d+", s["text"].strip())]
    return re.sub(r"\s+", " ", " ".join(words)).replace("- ", "").strip()


def main():
    args = sys.argv[1:]
    out_pages, out_chapters = Path(args[0]), Path(args[1])
    rest = args[2:]
    png_dir = None
    if rest and rest[0] == "--ocr":
        png_dir = Path(rest[1])
        png_dir.mkdir(parents=True, exist_ok=True)
        rest = rest[2:]
    pages, chapters = [], []
    last = 0
    for n, pdf in enumerate(rest, start=1):
        doc = pymupdf.open(pdf)
        found = [(i, printed_number(doc[i])) for i in range(doc.page_count)]
        offsets = sorted(p - i for i, p in found if p is not None)
        # the chapter's numbering: what most pages print; a chapter with no printed numbers continues the last one
        offset = offsets[len(offsets) // 2] if offsets else last + 1
        if offset <= last:
            offset = last + 1
        for i in range(doc.page_count):
            page_no = offset + i
            if png_dir:
                doc[i].get_pixmap(dpi=200, colorspace=pymupdf.csGRAY).save(png_dir / f"p{page_no:03d}.png")
                text = ""
            else:
                text = JUNK.sub(" ", doc[i].get_text("text"))
                text = re.sub(r"[ \t]+", " ", text).strip()
            pages.append({"page": page_no, "text": text, "conf": 100, "by": "text"})
        chapters.append({"n": n, "title": title_of(doc[0]), "startPage": offset, "endPage": offset + doc.page_count - 1, "pdf": Path(pdf).name})
        last = offset + doc.page_count - 1
    out_pages.parent.mkdir(parents=True, exist_ok=True)
    if not png_dir:
        out_pages.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    out_chapters.write_text(json.dumps(chapters, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(chapters)} chapters, pages {chapters[0]['startPage']}-{last} -> {out_chapters}" + (f" (+ images in {png_dir})" if png_dir else f", {out_pages}"))


if __name__ == "__main__":
    main()
