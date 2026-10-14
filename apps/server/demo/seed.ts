// Demo seed (TODO P7.10, P7.11): a class with realistic learners made by the real engine (simulated answers), so every
// beat of the demo has something true to show, then a warm cache for the scripted inputs.
//   tsx demo/seed.ts [--no-llm]        (uses apps/server/data/setu.sqlite, or SETU_DB; run with the server stopped or running)
// Prints the teacher key + class code and the link that opens Sunita's profile on the demo phone.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PackMatcher, fold, type AnyEvent, type TurnInput } from '@setu/core';
import { motionPack } from '@setu/content';
import { simulate, type Persona } from '../../../content/eval/simulator.ts';
import { Store } from '../src/db.ts';
import { buildModels } from '../src/llm.ts';
import { createClass } from '../src/teacher.ts';
import { betweenSessions, tick } from '../src/agent/between.ts';
import { runCycle, type CycleDeps } from '../src/agent/cycle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
}
const noLlm = process.argv.includes('--no-llm');
const store = new Store(process.env.SETU_DB ?? resolve(here, '../data/setu.sqlite'));
const models = noLlm ? buildModels({}) : buildModels();
const deps: CycleDeps = { store, pack: motionPack, matcher: new PackMatcher(motionPack), models, liveGenLangs: new Set(['or']), trustDraft: true, recentGen: new Map() };
const DAY = 86_400_000;
const now = Date.now();

const cls = createClass(store, '9A Science', 'or');
store.cacheSet(`region:${cls.code}`, 'coastal');
const join = (pid: string, dev: string, at: number, displayName: string): AnyEvent => ({ id: randomUUID(), profileId: pid, deviceId: dev, seq: 0, ts: at, type: 'CLASS_JOINED', payload: { classCode: cls.code, displayName, region: 'coastal' } } as AnyEvent);

interface Learner { name: string; avatar: string; persona: Persona; turns: number; daysAgo: number; endSession?: boolean }
const learners: Learner[] = [
  // the hero: knows the basics, mixes up speed and velocity — her last session ended last night, the agent prepared today's
  { name: 'Sunita', avatar: '👧', persona: { id: 'sunita', knows: ['reference_point', 'distance'], misconceptions: ['speed_equals_velocity'], learnsAfter: 1, goal: 'velocity' }, turns: 14, daysAgo: 1, endSession: true },
  // stuck: three different explanations of velocity did not shift her belief → "needs you" with the evidence
  { name: 'Ravi', avatar: '👦', persona: { id: 'ravi', knows: ['reference_point', 'distance', 'speed', 'displacement'], misconceptions: ['speed_equals_velocity'], learnsAfter: 1, goal: 'velocity', stubborn: true }, turns: 40, daysAgo: 1, endSession: true },
  // the same misconception in a second learner → the class reteach draft for the teacher to approve
  { name: 'Lipi', avatar: '🧒', persona: { id: 'lipi', knows: ['reference_point', 'distance', 'speed', 'displacement'], misconceptions: ['speed_equals_velocity'], learnsAfter: 1, goal: 'velocity', stubborn: true }, turns: 10, daysAgo: 2, endSession: true },
  // drop-off: active nine days ago, not since
  { name: 'Arjun', avatar: '🧑‍🌾', persona: { id: 'arjun', knows: ['reference_point'], misconceptions: ['distance_equals_displacement'], learnsAfter: 1, goal: 'velocity' }, turns: 8, daysAgo: 9, endSession: true },
];

