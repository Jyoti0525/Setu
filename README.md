# Setu

An agentic tutor for a Class 9 student on a shared low-end phone: it teaches in Odia (and other Indian languages), checks understanding, diagnoses misconceptions, keeps working offline, and syncs when the signal returns.

- Plan: [docs/PLAN.md](docs/PLAN.md) · Build tracker: [docs/TODO.md](docs/TODO.md) · Spike results: [spikes/RESULTS.md](spikes/RESULTS.md)

## Run

Needs Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm --filter @setu/web build          # build the phone app
cp apps/server/.env.example apps/server/.env   # add free Gemini / Groq keys (optional)
pnpm --filter @setu/server start       # http://localhost:8787  ·  judge view: /trace/live
pnpm test                              # all tests
```

Without API keys the agent runs on its deterministic policy and the reviewed chapter pack: every feature works except live generated explanations. With keys, the LLM decides (and must give a reason to override the policy) and writes explanations, which a critic checks before the learner sees them.

## Layout

| Path | What |
|---|---|
| `packages/core` | Shared brain (phone + server): event log, `fold`, BKT, policy, `solve`, numerals, multi-script matcher, turn engine |
| `content` | Chapter packs (Class 9 Motion). Odia text is a draft awaiting native review |
| `apps/server` | Hono + SQLite + Google ADK agent cycle, critic, model failover, sync, `/trace/live` |
| `apps/web` | Preact PWA: onboarding, ask, checks, offline device tier, outbox sync |
| `spikes` | Feasibility spikes (ADK, Odia TTS) |

Textbook content belongs to its publishers; this is a non-commercial prototype.
