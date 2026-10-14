"""Render a textbook PDF to page images for OCR (P8.1).

Board PDFs are either scans or set in legacy (non-Unicode) Odia fonts, so their text layer is useless; we OCR the
pictures instead. Two-column pages confuse Tesseract (it reads across both columns), so a page with a clear white
gutter near the middle is saved as two images, left column first.

usage: python -P tools/books/render.py <book.pdf> <out_dir> [dpi] [--whole]
  --whole: never split (for vision OCR, which reads columns itself and must see a formula whole)
"""
import sys
from pathlib import Path

import pymupdf


def gutter(pix, top_frac: float = 0.12) -> int | None:
    """x of a vertical white strip in the middle 35-65% of the page that runs through most of the text, else None."""
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    top, bottom = int(h * top_frac), int(h * 0.9)
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


def gutter_top(pix, g: int) -> int:
    """y where the gutter starts: a heading or an introduction above the columns runs across it (top 60% only)."""
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    last = 0
    for y in range(int(h * 0.05), int(h * 0.6)):
        if any(s[(y * w + x) * n] < 140 for x in range(g - 3, g + 4)):
            last = y
    return last + 8 if last else 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    whole = "--whole" in sys.argv
    pdf, out = Path(args[0]), Path(args[1])
    dpi = int(args[2]) if len(args) > 2 else 200
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    split = 0
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        # columns may start below an introduction printed across the page: look again in the lower part
        g = None if whole else gutter(pix) or gutter(pix, 0.45)
        name = f"p{i + 1:03d}"
        if g is None:
            pix.save(out / f"{name}.png")
        else:
            split += 1
            r = page.rect
            xg = r.x0 + r.width * g / pix.width
            # text above the columns that runs across the gutter is read first, whole: "a" (else it is cut in two)
            yt = gutter_top(pix, g)
            y0 = r.y0 + r.height * yt / pix.height if yt > pix.height * 0.08 else r.y0
            parts = [("a", pymupdf.Rect(r.x0, r.y0, r.x1, y0))] if y0 > r.y0 else []
            cols = ("b", "c") if parts else ("a", "b")
            parts += [(cols[0], pymupdf.Rect(r.x0, y0, xg, r.y1)), (cols[1], pymupdf.Rect(xg, y0, r.x1, r.y1))]
            for tag, clip in parts:
                page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, clip=clip).save(out / f"{name}{tag}.png")
    print(f"{doc.page_count} pages, {split} split into two columns -> {out}")


if __name__ == "__main__":
    main()
