// Phone-side agent client. Online: server cycle with sync-before-think. Offline/weak failure:
// the same core engine runs on the device (PLAN §8.2). Every step is an event committed
// before it renders (PLAN §8.4).

import {
  fold, runTurn, PackMatcher, type AnyEvent, type ChapterPack, type EventDraft, type LearnerState,
  type OutMsg, type TraceStep, type TurnInput, type Tier, type PackDiff,
} from '@setu/core';
import { applyDiff } from './packfile.ts';
import { db, getMeta, setMeta, outbox, putEvents, markSynced, profileEvents } from './db.ts';
import { currentTier, fetchWithTimeout, probeIfStale, report } from './net.ts';

export const PACK_ID = 'cbse9-sci-motion';

export interface Device { token: string; deviceId: string }

export async function ensureDevice(): Promise<Device | null> {
  const d = await getMeta<Device | null>('device', null);
  if (d) return d;
  try {
    const r = await fetchWithTimeout('/api/device', { method: 'POST' }, 6000);
    const dev = (await r.json()) as Device;
    await setMeta('device', dev);
    return dev;
  } catch {
    return null;
  }
}

export async function ensurePack(): Promise<ChapterPack | null> {
  const have = await db.packs.get(PACK_ID);
  // P4.12: a pack we already have is only re-checked (ETag, a few bytes); the first download waits for any signal
  try {
    const r = await fetchWithTimeout(`/api/pack/${PACK_ID}?diff=1`, { headers: have?.hash ? { 'if-none-match': have.hash } : {} }, 15000);
    if (r.status === 304) return have!;
    if (r.ok) {
      // P4.14: an update arrives as a diff by item version; used only if the result hashes to the new version
      if (r.headers.get('x-pack-diff') === '1' && have) {
        const next = await applyDiff(have, (await r.json()) as PackDiff);
        if (next) { await db.packs.put(next); return next; }
        return refetchFull(have);
      }
      const p = (await r.json()) as ChapterPack;
      await db.packs.put(p);
      return p;
    }
  } catch { /* offline: use what we have */ }
  return have ?? null;
}
async function refetchFull(have: ChapterPack): Promise<ChapterPack> {
  try {
    const r = await fetchWithTimeout(`/api/pack/${PACK_ID}`, {}, 15000);
    if (r.ok) { const p = (await r.json()) as ChapterPack; await db.packs.put(p); return p; }
  } catch { /* keep what we have */ }
  return have;
}
/** A pack file a friend shared (P4.13), already hash-checked; kept unless the phone has the same or newer. */
export async function importPack(p: ChapterPack): Promise<ChapterPack> {
  const have = await db.packs.get(p.id);
  if (have && have.version > p.version) return have;
  await db.packs.put(p);
  return p;
}

export interface TurnOutcome { messages: OutMsg[]; trace: TraceStep; tier: Tier; state: LearnerState }

export class Agent {
  private matcher: PackMatcher;
  private deviceId: string;
  constructor(readonly pack: ChapterPack, readonly device: Device | null, readonly profileId: string) {
    this.matcher = new PackMatcher(pack);
    this.deviceId = device?.deviceId ?? `local-${profileId}`;
  }

  async state(): Promise<LearnerState> {
    return fold(await profileEvents(this.profileId), this.pack.graph, this.profileId);
  }

  private async nextSeq(): Promise<number> {
    const n = (await getMeta<number>(`lastSeq:${this.profileId}`, 0)) + 1;
    await setMeta(`lastSeq:${this.profileId}`, n);
    return n;
  }

  /** Append local events (not yet synced). */
  async record(drafts: EventDraft[], turn?: AnyEvent['turn']): Promise<AnyEvent[]> {
    const out: AnyEvent[] = [];
    for (const d of drafts) {
      out.push({ ...d, id: crypto.randomUUID(), profileId: this.profileId, deviceId: this.deviceId, seq: await this.nextSeq(), ts: Date.now(), ...(turn ? { turn } : {}) } as AnyEvent);
    }
    await putEvents(out, 0);
    return out;
  }

