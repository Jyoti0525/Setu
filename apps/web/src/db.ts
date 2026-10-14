// On-device storage (PLAN §8.5): event log + outbox, packs, device traces, meta.

import Dexie, { type Table } from 'dexie';
import type { AnyEvent, ChapterPack, TraceStep } from '@setu/core';

export interface StoredEvent { id: string; profileId: string; synced: 0 | 1; e: AnyEvent }
export interface StoredTrace { id?: number; profileId: string; at: number; synced: 0 | 1; step: TraceStep }
export interface Meta { key: string; value: unknown }
/** a photo kept on the phone until it can be read online; deleted right after (PLAN §6.8, P5.21) */
export interface QueuedSnap { doubtId: string; profileId: string; at: number; image: Blob }
/** a spoken question recorded offline, kept until it can be transcribed (P3.7); deleted right after */
export interface QueuedVoice { doubtId: string; profileId: string; at: number; audio: Blob }

class SetuDB extends Dexie {
  events!: Table<StoredEvent, string>;
  packs!: Table<ChapterPack, string>;
  traces!: Table<StoredTrace, number>;
  meta!: Table<Meta, string>;
  snaps!: Table<QueuedSnap, string>;
  voices!: Table<QueuedVoice, string>;
  constructor() {
    super('setu');
    this.version(1).stores({
      events: 'id, profileId, synced, [profileId+synced]',
      packs: 'id',
      traces: '++id, profileId, synced',
      meta: 'key',
    });
    this.version(2).stores({ snaps: 'doubtId, profileId' });
    this.version(3).stores({ voices: 'doubtId, profileId' });
  }
}

export const db = new SetuDB();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  try { return ((await db.meta.get(key))?.value as T) ?? fallback; } catch { return fallback; }
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

export async function profileEvents(profileId: string): Promise<AnyEvent[]> {
  return (await db.events.where('profileId').equals(profileId).toArray()).map((x) => x.e);
}
export async function outbox(profileId: string): Promise<AnyEvent[]> {
  return (await db.events.where('[profileId+synced]').equals([profileId, 0]).toArray()).map((x) => x.e);
}
export async function putEvents(events: AnyEvent[], synced: 0 | 1) {
  await db.events.bulkPut(events.map((e) => ({ id: e.id, profileId: e.profileId, synced, e })));
}
export async function markSynced(ids: string[]) {
  await db.events.where('id').anyOf(ids).modify({ synced: 1 });
}

/** Ask the browser not to evict our data (PLAN §8.5 storage survival). */
export async function persistStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
