# Setu

An agentic tutor for a Class 9 student on a shared low-end phone: it teaches in Odia (and other Indian languages), checks understanding, diagnoses misconceptions, keeps working offline, and syncs when the signal returns.

**Languages.** Odia, Hindi, English (full); Bengali, Kannada, Telugu, Tamil, Marathi, Bhojpuri and Santali (Ol Chiki) — AI-written, marked as drafts until a speaker reviews them. Kui, Kuvi, Ho, Saora and Munda, which no free model writes: taught in easy Odia with the student's own words from the Government of Odisha's Odia–tribal dictionaries (`content/tribal`), never invented ones. After each answer Setu also says the main idea in her home language: the AI learns the language from the dictionaries' ~2,400 real example sentences (hold-out test: about twice as close to the real sentence as without them), keeps a sentence only if its words are in the dictionary, and reads it aloud (Ho, Kuvi, Munda have their own free MMS voices). Speakers approve or fix these sentences at `/#review=<lang>`, and each approved line becomes an example for the next answer.
**Boards (Class 9).** BSE Odisha (12 books, Odia) and CBSE (NCERT 2026-27: Science *Exploration*, Maths *Ganita Manjari* I–II, Social Science *Understanding Society* I–II, English *Kaveri*; Hindi-medium *Anveshan* and *Ganita Manjari*). A student is answered only from her own board's books.

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
| `content` | Textbook indexes (`books/books.json` → `books/out`), chapter packs (Motion), home-language word lists (`tribal/`), scripts that build them |
| `packages/core/src/locales` | Interface lines for the drafted languages (`content/scripts/translate_ui.ts`) |
| `tools/books` | PDF → pages: `render.py` (scans → OCR), `pdf_text.py`, `ncert_book.py` (NCERT chapter PDFs) |
| `apps/server` | Hono + SQLite + Google ADK agent cycle, critic, model failover, sync, `/trace/live` |
| `apps/web` | Preact PWA: onboarding, ask, checks, offline device tier, outbox sync |
| `spikes` | Feasibility spikes (ADK, Odia TTS) |

Textbook content belongs to its publishers; this is a non-commercial prototype.
