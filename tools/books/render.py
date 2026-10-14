"""Render a textbook PDF to page images for OCR (P8.1).

Board PDFs are either scans or set in legacy (non-Unicode) Odia fonts, so their text layer is useless; we OCR the
pictures instead. Two-column pages confuse Tesseract (it reads across both columns), so a page with a clear white
gutter near the middle is saved as two images, left column first.

usage: python -P tools/books/render.py <book.pdf> <out_dir> [dpi]
"""
import sys
from pathlib import Path

import pymupdf


def gutter(pix) -> int | None:
    """x of a vertical white strip in the middle 35-65% of the page that runs through most of the text, else None."""
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    top, bottom = int(h * 0.12), int(h * 0.9)
    step = 3
    best, best_x = 0.0, None
    for x in range(int(w * 0.35), int(w * 0.65), 2):
        dark = 0
        rows = 0
        for y in range(top, bottom, step):
            rows += 1
            if s[(y * w + x) * n] < 140:
                dark += 1
        white = 1 - dark / rows
        if white > best:
            best, best_x = white, x
    # a real gutter is almost entirely white; check text sits on both sides of it
    if best < 0.985 or best_x is None:
        return None
    def ink(x0, x1):
        d = 0
        for y in range(top, bottom, 9):
            for x in range(x0, x1, 9):
                if s[(y * w + x) * n] < 140:
                    d += 1
        return d
    if ink(int(w * 0.08), best_x - 10) < 60 or ink(best_x + 10, int(w * 0.92)) < 60:
        return None
    return best_x


def main():
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    split = 0
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        g = gutter(pix)
        name = f"p{i + 1:03d}"
        if g is None:
            pix.save(out / f"{name}.png")
        else:
            split += 1
            r = page.rect
            xg = r.x0 + r.width * g / pix.width
            for tag, clip in (("a", pymupdf.Rect(r.x0, r.y0, xg, r.y1)), ("b", pymupdf.Rect(xg, r.y0, r.x1, r.y1))):
                page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, clip=clip).save(out / f"{name}{tag}.png")
    print(f"{doc.page_count} pages, {split} split into two columns -> {out}")


if __name__ == "__main__":
    main()
