"""Textbook figures (P8.20): page pictures for the vision model, and the figures it found, cut out of the PDF.

A page's figures (diagrams, photos, maps, graphs) carry meaning the OCR text loses. content/scripts/figures.ts sends
each rendered page to Gemini, which returns every figure's box, caption and an explanation in the book's language;
this script then cuts each figure from the PDF itself (sharp, in colour) for the answer card.

usage: python -I tools/books/figures.py render <book.pdf> <out_dir> [dpi]      -> p001.jpg ... (colour, for vision)
       python -I tools/books/figures.py crop <book.pdf> <figures.json> <out_dir> -> <out_dir>/<img> for every figure
"""
import json
import sys
from pathlib import Path

import pymupdf

MAX_W = 900  # px: sharp on a phone, ~40-90 KB as JPEG


def render(pdf: Path, out: Path, dpi: int) -> None:
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    for i, page in enumerate(doc):
        f = out / f"p{i + 1:03d}.jpg"
        if not f.exists():
            page.get_pixmap(dpi=dpi).save(f, jpg_quality=80)
    print(f"{doc.page_count} pages -> {out}")


def crop(pdf: Path, figures: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    n = 0
    for fig in json.loads(figures.read_text(encoding="utf8")):
        f = out / fig["img"]
        if f.exists():
            continue
        page = doc[fig["pdfPage"] - 1]
        r = page.rect
        y0, x0, y1, x1 = fig["box"]  # 0-1000, as Gemini gives boxes
        pad = 8  # a little margin: the model's box can clip a label
        clip = pymupdf.Rect(r.x0 + r.width * max(0, x0 - pad) / 1000, r.y0 + r.height * max(0, y0 - pad) / 1000,
                            r.x0 + r.width * min(1000, x1 + pad) / 1000, r.y0 + r.height * min(1000, y1 + pad) / 1000)
        if clip.width < 20 or clip.height < 20:
            continue
        zoom = min(3.0, MAX_W / clip.width)
        page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip).save(f, jpg_quality=72)
        n += 1
    print(f"{n} figures cut -> {out}")


def main() -> None:
    cmd, pdf = sys.argv[1], Path(sys.argv[2])
    if cmd == "render":
        render(pdf, Path(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 110)
    elif cmd == "crop":
        crop(pdf, Path(sys.argv[3]), Path(sys.argv[4]))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
