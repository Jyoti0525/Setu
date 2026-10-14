// Numeral normalisation + unit-aware numeric answers (PLAN §6.5).

/** Zero code points of decimal digit blocks used for Indian languages (and Arabic-Indic for Urdu). */
const DIGIT_ZEROS = [
  0x0966, // Devanagari
  0x09e6, // Bengali / Assamese
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia ୦
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x1c50, // Ol Chiki (Santali)
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Urdu)
];

export function normalizeDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

/** Convert ASCII digits to a script's digits, for display. */
export function toScriptDigits(text: string, lang: string): string {
  const zero = { or: 0x0b66, hi: 0x0966, mr: 0x0966, bn: 0x09e6, as: 0x09e6, pa: 0x0a66, gu: 0x0ae6, ta: 0x0be6, te: 0x0c66, kn: 0x0ce6, ml: 0x0d66 }[lang];
  if (zero === undefined) return text;
  return text.replace(/[0-9]/g, (d) => String.fromCodePoint(zero + Number(d)));
}

export type Dimension = 'length' | 'time' | 'speed' | 'acceleration';

interface UnitDef { dim: Dimension; toSI: number }

// Base SI: m, s, m/s, m/s². Includes Odia and Hindi unit words learners actually type.
const UNITS: Record<string, UnitDef> = {
  m: { dim: 'length', toSI: 1 }, metre: { dim: 'length', toSI: 1 }, meter: { dim: 'length', toSI: 1 }, metres: { dim: 'length', toSI: 1 }, meters: { dim: 'length', toSI: 1 },
  'ମି': { dim: 'length', toSI: 1 }, 'ମିଟର': { dim: 'length', toSI: 1 }, 'मी': { dim: 'length', toSI: 1 }, 'मीटर': { dim: 'length', toSI: 1 },
  km: { dim: 'length', toSI: 1000 }, kilometre: { dim: 'length', toSI: 1000 }, kilometer: { dim: 'length', toSI: 1000 },
  'କିମି': { dim: 'length', toSI: 1000 }, 'କି.ମି': { dim: 'length', toSI: 1000 }, 'କିଲୋମିଟର': { dim: 'length', toSI: 1000 }, 'किमी': { dim: 'length', toSI: 1000 }, 'किलोमीटर': { dim: 'length', toSI: 1000 },
  cm: { dim: 'length', toSI: 0.01 }, 'ସେମି': { dim: 'length', toSI: 0.01 }, 'सेमी': { dim: 'length', toSI: 0.01 },
  s: { dim: 'time', toSI: 1 }, sec: { dim: 'time', toSI: 1 }, second: { dim: 'time', toSI: 1 }, seconds: { dim: 'time', toSI: 1 },
  'ସେ': { dim: 'time', toSI: 1 }, 'ସେକେଣ୍ଡ': { dim: 'time', toSI: 1 }, 'से': { dim: 'time', toSI: 1 }, 'सेकंड': { dim: 'time', toSI: 1 },
  min: { dim: 'time', toSI: 60 }, minute: { dim: 'time', toSI: 60 }, minutes: { dim: 'time', toSI: 60 }, 'ମିନିଟ': { dim: 'time', toSI: 60 }, 'मिनट': { dim: 'time', toSI: 60 },
  h: { dim: 'time', toSI: 3600 }, hr: { dim: 'time', toSI: 3600 }, hour: { dim: 'time', toSI: 3600 }, hours: { dim: 'time', toSI: 3600 }, 'ଘଣ୍ଟା': { dim: 'time', toSI: 3600 }, ghanta: { dim: 'time', toSI: 3600 }, ghante: { dim: 'time', toSI: 3600 }, 'घंटा': { dim: 'time', toSI: 3600 }, 'घंटे': { dim: 'time', toSI: 3600 },
  'm/s': { dim: 'speed', toSI: 1 }, 'ms-1': { dim: 'speed', toSI: 1 }, 'ମି/ସେ': { dim: 'speed', toSI: 1 }, 'मी/से': { dim: 'speed', toSI: 1 },
  'km/h': { dim: 'speed', toSI: 1000 / 3600 }, kmph: { dim: 'speed', toSI: 1000 / 3600 }, 'km/hr': { dim: 'speed', toSI: 1000 / 3600 }, 'କିମି/ଘଣ୍ଟା': { dim: 'speed', toSI: 1000 / 3600 }, 'किमी/घंटा': { dim: 'speed', toSI: 1000 / 3600 },
  'm/s2': { dim: 'acceleration', toSI: 1 }, 'm/s^2': { dim: 'acceleration', toSI: 1 }, 'm/s²': { dim: 'acceleration', toSI: 1 }, 'ms-2': { dim: 'acceleration', toSI: 1 }, 'ମି/ସେ²': { dim: 'acceleration', toSI: 1 }, 'मी/से²': { dim: 'acceleration', toSI: 1 },
};

export interface ParsedQuantity { value: number; unit?: string; dim?: Dimension; si?: number }

/** Parse "୧୨.୫ ମି/ସେ", "12.5 m/s", "-3 m/s2", "1/2" etc. Returns null if no number. */
export function parseQuantity(raw: string): ParsedQuantity | null {
  const text = normalizeDigits(raw).replace(/,/g, '').replace(/[−–]/g, '-').trim();
  const m = text.match(/(-?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/u);
  if (!m) return null;
  let value = Number(m[1]);
  if (m[2]) value = value / Number(m[2]);
  if (!Number.isFinite(value)) return null;
  const unitText = (m[3] ?? '').trim().replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();
  if (!unitText) return { value };
  const def = UNITS[unitText] ?? UNITS[unitText.replace(/\.$/, '')];
  if (!def) return { value, unit: unitText };
  return { value, unit: unitText, dim: def.dim, si: value * def.toSI };
}

export interface NumericKey { value: number; dim?: Dimension; /** relative tolerance */ tol?: number }

/**
 * Compare a learner's numeric answer with the key (value in SI units).
 * If the learner gave no unit, the number is compared directly in SI.
 * A unit of the wrong dimension is wrong (and is itself a diagnostic signal).
 */
export function gradeNumeric(answer: string, key: NumericKey): { correct: boolean; reason: 'ok' | 'no_number' | 'wrong_dimension' | 'wrong_value' | 'sign' } {
  const q = parseQuantity(answer);
  if (!q) return { correct: false, reason: 'no_number' };
  if (key.dim && q.dim && q.dim !== key.dim) return { correct: false, reason: 'wrong_dimension' };
  const got = q.si ?? q.value;
  const tol = key.tol ?? 0.02;
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * tol, 1e-9);
  if (close(got, key.value)) return { correct: true, reason: 'ok' };
  if (close(-got, key.value)) return { correct: false, reason: 'sign' };
  return { correct: false, reason: 'wrong_value' };
}

/** Pull every number out of a text (after digit normalisation) — used by the critic. */
export function extractNumbers(text: string): number[] {
  return [...normalizeDigits(text).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}
