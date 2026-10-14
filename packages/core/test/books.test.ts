import { describe, expect, it } from 'vitest';
import { buildBook, cleanReadText, devaToOdia, latexToText, looseKey, Shelf, type BookMeta } from '../src/index.ts';

describe('maths read by vision (P8.17): LaTeX → what the phone shows', () => {
  it('fractions, powers and roots, as the book prints them', () => {
    // algebra-9 p.120: asked for Unicode the model guessed a²/b²; in LaTeX it read the ½ powers right
    expect(latexToText('$\\frac{\\text{a}^{\\frac{1}{2}}}{\\text{b}^{\\frac{1}{2}}}$ ବା $\\frac{\\sqrt{a}}{\\sqrt{b}}$ କୁ')).toBe('a^(1/2)/b^(1/2) ବା √a/√b କୁ');
    expect(latexToText('$\\frac{\\sqrt[3]{a}}{\\sqrt[3]{b}}$')).toBe('∛a/∛b');
    expect(latexToText('$x^2 + 2x - 3 = 0$, $\\sqrt{b^2-4ac}$')).toBe('x² + 2x - 3 = 0, √(b²-4ac)');
    expect(latexToText('$\\frac{x+1}{x-1}$ ଓ $a_1, a_2$')).toBe('(x+1)/(x-1) ଓ a₁, a₂');
  });
  it('relations, sets and geometry', () => {
    expect(latexToText('ତେଣୁ, $0 \\le P(E) \\le 1$')).toBe('ତେଣୁ, 0 ≤ P(E) ≤ 1');
    expect(latexToText('$A \\cup B = \\{a, b, c\\}$')).toBe('A ∪ B = {a, b, c}');
    expect(latexToText('$\\angle ABC = 90^\\circ$')).toBe('∠ABC = 90°');
    expect(latexToText('$\\triangle ABC \\cong \\triangle PQR$')).toBe('△ABC ≅ △PQR');
    expect(latexToText('$\\overline{AB} \\parallel \\overline{CD}$')).toBe('A̅B̅ ∥ C̅D̅');
  });
  it('long division written as an array over several lines', () => {
    expect(latexToText('ସ୍ତମ୍ଭ ପ୍ରଣାଳୀ : $\\begin{array}{rrr} 2x^{3} & +3x^{2} \\\\\n \\hline -\\phantom{0}5 & \\end{array}$ ।')).toBe('ସ୍ତମ୍ଭ ପ୍ରଣାଳୀ : 2x³ +3x²\n-5 ।');
  });
  it('a proof\'s braced list of reasons', () => {
    expect(latexToText('ମଧ୍ୟରେ $\\left.\\begin{cases} \\text{AB} = \\text{AC} & (\\text{ଦତ୍ତ}) \\\\\n \\text{AD} = \\text{AD} \\end{cases}\\right\\}$ ।')).toBe('ମଧ୍ୟରେ AB = AC (ଦତ୍ତ)\nAD = AD } ।');
  });
  it('Odia words inside the maths stay as written', () => {
    expect(latexToText('P(H) = $\\frac{\\text{H ର ବାରମ୍ବାରତା}}{\\text{ଟସ୍ ସଂଖ୍ୟା}} = \\frac{260}{500}$')).toBe('P(H) = (H ର ବାରମ୍ବାରତା)/(ଟସ୍ ସଂଖ୍ୟା) = 260/500');
  });
  it('a vision page is cleaned for what vision adds, not for OCR junk', () => {
    expect(cleanReadText('**ଉଦାହରଣ - 1**\n[ଚିତ୍ର]\nତେଣୁ, $0 \\le P(E) \\le 1$\n- 152 -')).toBe('ଉଦାହରଣ - 1\nତେଣୁ, 0 ≤ P(E) ≤ 1');
  });
});

describe('language books: Hindi, Sanskrit, English, Odia (P8.18)', () => {
  it('Devanagari meets romanized spelling the way Odia does, with Hindi\'s silent a', () => {
    expect(devaToOdia('कबीर')).toBe('କବୀର');
    expect(looseKey('कबीर', true)).toBe(looseKey('kabir'));
    expect(looseKey('ममता', true)).toBe(looseKey('mamta'));
    expect(looseKey('मित्र', true)).toBe(looseKey('mitra')); // not after a cluster
    expect(looseKey('सत्यम्')).toBe(looseKey('satyam')); // Sanskrit keeps every a
  });

  const meta = (id: string, title: string, kind?: 'language'): BookMeta => ({
    id, subject: { or: id, en: id }, title: { or: id, en: id }, classLevel: 9, board: 'BSE Odisha', source: '', pageOffset: 0, ...(kind ? { kind } : {}),
    chapters: [{ n: 1, title: { or: title, en: title }, startPage: 1, endPage: 9 }],
  });
  const story = 'My mother gave water to the thirsty old man in the village and the whole family sat under the tree till evening. ';
  const shelf = new Shelf([
    buildBook(meta('english-9', 'The Priceless Gift', 'language'), [{ page: 1, text: story.repeat(4), by: 'text' }]),
    buildBook(meta('life-science-9', 'Natural resources'), [{ page: 1, text: 'Water is a natural resource. Plants need water to grow. '.repeat(3), by: 'text' }]),
  ]);
  it('a science question in English is not answered from an English story', () => {
    expect(shelf.search('why do plants need water').every((h) => h.bookId === 'life-science-9')).toBe(true);
  });
  it('the story is searched when she picks English, or names its lesson', () => {
    expect(shelf.search('old man water village', { picked: ['english-9'] })[0]?.bookId).toBe('english-9');
    expect(shelf.search('priceless gift')[0]?.bookId).toBe('english-9');
    expect(shelf.search('price of gift').some((h) => h.bookId === 'english-9')).toBe(true);
    expect(shelf.search('phone price').some((h) => h.bookId === 'english-9')).toBe(false); // "price" is not "Priceless"
  });
});
