// Inline stroke icons (24×24, currentColor): no icon font or library to download on a 2 GB phone.
const P: Record<string, string> = {
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  stop: 'M7 7h10v10H7z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  back: 'M19 12H5M12 19l-7-7 7-7',
  offline: 'M1 1l22 22M16.7 11.1A11 11 0 0 1 19 12.5M5 12.5a11 11 0 0 1 5.2-2.4M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.3-2.7M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  wifi: 'M5 12.5a11 11 0 0 1 14 0M1.4 9a16 16 0 0 1 21.2 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  spark: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  chevron: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  play: 'M6 4l14 8-14 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  plus: 'M12 5v14M5 12h14',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4',
};

export function Icon({ name, size = 22, label }: { name: keyof typeof P | string; size?: number; label?: string }) {
  return (
    <svg class="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      <path d={P[name] ?? ''} />
    </svg>
  );
}

/** The Setu mark: a bridge arch over water, in the brand colours. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" class="logo">
      <rect width="48" height="48" rx="14" fill="var(--primary)" />
      <path d="M8 31c5-11 27-11 32 0" stroke="var(--accent)" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <path d="M8 31h32M16 31v-6M24 31v-8M32 31v-6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
      <path d="M10 37c3-2 5-2 8 0s5 2 8 0 5-2 8 0" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round" />
    </svg>
  );
}
