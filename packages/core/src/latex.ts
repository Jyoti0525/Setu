// Maths the way a phone shows it (P8.17): vision reads a maths page most accurately when it may write LaTeX
// ($\frac{a^{\frac{1}{2}}}{b^{\frac{1}{2}}}$ — asked for plain Unicode it guessed a²/b²), but a 📖 card is plain
// text. This turns the LaTeX between $…$ into readable Unicode: a^(1/2)/b^(1/2), √a, ∛a, x², ∠ABC, A̅B̅.

const SYM: Record<string, string> = {
  cup: '∪', cap: '∩', le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥', neq: '≠', ne: '≠', times: '×', div: '÷', pm: '±', mp: '∓',
  cdot: '·', ldots: '…', dots: '…', cdots: '⋯', approx: '≈', equiv: '≡', propto: '∝', sim: '∼', cong: '≅', parallel: '∥', perp: '⊥',
  angle: '∠', measuredangle: '∠', triangle: '△', square: '□', circ: '°', degree: '°', infty: '∞', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β',
  gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', phi: 'φ', varphi: 'φ', omega: 'ω', Omega: 'Ω',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  therefore: '∴', because: '∵', rightarrow: '→', to: '→', Rightarrow: '⇒', leftarrow: '←', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔',
  mid: '|', vert: '|', lvert: '|', rvert: '|', setminus: '∖', backslash: '\\', percent: '%', colon: ':', quad: ' ', qquad: ' ', prime: '′',
  lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', neg: '¬', land: '∧', lor: '∨', odot: '⊙', oplus: '⊕',
};
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', '°': '°', '′': '′' };
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
const STYLE = new Set(['text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'boldsymbol', 'operatorname', 'mbox', 'displaystyle', 'textstyle', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'limits']);

/** a fraction's part or a root's body needs brackets unless it is one number, one letter or already bracketed */
const atom = (s: string) => /^[√∛∜]?[\p{L}\p{N}.]+([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱˣ⁺⁻]+|\^\([^()]*\))?$|^\([^()]*\)$/u.test(s.trim());
/** symbols written right before what they name: ∠ABC, △PQR (LaTeX's space after the command is not printed) */
const PREFIX = new Set(['angle', 'measuredangle', 'triangle', 'square', 'neg']);
const wrap = (s: string) => (atom(s) ? s.trim() : `(${s.trim()})`);
const script = (s: string, map: Record<string, string>, mark: string) => {
  const t = s.trim();
  return [...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join('') : `${mark}${wrap(t)}`;
};

function parse(src: string, at: { i: number }, stop?: string): string {
  let out = '';
  const group = () => {
    while (src[at.i] === ' ') at.i++;
    if (src[at.i] === '{') { at.i++; return parse(src, at, '}'); }
    if (src[at.i] === '\\') { const m = /^\\([A-Za-z]+|.)/.exec(src.slice(at.i))!; at.i += m[0].length; return SYM[m[1]!] ?? m[1]!; }
    return src[at.i++] ?? '';
  };
  while (at.i < src.length) {
    const ch = src[at.i]!;
    if (stop && ch === stop) { at.i++; return out; }
    if (ch === '{') { at.i++; out += parse(src, at, '}'); continue; }
    if (ch === '^') { at.i++; out += script(group(), SUP, '^'); continue; }
    if (ch === '_') { at.i++; out += script(group(), SUB, '_'); continue; }
    if (ch === '&') { at.i++; out += ' '; continue; }
    if (ch !== '\\') { out += ch; at.i++; continue; }
    const m = /^\\([A-Za-z]+|.)/.exec(src.slice(at.i));
    if (!m) { at.i++; continue; }
    at.i += m[0].length;
    const name = m[1]!;
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') { const a = group(), b = group(); out += `${wrap(a)}/${wrap(b)}`; }
    else if (name === 'sqrt') {
      let n = '';
      if (src[at.i] === '[') { const end = src.indexOf(']', at.i); n = src.slice(at.i + 1, end).trim(); at.i = end + 1; }
      const body = group();
      out += (n === '3' ? '∛' : n === '4' ? '∜' : n ? `${script(n, SUP, '^')}√` : '√') + wrap(body);
    } else if (name === 'overline' || name === 'bar') out += [...group()].map((c) => (/\p{L}/u.test(c) ? c + '̅' : c)).join('');
    else if (name === 'overrightarrow' || name === 'vec') out += group() + '⃗';
    else if (name === 'overleftrightarrow') out += group() + '⃡';
    else if (name === 'begin' || name === 'end') group();
    else if (name === '\\') out += '\n';
    else if (name === ',' || name === ';' || name === ' ' || name === ':') out += ' ';
    else if (name === '!') { /* negative space */ }
    else if (name === '{' || name === '}' || name === '%' || name === '$' || name === '#' || name === '&' || name === '_') out += name;
    else if (STYLE.has(name)) { /* the group that follows is read as ordinary text */ }
    else {
      out += SYM[name] ?? name;
      if (PREFIX.has(name)) while (src[at.i] === ' ') at.i++;
    }
  }
  return out;
}

/** LaTeX inside $…$, $$…$$, \(…\), \[…\] → plain Unicode; outside it only a stray \le or 	imes is replaced. */
export function latexToText(text: string): string {
  return text
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g, (_m, a?: string, b?: string, c?: string, d?: string) =>
      parse((a ?? b ?? c ?? d ?? '').trim(), { i: 0 }).replace(/[ \t]+/g, ' ').trim())
    // outside $…$ only a stray symbol name (\le, \times) is replaced
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => SYM[name] ?? m);
}
