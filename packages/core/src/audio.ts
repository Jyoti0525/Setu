// Pre-recorded pack audio (PLAN §10.2, TODO P3.8). A clip is keyed by the exact text the phone would speak,
// so the phone finds it without any id plumbing: same text → same key on phone, server and generator.

/** FNV-1a 32-bit of the NFC-normalised, whitespace-collapsed text → 8 hex chars. */
export function audioKey(text: string): string {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(t)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