  async turn(input: TurnInput): Promise<TurnOutcome> {
    // P4.4: one id per turn — a retried request is answered from the server's memory, and if we give up and run it
    // here, our copy of the turn is the one that counts (canonicalOrder drops the server's late copy)
    const turnId = crypto.randomUUID();
    const tier = this.device ? await probeIfStale() : 'device';
    if (tier !== 'device' && this.device) {
      const online = await this.onlineTurn(input, turnId).catch(() => null);
      if (online) return online;
    }
    return this.deviceTurn(input, turnId);
  }

  private async onlineTurn(input: TurnInput, turnId: string): Promise<TurnOutcome | null> {
    const pending = await outbox(this.profileId);
    const body = {
      profileId: this.profileId, clientNow: Date.now(), turnId,
      lastSeq: await getMeta<number>(`lastSeq:${this.profileId}`, 0),
      cursor: await getMeta<number>(`cursor:${this.profileId}`, 0),
      outbox: pending, input, tier: currentTier(),
    };
    const t0 = performance.now();
    const send = () => fetchWithTimeout('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': this.device!.token }, body: JSON.stringify(body) }, 12000);
    let r: Response;
    try {
      r = await send();
    } catch (e) {
      // a dropped connection (not a timeout) on a weak link: retry the same turn once — safe, it is idempotent
      if ((e as Error).name === 'AbortError' || performance.now() - t0 > 6000) { report(false, 0); return null; }
      try { r = await send(); } catch { report(false, 0); return null; }
    }
    report(r.ok, performance.now() - t0);
    if (!r.ok) return null;
    const res = await r.json() as { messages: OutMsg[]; events: AnyEvent[]; cursor: number; lastSeq: number; trace: TraceStep; tier: Tier };
    await markSynced(pending.map((e) => e.id));
    await putEvents(res.events, 1);
    await setMeta(`cursor:${this.profileId}`, res.cursor);
    await setMeta(`lastSeq:${this.profileId}`, Math.max(res.lastSeq, await getMeta<number>(`lastSeq:${this.profileId}`, 0)));
    await this.countData(JSON.stringify(body).length + JSON.stringify(res).length);
    // a turn reply carries at most 40 events (P4.3); further behind → fetch the rest in the background
    if (res.events.length >= 40) void this.sync();
    return { messages: res.messages, trace: res.trace, tier: res.tier, state: await this.state() };
  }

  private async deviceTurn(input: TurnInput, turnId?: string): Promise<TurnOutcome> {
    const s = await this.state();
    const drafts: EventDraft[] = [];
    const r = runTurn(s, input, { pack: this.pack, matcher: this.matcher, now: Date.now(), tier: 'device', trustDraft: true }, (d) => {
      drafts.push(d);
      // stamped below; runTurn needs a full event to fold — give it a provisional one
      return { ...d, id: `tmp-${drafts.length}`, profileId: this.profileId, deviceId: this.deviceId, seq: 0, ts: Date.now() } as AnyEvent;
    });
    await this.record(drafts, turnId ? { id: turnId, by: 'device' } : undefined);
    await db.traces.add({ profileId: this.profileId, at: Date.now(), synced: 0, step: r.trace });
    return { messages: r.messages, trace: r.trace, tier: 'device', state: await this.state() };
  }

  /** Flush outbox + device traces when signal is back; pull server events (queued answers etc.). */
  async sync(): Promise<{ sent: number; received: number } | null> {
    if (!this.device) return null;
    const pending = await outbox(this.profileId);
    const traces = await db.traces.where('synced').equals(0).filter((t) => t.profileId === this.profileId).toArray();
    try {
      const r = await fetchWithTimeout('/api/sync', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': this.device.token },
        body: JSON.stringify({ profileId: this.profileId, cursor: await getMeta<number>(`cursor:${this.profileId}`, 0), outbox: pending, traces: traces.map((t) => ({ ...t.step, at: t.at })) }),
      }, 12000);
      if (!r.ok) return null;
      const res = await r.json() as { events: AnyEvent[]; cursor: number };
      await markSynced(pending.map((e) => e.id));
      await db.traces.bulkUpdate(traces.map((t) => ({ key: t.id!, changes: { synced: 1 as const } })));
      await putEvents(res.events, 1);
      await setMeta(`cursor:${this.profileId}`, res.cursor);
      return { sent: pending.length, received: res.events.length };
    } catch {
      return null;
    }
  }

  private async countData(bytes: number) {
    await this.record([{ type: 'DATA_USED', payload: { kb: Math.ceil(bytes / 1024) } }]);
  }
}
