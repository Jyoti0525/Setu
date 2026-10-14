// Chapter packs on the phone (P4.12–P4.14): integrity by hash, small diff updates, and phone-to-phone sharing as one
// file (WhatsApp / Bluetooth / Files) for a friend who has no data — checked by hash before it is used.

import { applyPackDiff, type ChapterPack, type PackDiff } from '@setu/core';

/** sha256 of the pack without its `hash` field — the same canonical JSON the server hashes. */
export async function packHash(p: ChapterPack): Promise<string> {
  const { hash: _h, ...rest } = p;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rest)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A diff from the server applied to the pack we have; null if the result does not hash to what the server said. */
export async function applyDiff(have: ChapterPack, d: PackDiff): Promise<ChapterPack | null> {
  try {
    const next = applyPackDiff(have, d);
    return (await packHash(next)) === d.to ? { ...next, hash: d.to } : null;
  } catch { return null; }
}

const FORMAT = 'setu-pack/1';

/** The pack as one file to pass to a friend. */
export function packFile(p: ChapterPack): File {
  const body = JSON.stringify({ format: FORMAT, hash: p.hash, pack: p });
  return new File([body], `setu-${p.id}-v${p.version}.setu.json`, { type: 'application/json' });
}

/** Share sheet when the phone has one (WhatsApp, Bluetooth…), else a download. */
export async function sharePack(p: ChapterPack): Promise<'shared' | 'saved' | 'cancelled'> {
  const f = packFile(p);
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [f] })) {
    try { await nav.share({ files: [f], title: f.name }); return 'shared'; } catch { return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'saved';
}

/** A pack file from a friend: used only if its content hashes to the hash it carries. */
export async function readPackFile(file: File): Promise<ChapterPack | { error: 'format' | 'hash' }> {
  let j: { format?: string; hash?: string; pack?: ChapterPack };
  try { j = JSON.parse(await file.text()); } catch { return { error: 'format' }; }
  if (j.format !== FORMAT || !j.pack?.id || !j.pack.graph || !j.hash) return { error: 'format' };
  if ((await packHash(j.pack)) !== j.hash) return { error: 'hash' };
  return { ...j.pack, hash: j.hash };
}