const made: Record<string, string> = {};
for (const l of learners) {
  const pid = `p-demo-${l.name.toLowerCase()}`;
  const dev = `dev-demo-${l.name.toLowerCase()}`;
  const t0 = now - l.daysAgo * DAY - 3_600_000;
  const run = simulate(motionPack, l.persona, { maxTurns: l.turns, who: { profileId: pid, deviceId: dev, t0, lang: 'or', avatar: l.avatar }, extra: [join(pid, dev, t0, l.name)] });
  const events = [...run.events];
  const s = fold(events, motionPack.graph, pid);
  if (l.endSession && s.session) events.push({ id: randomUUID(), profileId: pid, deviceId: dev, seq: events.length + 1, ts: (events.at(-1)?.ts ?? t0) + 60_000, type: 'SESSION_ENDED', payload: { sessionId: s.session.id, reason: 'explicit', minutesUsed: 18 } } as AnyEvent);
  // her usual evening: 20 minutes (the simulator ran long sessions to gather history quickly)
  events.push({ id: randomUUID(), profileId: pid, deviceId: dev, seq: events.length + 1, ts: (events.at(-1)?.ts ?? t0) + 61_000, type: 'PROFILE_UPDATED', payload: { sessionMinutes: 20 } } as AnyEvent);
  store.append(events);
  made[l.name] = pid;
  const after = fold(store.events(pid), motionPack.graph, pid);
  console.log(`${l.avatar} ${l.name.padEnd(7)} ${events.length} events · velocity p=${(after.concepts.velocity?.pKnown ?? 0.2).toFixed(2)} · escalations ${after.escalations.length} · misconceptions ${Object.values(after.concepts).flatMap((c) => Object.entries(c.misconceptions).filter(([, m]) => !m.resolved).map(([k, m]) => `${k}${m.confirmed ? '(confirmed)' : ''}`)).join(',') || '-'}`);
}

// the between-session agent runs for the learners whose sessions ended (plans, pre-writes, escalations, reteach drafts)
for (const l of learners.filter((x) => x.daysAgo <= 2)) {
  const r = await betweenSessions({ ...deps, now: () => now - 6 * 3_600_000 }, made[l.name]!, 'session_end');
  console.log(`  after-session run for ${l.name}: ${r?.trace.tools.map((t) => t.tool).join(', ') ?? 'nothing'}`);
}
const t = await tick({ ...deps, now: () => now });
console.log(`  schedule tick: ended ${t.ended.length}, drop-off flagged ${t.dropoff.length}`);

// warm the cache for the scripted beats: a copy of Sunita's state answers them once, so the live demo answers instantly
if (!noLlm) {
  const clone = `p-warm-${randomUUID().slice(0, 6)}`;
  store.append(store.events(made.Sunita!).map((e) => ({ ...e, id: `${clone}-${e.id}`, profileId: clone, deviceId: 'dev-warm' })));
  let lastSeq = 10_000, cursor = 0;
  for (const input of [{ type: 'doubt', doubtId: 'w1', text: 'speed aau velocity re farak kana?', mode: 'text' }, { type: 'doubt', doubtId: 'w2', text: 'ସ୍ପିଡ୍ ଆଉ ଭେଲୋସିଟି ରେ ଫରକ କଣ', mode: 'voice' }] as TurnInput[]) {
    const r = await runCycle({ ...deps, budgetMs: 60_000 }, { profileId: clone, deviceId: 'dev-warm', clientNow: Date.now(), lastSeq, cursor, outbox: [], input });
    lastSeq = r.lastSeq; cursor = r.cursor;
    console.log(`  warm: "${(input as { text: string }).text}" → ${r.trace.chosen} (${r.trace.llm_calls.map((c) => `${c.job}:${c.outcome}`).join(', ') || 'no model call'})`);
  }
}

const base = process.env.SETU_PUBLIC_URL ?? 'http://localhost:8787';
console.log(`\nClass "9A Science" code ${cls.code} · teacher key (keep private): ${cls.token}`);
console.log(`Teacher view: ${base}/#teacher  (open, "I have a class key", paste the key)`);
console.log(`Sunita on the demo phone: ${base}/#restore=${made.Sunita}&n=Sunita&a=👧&c=${cls.code}${process.env.SETU_DEMO_KEY ? `&k=${process.env.SETU_DEMO_KEY}` : ''}`);
