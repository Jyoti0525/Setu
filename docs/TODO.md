# Setu — Build TODO (tracks docs/PLAN.md v3)

Every item in PLAN.md is here as a checkbox with its plan section (§). Nothing gets deleted from this file. If something is skipped or cut, it stays here with its mark and the reason, so we always know what was done, missed, or cut.

**Status marks**
- `[ ]` not started
- `[~]` in progress / partly done (note what's missing)
- `[x]` done **and** its exit test passed (note how it was checked)
- `[!]` blocked (note on what)
- `[-]` deliberately skipped / cut (note why — only items on the cut order may be cut, §13)

**Rules**
1. Build order is the phase order (§13, principle 11): P0 → S1 → P2 … P7. A phase is done only when its **exit test** passes.
2. **Never cut** (§13): verification loop, learner model, around-the-clock agent, device tier + sync, Snap, trace, Odia voice, child-safety layer, baseline comparison.
3. **Cut order if time runs out** (cut the first one first): home-language anchors → edge tier → on-device voice model → embedding matcher → Hindi pack → reteach draft → field test size.
4. Add a line to the **Build log** at the bottom at the end of every work session.

---

## 0. Decisions & things only the user can provide (PLAN §19)

- [ ] D1 TypeScript end-to-end — OK? *(build started on this assumption)*
- [ ] D2 Name "Setu" — OK?
- [ ] D3 Odia Class 9 Science "Motion" chapter (BSE Odisha textbook PDF/photos)
- [ ] D4 Low-end Android phone (2–3 GB RAM, Android 8+, Chrome) for testing
- [x] D5 Free API keys: Google AI Studio (Gemini) + Groq → put in `apps/server/.env` (never committed, never in the PWA)
  - 2026-10-13: Gemini + Groq keys in apps/server/.env (gitignored). Both verified live.
- [ ] D6 Native Odia reviewer (content review + language-quality rubric)
  - 2026-10-13: Review tool ready: /#review (key = SETU_REVIEW_KEY). 290 lines (pack 175, tutor lines 25, app screens 51, teacher view ~40) beside their English, 79 with the recorded voice to rate 👍/👎. One sitting. Then `content/scripts/review_apply.ts or --from <server> --key <key>`.
- [ ] D7 Field test: 3–5 Class 9 Odia-medium students, with parent consent
- [ ] D8 Mid-evaluation date (decides how thin S1 must be) — *user: "don't worry about it now"*
- [ ] D9 Confirm India child-helpline list for the wellbeing flow (§6.7) before the demo
- [ ] D10 Check Groq / OpenRouter terms the same way as Gemini's (§10.3)
- [x] D11 Check Indic Parler-TTS licence (§10.2); MMS-TTS is CC-BY-NC (non-commercial prototype only) — Parler = Apache-2.0 (gated, auto-approve); MMS = CC-BY-NC-4.0
- [ ] D12 Free Hugging Face account + read token (for Indic Parler-TTS, gated)

---

## P0 — Feasibility spikes (§13)

Each spike: record pass/fail + numbers in `spikes/RESULTS.md`. A failed spike switches to its fallback; it does not stop the build.

- [~] P0.a Gemini Odia **text** quality — 30 answers, native-scored on rubric (correctness, naturalness, level, term usage) → sets Odia tier (§7.4) and live-vs-pack bar (§7.5). *Fail →* reviewed packs carry the teaching; LLM used for understanding/planning only. *(needs D5, D6)*
  - 2026-10-13: Gemini uses textbook Odia terms; critic passes. Native 30-answer rubric still needs D6. See spikes/RESULTS.md.
- [ ] P0.b Gemini **audio** input with Odia speech (ASR chain step 1, §10.1). *Fail →* move down the ASR chain. *(needs D5)*
- [ ] P0.c Chrome Web Speech API `or-IN` on Android (§10.1 step 2). *Fail →* Gboard mic / self-hosted ASR. *(needs D4)*
- [ ] P0.d Vision + Tesseract-locate on **10 textbook photos** (Gemini vision online; Tesseract.js `ori` + fuzzy n-gram locate offline, §6.8). *(needs D3, D5)*
- [~] P0.e Odia TTS voice: edge-tts (`--list-voices` for or-IN names) and AI4Bharat Indic Parler-TTS (§10.2)
  - 2026-10-13: 67 MMS-TTS Odia clips now ship (P3.8). Native rating is part of the D6 review page (👍/👎 per clip).
  - 2026-10-13: edge-tts has **no Odia voice** (PLAN §10.2 corrected). MMS-TTS Odia works on CPU (samples in `spikes/tts/out/`). **Missing:** native-ear rating of samples (D6); Parler-TTS test needs a free Hugging Face token (D12).
- [x] P0.f Gemma (same Gemini key) and Groq Odia fallback quality (§10.3). *(needs D5)*
  - 2026-10-13: Groq models misuse Odia terms → Groq never writes Odia; Gemma correct but slow → last in chain.
- [ ] P0.g Real RPM/RPD limits + latency of a 2-call cycle; check p50 < 5 s / p95 < 10 s is reachable (§5.8). *(needs D5)*
- [ ] P0.h Real low-end phone: PWA persistent storage (`navigator.storage.persist()`), runtime memory, Odia font/conjunct rendering (§7.6, §8.5, §8.7). *(needs D4)*
- [x] P0.i Google ADK TS 2.x: graph workflow + LLM node + tool + callback + state + human-input pause + **non-Gemini fallback** + one eval case → choose ADK or LangGraph.js (§5.3). *Fail →* LangGraph.js with the same design.
  - Done 2026-10-13: all pass except eval (ADK TS eval = 501 not implemented) → **ADK TS 2.2.1 chosen**; eval via own simulator (P6.2) + golden tests (P2.55). Real Gemini call still to run once D5 key arrives. Details: `spikes/RESULTS.md`.
  - Follow-ups: circuit breaker in router (P2.14); `OpenAICompatLlm` connector moves to server (P2.14).
- [ ] P0.z Write the outcomes into PLAN §10 chain order, §7.4 Odia tier and §5.3 framework choice

---

## S1 — Vertical slice (= mid-eval package) (§13)

**Exit test:** a text doubt in Odia → explained → check → wrong answer → *different strategy* → right → mastery moves, all visible in `/trace/live`, **on the real phone**.

Repo & tooling (§10.8)
- [~] S1.1 pnpm workspaces: `packages/core`, `apps/server`, `apps/web`, `content/`, `eval/`, `spikes/`; TypeScript strict; vitest; `.gitignore` keeps `.env` out
  - 2026-10-13: workspaces + strict TS + vitest + .gitignore done; `eval/` package not created yet (P6).
- [x] S1.2 `.env.example` with key names only; keys server-side only (§10.7)
  - `apps/server/.env.example`; keys only read in `apps/server/src/llm.ts`.

Shared core — minimal (§5.6, §6.3, §8.5)
- [x] S1.3 Event type `{id, profileId, deviceId, seq, ts, type, payload, itemVersion?}`
  - packages/core (events.ts, state.ts, fold.ts, bkt.ts, graph.ts, pack.ts); tests in packages/core/test.
- [x] S1.4 `LearnerState` type exactly as §6.3 (profile, language, constraints, goal, concepts, commitments, queuedDoubts, preparedSession, resumePointer)
- [x] S1.5 `fold(events) → LearnerState` (pure, deterministic)
- [x] S1.6 BKT update: p(L0)=0.2, p(T)=0.15, slip=0.1, guess=0.25; evidence weighted by source confidence
- [x] S1.7 Mastered rule: pKnown ≥ 0.85 **and** last 2 trustworthy checks correct
- [x] S1.8 Concept graph type with prerequisites; content items versioned `itemId@version`

Content — 3 concepts (§11)
- [~] S1.9 3 Motion concepts (e.g., distance → displacement → speed) in Odia + English: ≥ 2 strategies each, checks with distractor→misconception tags, glossary entries
  - 6-concept graph; distance, displacement, speed, velocity have 3–4 strategies + 4–5 checks each; reference point 2+2; acceleration 1 explanation. **All Odia is my draft**: needs D3 textbook + D6 native review. Draft content counts as trusted only with SETU_TRUST_DRAFT=1 (dev).

Agent cycle (§5.4)
- [x] S1.10 ADK (or fallback) cycle: trigger → perceive → build situation → decide (LLM call 1) → act → observe → generate (LLM call 2) → respond & commit
  - apps/server/src/agent/cycle.ts: ADK Workflow perceive → decide(LlmAgent) → act → generate(LlmAgent) → commit; the same stages run on the phone via core/engine.ts.
- [x] S1.11 Tools (minimal): `search_curriculum` (BM25), `teach`, `make_check` (bank), `evaluate_answer`, `update_learner`
- [x] S1.12 Wrong answer → next strategy differs from the one just used (strategiesTried)
  - tested in content/test/scenario.test.ts and apps/server/test/cycle.test.ts
- [x] S1.13 Every state change emitted as an event (ADK state is only a working copy)

Server & UI
- [x] S1.14 Hono server: `/turn` endpoint (accepts outbox events first — sync-before-think), SQLite event store
  - POST /api/turn with outbox (sync-before-think), SQLite event store, dedupe by id; tested.
- [x] S1.15 Trace record (§5.7 fields) + SSE stream + `/trace/live` page
  - /trace/live (SSE; filters for overrides, fallbacks, tier, tool); device traces upload on sync.
- [x] S1.16 Bare PWA screen: Odia text doubt → explanation → check → result
  - apps/web (Preact + Dexie + Workbox PWA), 62 KB gz JS. Browser-tested at 390 px: Odia doubt → probe → wrong → different strategy; airplane mode → device tier; reconnect → sync with 0 duplicates.
- [!] S1.17 Runs on the real phone through the tunnel
  - needs D4 (phone) + tunnel. Not yet run on a real phone, so the S1 exit test has NOT passed yet.
- [x] S1.18 Mid-eval package: problem, users, architecture diagram, running loop skeleton, planned bonuses (§1 deliverables) — docs/MIDEVAL.md: problem, users, architecture diagram (mermaid), the loop step by step, status, planned bonuses

---

## P2 — Thicken the agent (§13)

**Exit test:** golden tests green; **same input + different state → different decision**.

Policy & decision (§5.5)
- [x] P2.1 `policy.recommend(state)` with full scoring formula: w1·goalWeight·(1−pKnown)·prereqReady + w2·reviewUrgency + w3·misconceptionSeverity + w4·examProximity − w5·timeCost/timeLeft − w6·dataCost/dataLeft; weights configurable
- [x] P2.2 `prereqReady(c) = min_p sigmoid((pKnown(p) − 0.6)·k)`
- [x] P2.3 LLM sees top candidates with scores and reasons, plus input the policy can't read (words, photo, tone)
  - decidePrompt shows top-6 candidates with scores + reasons; learner text fenced as data.
- [x] P2.4 Semantic validation (before-tool callback): action exists; concept in graph; affordable in time/data; available in current tier
  - validateDecision(): action exists, concept in graph, valid strategy, never reuses the failed strategy, affordable in time.
- [x] P2.5 Override allowed only with a stated reason grounded in state/input; logged (`override: true`)
- [x] P2.6 Invalid LLM decision → rejected → policy top candidate used; trace shows `decided_by: policy`

Loop across turns (§5.4)
- [x] P2.7 Session plan + hypotheses (suspected misconception, weak prerequisite) persist in state and are revised every cycle
  - 2026-10-13: the prepared plan (PLAN_SET) is now produced (prepareSession) and followed item by item; items no longer worth doing are skipped (plan repair).
  - hypotheses + resume pointer live in state; a prepared session plan (PLAN_SET) is used on open but not yet produced (P4.24).
- [x] P2.8 Observation contradicts plan (empty retrieval, weak prerequisite) → exactly one replan (LLM call ≤ 3) — replan agent after decide: weak prerequisite or empty retrieval → one more decide call (≤ 3 total), validated, else policy; trace "replan:" (teaching.test.ts)

Call budget & latency (§5.8)
- [x] P2.9 ≤ 2 LLM calls per cycle (≤ 3 with replan), enforced by a budget guard callback; deterministic tools never call an LLM
  - MAX_LLM_CALLS = 2 per cycle; routine steps (correct answer, next) spend 0 LLM calls.
- [x] P2.10 Deterministic critic: Odia script ratio (U+0B00–U+0B7F, glossary terms whitelisted); cited-chunk term/number consistency; answer-key leak match; numbers re-checked by `solve`; length/level heuristics; safety lexicon — + solver re-check of distance/time/speed relations, reading-level sentence/word limits, bookish words, citations
  - 2026-10-13: term check added (glossary `avoid` list + the concept's own textbook term must appear). Still missing: re-checking numbers with `solve` beyond grounding.
  - apps/server/src/agent/critic.ts: script ratio, grounded numbers, answer leak, length/level, safety lexicon. Missing: term consistency with cited chunks.
- [x] P2.11 LLM critic only when the deterministic critic is borderline — judge agent only when every problem is one a rule cannot be sure of (term in another form, script ratio 50–60%)
- [x] P2.12 Critic rejects → revise once → reviewed cached content (§6.2) — revise agent: problems fed back once; still failing → reviewed pack content; unsafe never revised
  - reject → reviewed pack content; the revise-once retry is not built.
- [x] P2.13 Model routing: Flash-Lite for decide/classify; Flash for generate/vision/audio
  - 2026-10-13: live defaults gemini-3.1-flash-lite (decide), gemini-2.5-flash (generate); Groq gpt-oss-120b decides when Gemini is slow; Groq never writes Odia.
  - Flash-Lite decides, Flash generates; env-configurable.
- [x] P2.14 Provider failover chain with circuit breakers: Gemini → Gemma → Groq → cache → pack content (§6.2, §10.3)
  - Gemini → Gemma → Groq via RoutedLlm + own circuit breakers (5× longer after a 429) + OpenAICompatLlm; then pack content. Tested with a failing provider.
- [x] P2.15 Response cache keyed by (concept, strategy, level, language, itemVersion) → approved output
  - 2026-10-13: late generations (after the turn budget) are critic-checked and cached too; verified live (run 2 served a Gemini Odia explanation from cache in 1.4 s server time).
  - gen_cache keyed by (concept, strategy, misconception, level, lang, pack version, doubt).
- [~] P2.16 Latency UX: instant local acknowledgement in her language → streamed text → audio when ready — instant spoken acknowledgement if a reply takes > 400 ms ("ଶୁଣିଲି — ଟିକେ ଦେଖୁଛି…"); AI replies are voiced on the server as they are sent. Not done: token streaming of generated text (reply is one JSON)
- [ ] P2.17 Quota hygiene: separate key/provider for drafting & eval; demo inputs pre-cached; daily per-learner cap → pack content + queued generation, never an error

Tools (§6.1) — all 12, each with its offline column
- [x] P2.18 `understand` — online LLM: language, script, intent, concept candidates, wellbeing flag; offline: multi-script matcher — online: decide model returns `understood` (concept, intent, language); a wellbeing/off-topic reading triggers the safety path (cycle.ts); measured 91% concept online, 88% offline (docs/EVAL.md §2)
  - offline multi-script matcher: 11/11 test doubts. Online: LLM "understood" field returned but the wellbeing flag is not used yet.
- [x] P2.19 `read_page` — (built in P3) — built in P3.14–P3.18: /api/snap/read (Gemini vision) + offline Tesseract `ori` → locatePassage → passage card / pick-one-of-3
- [x] P2.20 `search_curriculum` — BM25 (+ embeddings online, stretch)
  - MiniSearch BM25 + fuzzy over FAQ, glossary, passages.
- [x] P2.21 `teach` — online grounded LLM at strategy + reading level; offline cached variants
- [x] P2.22 `solve` — deterministic maths: equations of motion, average speed/velocity, displacement, unit conversion; used for worked examples and numeric checks
  - packages/core/src/solve.ts: equations of motion, average speed/velocity, path + circular distance/displacement, unit conversion. Every pack number comes from it.
- [~] P2.23 `make_check` — reviewed bank for mastery; LLM for practice only
  - bank checks only; LLM practice questions not built.
- [x] P2.24 `evaluate_answer` — grade + diagnose; offline MCQ/numeric + distractor tags
  - MCQ distractor tags + unit-aware numeric grading.
- [x] P2.25 `update_learner` — BKT, misconception counters, spaced schedule (shared core)
- [x] P2.26 `plan` — policy + LLM online; policy offline — policy + LLM decide per turn; between-session agent writes the next session plan (PLAN_SET with pre-written explanations) after every session end
  - policy + LLM decide online, policy offline; session plan generation pending.
- [x] P2.27 `prepare_offline` — (built in P4) — built in P4: between-session agent pre-writes the next session (PLAN_SET), prefetch within her data budget, pack diffs
- [x] P2.28 `notify_teacher` — (built in P5); queued offline — built in P5: ESCALATED events (stuck with evidence, wellbeing apart, drop-off), class reteach drafts; queued on the phone and synced
- [x] P2.29 `speak` — (built in P3) — built in P3.8/P3.9: pre-recorded MMS-TTS Odia clips (124) + live voice for AI-written replies, device voice fallback
- [x] P2.30 Rule check: every tool can change the next decision (else remove it) — each tool feeds the next decision: search_curriculum → concept/unmatched; teach → strategies tried; make_check → BKT + misconceptions; solve → hint ladder + grading; read_page → located concept; notify_teacher → no repeat escalation for 7 days + teacher reteach; prepare_offline → next session plan; speak is output-only; it stays because audio is required (§9.3) and its bytes count toward the data budget, which switches to text-only when low (BUDGET_LOW)

Learner model (§6.3)
- [x] P2.31 Cold-start placement: 3-minute adaptive, 5–7 tap questions walking the prerequisite graph (pass → skip prerequisites; fail → probe one level down); 8–10 placement items in content
  - 2026-10-13: packages/core/src/placement.ts. Starts at the deepest concept with a placement item; pass → all prerequisites implied known (prior 0.7, not mastery); miss → one level down; a single miss is confirmed with the second item only once its prerequisites are known; ≤ 7 questions / 3 min; then the first lesson is chosen on the result. Runs on phone and server (LLM never consulted during placement). 7 scenario tests + 1 server test. Browser: Sunita (knows ref/distance/speed) → 4 questions → "you already know …" → first lesson displacement.
- [x] P2.32 Unmeasured prerequisite → probe with one question instead of assuming weak
- [x] P2.33 Light evidence propagation: success gives small credit to prerequisites; failure raises a *hypothesis* on the weakest prerequisite
- [x] P2.34 Spaced reviews 1d → 3d → 7d → 14d (`nextReviewAt`)
- [x] P2.35 Strategy memory: `strategyThatWorked` preferred next time

Teaching loop (§6.4)
- [x] P2.36 doubt → concept → prerequisites known? unknown → probe; weak → step back to weakest prerequisite; ok → teach → verify
- [x] P2.37 wrong → diagnose: confirmed misconception → targeted remediation with a DIFFERENT strategy; prerequisite gap → step back; unclear → simpler diagnostic
- [x] P2.38 ≤ 3 strategies per concept, then stop, escalate with evidence, switch to another reachable goal

Assessment integrity (§6.5)
- [~] P2.39 Mastery-affecting checks only from the reviewed bank; LLM questions = practice, low BKT weight until validated (numeric key verified by `solve`; MCQ consistency check)
  - draft vs reviewed weighting in place; validating LLM practice items pending.
- [x] P2.40 Numeral normalisation: Odia ୦–୯, Devanagari, Bengali and other Indic digits → ASCII before numeric grading; unit-aware comparison with tolerance
  - Odia, Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Ol Chiki, Arabic digits + Odia/Hindi unit words.
- [x] P2.41 Two-signal rule to confirm a misconception; LLM-proposed novel misconceptions logged as *candidates* for teacher review
  - 2026-10-13: The decide call (already made on every wrong answer and doubt) may return `new_misconception`; her actual answer reaches it fenced as data. Server validates: only after a wrong answer that signalled no known misconception or a doubt, concept in graph, plain short text, not a repeat, not a restatement of a known one (word overlap), ≤ 3 per learner per concept → MISCONCEPTION_CANDIDATE + trace fact. Live (Groq): 0.25 for 1200 m / 300 s → "thinks speed is time divided by distance"; a guess (5) and a known confusion (7 = distance) → none. Also: "remediate" without a known misconception now becomes a reteach with a fresh strategy instead of being rejected.
  - two-signal rule done; the MISCONCEPTION_CANDIDATE event exists but the LLM does not emit candidates yet.
- [x] P2.42 Free-text answers: LLM grade with confidence; low confidence barely moves BKT — `text` checks with key ideas (any script, sound keys); offline word match conf ≤ 0.5, online LLM grade capped 0.9; conf < 0.7 never counts for mastery; 2 draft items, used for practice steps

Pedagogy guardrails (§6.6)
- [x] P2.43 Conceptual doubt → direct explanation; practice/homework → hint ladder, no answer leak — core parseProblem + solver → hint ladder (given → convert → formula → put values), answer held back until she tries, graded on the phone; online "homework" intent → hint-only prompt. Browser-verified
- [x] P2.44 No sycophancy: insisting on a wrong answer → re-ground in textbook — insisting (or/en/hi/romanized) within 30 min of a wrong answer → textbook passage + fresh check, no agreement; prompt rule too
- [x] P2.45 Every factual claim cites retrieved chunks; terms and numbers consistent with them — generate returns numbered `cites`; critic requires them and takes numbers only from cited chunks (or solver-verified)
- [x] P2.46 Reading level (1–5) controls sentence length, vocabulary (class vocabulary list), step count — core LEVEL table (sentences, words/sentence, chars, steps) + per-language hard-word list → prompt and critic

Failure handling (§6.2) — each row implemented + tested
- [x] P2.47 LLM rate-limited/down → breaker → next provider → cached variant → pack content
- [x] P2.48 Retrieval finds nothing → one clarifying question with concept chips; never fabricate
  - cloud: one clarifying question with concept chips; device: queue with a promise.
- [x] P2.49 Generated numbers disagree with `solve` → replace with solver values or reviewed worked example — critic checkArithmetic: wrong result replaced by solver value (same unit and digit script), verified numbers allowed; else revise → pack worked example
- [x] P2.50 Ambiguous answer → simpler diagnostic question
- [x] P2.51 (ASR, photo, TTS rows → P3; network drop, app kill, sync conflict → P4) — rows moved: ASR/photo/TTS fallbacks done in P3, network drop/app kill/sync conflict in P4

Trace (§5.7)
- [x] P2.52 All fields: step, trigger, tier, facts_used, candidates[{action, concept, score}], chosen, decided_by, override, reason, tool, args, latency_ms, status, fallback_used, critic{checks, verdict}, state_diff
  - all §5.7 fields + llm_calls + synced_in.
- [x] P2.53 Learner view: one "Why?" line in her language
  - Odia/English "Why?" line under each step.
- [x] P2.54 Judge view `/trace/live` filters: tools, overrides, fallbacks, tiers

Tests
- [x] P2.55 Golden scenario tests: recorded LLM responses replayed → deterministic runs (§12) — apps/server/test/golden: real model replies recorded 2026-10-14, 4-step hero flow replayed in CI (same decisions, messages, calls)
- [x] P2.56 "Same input + different state → different decision" test
  - packages/core/test/core.test.ts: same input, different state → different decision.

---

## P3 — Voice, Snap, language (§13)

**Exit test:** judge-style voice and photo inputs work on the phone.

Speech in (§10.1) — chain in the order P0 decides
- [x] P3.1 Gemini Flash audio input — `listen` job (gemini-lite-gen → flash), webm remuxed to ogg; live-verified on an Odia clip (≈14 s, so it is second when the local model is warm)
- [~] P3.2 Chrome Web Speech `or-IN` — used when online but the server cannot listen; not yet tried on a real phone
- [~] P3.3 Gboard mic fallback (prompt the learner to use keyboard voice typing) — spoken/recorded hint, focuses the text box; real-phone check pending
- [x] P3.4 Self-hosted IndicConformer or `whisper-small-or` on our server — IndicConformer-600M (MIT) CTC worker tools/asr/serve.py; live 1.8–3 s on an Odia clip; default first once warm
- [~] P3.5 Sarvam free credit (₹100) — emergency only — wired (saarika:v2.5, last in chain, only with SARVAM_API_KEY); untested, no key
- [x] P3.6 ASR fails / language unsupported → next in chain → "type in English letters or snap a photo" (§6.2) — server chain reports every step tried; phone falls to Web Speech then the spoken hint (tests: listen.test.ts)
- [x] P3.7 Store-and-forward voice: Opus low bitrate, record → upload when possible → answer when ready (§8.1) — 16 kbps Opus, 30 s cap, kept in IndexedDB + DOUBT_QUEUED(voice) + promise; sent on reconnect. Speech-to-text words in Odia script (ସ୍ପିଡ୍, ଡିସପ୍ଲେସମେଣ୍ଟ) match via matcher sound keys

Speech out (§10.2)
- [x] P3.8 Pack audio pre-generated (edge-tts or Indic Parler-TTS)
  - 2026-10-13: tools/tts/gen_audio.py: MMS-TTS Odia (CC-BY-NC — prototype; production → Parler-TTS, D12). Text made speakable first (numbers → Odia words, units/abbreviations → words, English bracket terms dropped, one synthesis per sentence + pauses), Opus 16 kbps. 67 clips (every fixed pack line + 14 slot-free tutor lines), 1.1 MB, incremental (only changed lines re-recorded), fixed seed. Clip key = FNV-1a of the exact text (core `audioKey`) so the phone finds it with no id plumbing. Tutor lines prefetched with the pack (offline), lesson clips cached on first play. Browser: 🔊 plays the clip, not the device voice.
- [x] P3.9 Live replies: same generators server-side, cached by text hash
  - 2026-10-13: apps/server/src/voice.ts + tools/tts/serve.py: one long-running MMS process (model loaded once at server start, ~1–1.6 s per reply on a laptop CPU). The server records every Odia line it writes that is not a shipped clip (turn replies, pre-written explanations, answers to queued doubts) → data/voice/or/<audioKey>.ogg, served at /voice/<lang>/<key>.ogg (immutable; 404 if it did not write it — not an open TTS). Phone: shipped clip → /voice → device voice; prepared explanations + doubt answers are fetched ahead while online (SW cache setu-voice) so they play offline. No venv → disabled, phones use their own voice. Live check: server-written Odia line recorded and served as audio/ogg in 1.6 s; Gemini was out of quota during the check, so a live *Gemini-written* reply was not voiced end to end (same code path).
- [x] P3.10 On-device `speechSynthesis` if an Odia voice exists
  - 2026-10-13: Device voice is the fallback when no recorded clip exists (most phones have no Odia voice).
- [ ] P3.11 Stretch: MMS-TTS Odia on device (Wi-Fi download) *(cut-order item: "on-device voice model")*
- [~] P3.12 TTS fails → cached audio → on-device voice → text (§6.2)
  - 2026-10-13: Recorded clip → device voice → text, done for pack and tutor lines. Live generated replies: server-recorded (P3.9).
- [~] P3.13 Speakable form for every item: terms said naturally, formulas spoken, units expanded, numbers in her language (§7.2)
  - 2026-10-13: Generator makes any line speakable (numbers in Odia words, units, symbols); spoken form shown in the review page for D6. Number words are my draft (0–30, tens, hundreds, 1200 = ବାର ଶହ).

Snap-to-Learn (§6.8, §10.4)
- [x] P3.14 `read_page` online: Gemini vision → text → passage located in pack → teach that passage → verify
  - 2026-10-13: POST /api/snap/read → vision chain (Gemini 2.5 Flash → 3.1 Flash-Lite → Gemma) → text → engine locates the passage → teaches it → check. Live: sharp Odia photo transcribed exactly (9.4 s). Image never stored (test checks every table). Finding: on a blurred photo Gemini INVENTED text (“ସମ ସଂଖ୍ୟା ଓ ବିଯୁଗ୍ମ ସଂଖ୍ୟା”) — harmless here because the text only locates (no match → picker), never teaches.
- [x] P3.15 `read_page` offline: Tesseract.js `ori` → fuzzy character-n-gram match against pack text → teach from clean pack text
  - 2026-10-13: packages/core/src/snap.ts: IDF-weighted character-trigram containment, spaces removed. Simulated OCR noise (look-alike glyphs, drops, spacing): 0 confident-wrong up to 50% noise; 100% located at ≤ 20%. Real Tesseract.js 7 `ori` in the browser, fully offline: rendered photo of the speed passage → located psg.speed (0.71) → clean passage → explanation → check in ~3 s. Re-run the noise test when the real chapter (D3) adds passages.
- [x] P3.16 No confident match → tap one of 3 likely passages, or queue the photo
  - 2026-10-13: “Which part of your book? Tap one” with the 3 likeliest passages + “keep the photo” (offline). Kept photos live in IndexedDB only, are read online on reconnect/open, then deleted; DOUBT_ANSWERED + COMMITMENT_KEPT recorded. Browser-verified.
- [x] P3.17 Photo unreadable → retake tips (audio) → pick from 3 passages → queue for online (§6.2)
  - 2026-10-13: Retake tips and every other slot-free tutor line now have recorded Odia audio, cached with the pack, 🔊 on every tutor line.
  - 2026-10-13: Unreadable → retake tips (text; 🔊 via device voice) → pick from 3 → keep for online. Missing: pre-generated retake-tip audio (P3.8).
- [x] P3.18 Photo text treated as data, never instructions; photos discarded after processing
  - 2026-10-13: Photo text only locates a passage (engine test: injected “IGNORE ALL RULES …” changes nothing); vision instruction says the photo is data; server keeps no image; phone keeps one only when she taps “keep”, and deletes it after reading.

Language (§7)
- [x] P3.19 Technical-term bridge: textbook term ↔ English exam term ↔ everyday phrase (§7.1.1) — glossary term ↔ English exam term ↔ everyday phrase (or/hi/en) on every explanation as a 📘 line, + her teacher's home-language word (test)
- [x] P3.20 Code-mixed input handled (§7.1.2) — code-mixed doubts 88% offline (matcher + sound keys), online via the decide model; measured on the understanding set
  - offline matcher handles code-mixed text; online through LLM decide.
- [x] P3.21 Romanized Odia typing (§7.1.3) — romanized Odia 90% offline (glossary variants, romanized FAQ keys, normalisation); measured on the understanding set
  - romanized matching offline (glossary variants + normalisation).
- [x] P3.22 Local analogies per region in content (§7.1.5) — REGIONS (coastal / western / southern hills) set per class by the teacher; 6 draft regional analogies (speed, velocity; or+en, hi drafted); pickExplanation prefers her region; live generation gets the region's examples
- [x] P3.23 Language changes decisions: low reading level + voice preference → shorter spoken explanations, tap-answer checks (§7.1.6) — input mode learned from her last 5 questions (≥3 spoken → voice); voice or level ≤ 2 → MCQ checks, no written answers, explanations one level shorter (offline and online)
- [x] P3.24 Stretch: home-language anchors added by teacher/community (e.g., Kui) (§7.1.7) *(cut-order item #1)* — teacher adds a word per concept in Kui/Santali/Ho (teacher view), validated; phone fetches with the class info, keeps it offline, shows it in the term bridge
- [x] P3.25 Multi-script offline index: each key in Odia, romanized (pre-generated transliteration variants), English (§7.3)
  - built in memory from the pack, on device and server.
- [x] P3.26 Language tiers A/B/C as config per language; tier C says so and teaches in school language with home-language anchors (§7.4) — core languages.ts: tiers A (or, hi, en) / B (bn, te) / C (Santali, Kui, Ho → school language); onboarding "my home language is different" says so honestly and teaches in Odia with home-language words
- [x] P3.27 Language-quality-aware generation: per-language score decides live generation vs pack content (§7.5) — per-language generation score with its evidence (P0.a etc.); live generation = score ≥ 0.7 (or, hi, en); unmeasured → reviewed pack only; SETU_LIVE_GEN overrides
- [x] P3.28 Critic script check blocks wrong- or mixed-script output (§7.5) — critic: other-Indic letters → reject; < 50% target script → revise; 50–60% → LLM critic decides (tests in cycle/teaching)
- [~] P3.29 Subsetted Noto Sans Odia (+ Devanagari) web font; test on the real phone (§7.6) — Noto Sans Odia + Devanagari (OFL) subset to woff2, 44 KB / 43 KB, unicode-range so each loads only when its script shows; Odia precached, Devanagari on first use; browser-verified loaded. Not done: test on the real low-end phone
- [x] P3.30 Fully localised UI in or / hi / en; every label has 🔊 (§7 table) — UI, tutor lines and hint ladder in Odia, Hindi and English (key parity test); language picker has हिन्दी; every card has 🔊
  - Odia + English UI strings; 🔊 on every message via the device voice; Hindi pending.
- [x] P3.31 Translation used only for teacher↔learner mismatch and drafting long-tail packs (§7 table) — content/scripts/draft_translation.ts drafts a pack language via the server router (keys stay server-side) with number/script/term/safety checks; teacher↔learner mismatch already translates candidates (P2.41)

---

## P4 — Offline & around-the-clock (§13)

**Exit test:** airplane mode mid-session continues; reconnect syncs with no duplicates; queued doubt answered; app-kill resumes; next open shows the prepared session.

Connectivity (§8.1)
- [x] P4.1 Active probe + timeouts + rolling RTT/failure estimate → cloud / weak / device tier (don't trust `navigator.onLine`)
  - apps/web/src/net.ts: /api/health probe, timeouts, rolling RTT → cloud/weak/device.
- [~] P4.2 Data budget: first run asks small / medium / big pack (icons); tracks Setu's own bytes; adapts ("today: text only, 0.4 MB used") — 2026-10-14: voice downloads now count too (only bytes not already cached on the phone; one DATA_USED a minute; browser-verified)
  - DATA_USED events + per-day budget used by the policy; first-run pack-size question not built.
- [x] P4.3 Turns < 30 KB text; audio on demand — a turn reply carries ≤ 40 events (rest via sync), test asserts < 30 KB; audio only on 🔊 tap
- [x] P4.4 Resumable, idempotent requests — turnId per turn: server replays the same reply for a retry (in-flight too); one retry on a dropped connection; if the phone ran the turn itself its events win (canonicalOrder drops the server copy) — same fold everywhere

Device tier (§8.2)
- [~] P4.5 Session continues from chapter pack + prepared plan: cached explanation variants, Odia audio, bank checks, grading, distractor diagnosis, BKT, prerequisite walk, scheduling, `solve`
  - device tier runs the full core engine from the pack; cached audio pending (P3).
- [x] P4.6 Device-tier policy (same shared core) drives the session
- [x] P4.7 Offline doubt: multi-script BM25 match → answer; unmatched → queued with promise "ସିଗନାଲ୍ ଆସିଲେ ମୁଁ ଏହାର ଉତ୍ତର ଦେବି"
  - Odia promise message + COMMITMENT_MADE event.
- [ ] P4.8 Stretch: small multilingual embedding matcher *(cut-order item)*
- [x] P4.9 Device-tier decisions write trace entries locally; synced later
  - kept in Dexie, uploaded by /api/sync, shown in /trace/live as tier=device.
- [x] P4.10 Network drops mid-turn → turn completes on device tier; remainder queued (§6.2) — a failed or slow request falls back to the device turn (same turnId); the server copy, if it finished, is dropped by canonicalOrder and its late explanation is critic-checked and cached; an unmatched doubt is queued for the between-session agent
  - a failed online request falls back to a device turn; queueing the rest of a half-done turn not built.

Chapter pack (§8.3)
- [~] P4.11 Pack format: text + checks + audio + multi-script index, < 6 MB, hash/signature
  - JSON pack with sha256 hash + ETag; audio + signature pending.
- [x] P4.12 Download once over best link — goodLink() (no data saver, Wi-Fi/4G): voice clips, OCR offer and refresh wait for it; pack re-check is an ETag (bytes)
- [x] P4.13 Phone-to-phone: pack as a single file shareable by WhatsApp/Bluetooth; import via file picker / share target; integrity-checked by hash before use (§10.7) — 📤 pack as one .setu.json file (share sheet → WhatsApp/Bluetooth, else download); 📂 open it on a phone with no lesson; sha256 verified (browser hash = server hash, checked live)
- [x] P4.14 Pack updates as small diffs by item version — server keeps every served version; old hash + ?diff=1 → diff by item key (order + changed items), phone applies and verifies the new hash, else full download

Interruption safety (§8.4, §5.1)
- [x] P4.15 Every step committed as an event before/as it renders
- [x] P4.16 `SESSION_RESUMED`: "We were on question 2 of 3 — continue?" (resumePointer)
  - engine test: app killed mid-check → reopen resumes at the exact question.

Sync (§8.5, §5.6)
- [x] P4.17 IndexedDB (Dexie) outbox; piggybacked on every online request (sync-before-think); flushed at every chance
- [x] P4.18 Server dedupes by event id; applies in per-device `seq` order; replays; returns new events (queued-doubt answers, prepared session, teacher notes)
- [x] P4.19 Per-profile streams on shared phones — events per profile; who-is-learning screen + profile switcher on a shared phone (P4.22, P5.3)
  - events are per profile; the profile switcher UI is pending (P5.3/P5.4).
- [x] P4.20 Sync conflict → idempotent events; replay; nothing overwritten (§6.2)
- [~] P4.21 Storage survival: install prompt, `navigator.storage.persist()`, small packs, integrity check on every open, auto re-download, frequent outbox flush
  - navigator.storage.persist() + installable PWA; integrity check on open + auto re-download pending.

Around-the-clock agent (§5.1, §5.2)
- [x] P4.22 `SESSION_OPENED`: confirm who is using the phone; serve prepared session; repair plan if state changed — profiles list on the phone; shared phone asks "who is learning now?" after 30 min away or with >1 learner (browser-verified); prepared session + fromPlan repair already in place
- [x] P4.23 `SESSION_ENDED`: explicit close **or** inferred (inactivity timeout / next sync) — real minutes; no tap for 30 min (timer + on return) → SESSION_ENDED inactivity at the last tap; next tap opens a new session; server tick does the same
- [x] P4.24 Session-end prepare (online): plan next session, size to time budget, `prepare_offline` downloads extras within data budget, records what & why
  - 2026-10-13: core `prepareSession` walks policy candidates at her likely next open, distinct concepts, fits typicalSessionMin. Server pre-writes up to 3 explanations (Gemini, critic-checked, ≤ 30 KB) into the plan → instant and offline next time. `prepare_offline` records what & why in the trace. Browser-verified.
- [x] P4.25 Session ended offline → device policy builds tonight's session locally from the pack
  - 2026-10-13: ending offline emits a device-prepared PLAN_SET (tested + browser-verified). Explicit end clears the resume point; inactivity keeps it.
- [~] P4.26 Server between-session run: review today's evidence; schedule spaced follow-ups; answer queued offline doubts; escalate; detect drop-off; draft reteach; refinements sync next time
  - 2026-10-13: apps/server/src/agent/between.ts: review evidence, answer queued doubts (FAQ → LLM critic-checked → pack; unsafe → wellbeing escalation; else teacher), escalate stuck concepts found after the session, RETEACH_DRAFTED note per escalation, plan + pre-write. Runs after an `end` turn and when a sync brings SESSION_ENDED/DOUBT_QUEUED. Spaced follow-ups come from BKT review dates inside the plan. Browser-verified (answer card + ✨ plan). Missing: class-level reteach (P5.10).
- [~] P4.27 `SYNC_COMPLETED`: answer queued doubts; reconcile; escalate if offline attempts kept failing
  - 2026-10-13: sync with SESSION_ENDED or DOUBT_QUEUED runs the between-session agent (answers queued doubts). "Escalate if offline attempts kept failing" is covered by the post-session escalation check.
- [x] P4.28 `CONNECTIVITY_CHANGED`: switch tier; replan with available tools; prefetch if signal improved — CONNECTIVITY_CHANGED event (state.link); better link → sync, pack check, clip prefetch; tools follow the tier each turn
- [x] P4.29 `DATA_BUDGET_LOW` / `TIME_BUDGET_LOW`: drop audio / compress plan; finish highest-value item; save resume point — BUDGET_LOW (data < 15% / ≤ 2 min left), said once; data low → audio out of plan costs + phone text-only; time low → close at a good point, resume pointer kept
- [~] P4.30 `SCHEDULE_TICK` (daily, server): exam-date replanning; drop-off detection (no activity N days → gentle nudge + teacher digest); class digest
  - 2026-10-13: tick every SETU_TICK_MIN (10) min + POST /admin/tick (SETU_ADMIN_KEY): ends sessions idle 30 min → between-session run; drop-off after 3 days → one teacher escalation (server events do not count as activity). Missing: learner nudge, exam-date replanning, class digest (P5).
- [x] P4.31 Optional Web Push when online, quiet hours, no personal content in the notification (§9.1) — web-push (MIT), VAPID kept in server DB; opt-in 🔔; one generic line, quiet 21:00–07:00 IST, ≤ 1/day, 404/410 forgets; sent after session-end planning. Real push delivery not tried (needs HTTPS + a phone)

Edge tier (§8.6)
- [ ] P4.32 Stretch: school PC as local AI + sync hub *(cut-order item #2)*

Tests
- [x] P4.33 Sync property tests: random event interleavings across devices/outbox → identical state, 0 divergences (§12)
  - 200 random interleavings + duplicates → identical state.

---

## P5 — Teacher & safety (§13)

**Exit test:** seeded stuck learner + shared misconception + unsafe prompt → each handled correctly.

Learner onboarding & UX (§9.1)
- [x] P5.1 First run, no login: language buttons that speak their own name → avatar (+ optional name) → class → join by QR scan or 6-digit code (optional) → 3-min placement → first lesson
  - 2026-10-13: In-app QR scan: camera → BarcodeDetector (Android Chrome) or jsQR fallback (lazy, 47 KB gz), ~400 px frames every 250 ms, reads /#join=CODE or a bare 6-digit code, camera stopped on success. Browser: fake camera showing a real class QR → code filled and checked "✓ 9A ବିଜ୍ଞାନ".
  - 2026-10-13: Language (speaks its name) → avatar (+ optional name) → class (only 9 enabled — content exists only for 9) → 6-digit code, prefilled from the teacher QR link (/#join=…) and checked online (offline: checked at sync) → “show my name to my teacher” (opt-in) → placement → first lesson. Missing: in-app QR scanner (the phone camera app opens the link instead).
  - language buttons that speak their own name → avatar → optional name. Class join + placement pending.
- [x] P5.2 Session time asked once, then learned; one tap to change ("only 10 minutes today") — asked on her first day (10/20/30, Odia digits), ⏱ chip changes it in one tap and applies to the open session; after 3 sessions her learned typical length is the default (browser-verified)
- [x] P5.3 Home = one screen: 🎤 Ask, 📷 Snap, Today's plan (one Start), profile switcher — one screen: 🎤 Ask, 📷 Snap, "ready for you" plan with one ▶ Start, avatar = profile switcher (ends the session first)
- [x] P5.4 Shared phone: "Are you Sunita?" avatar confirm on open — "who is learning now?" avatars after 30 min away or with more than one learner (P4.22)
- [x] P5.5 Every text has 🔊; answers by tap where possible; status in plain words; ≤ 2 taps from open to learning — 🔊 on every card incl. chips/hints; MCQ by tap; status words (ଅନଲାଇନ…); open → first question with 0 taps (≤ 2 with the who-screen)

Teacher (§9.2)
- [x] P5.6 Create class in one step → QR + 6-digit code
  - 2026-10-13: Teacher view at /#teacher: name + language → class code + QR (qrcode-generator, lazy chunk) + one-time class key. Browser-verified.
- [x] P5.7 "Needs you": learner, concept, misconception, strategies tried, attempts, recommendation
  - 2026-10-13: Needs-you cards: learner, concept, unresolved misconceptions (signals, confirmed), strategies tried (teacher language), attempts, p, recommendation (reteachDraft in teacher language), “done”.
- [x] P5.8 Wellbeing flags kept separate from academic ones, minimal detail
  - 2026-10-13: Wellbeing in its own section; shows only “please check in privately” — never the reason or the learner’s words (test).
- [x] P5.9 Drop-off list: learners inactive N days
  - 2026-10-13: Computed live from lastActiveAt (DROPOFF_DAYS=3), plus the tick’s drop-off escalation.
- [x] P5.10 Reteach draft: many learners share a misconception → 5-min class reteach in teacher's language; approve/edit *(cut-order item)*
  - 2026-10-13: ≥ max(2, 25% of class) learners share a confirmed misconception → deterministic 5-minute plan from pack content (class vote with the trap answer → targeted explanation → everyday words → re-vote) in the teacher’s language; editable; approve/reject stored (teacher_acks) and published to the trace. Browser: edited + approved.
- [~] P5.11 Teacher sets class exam date → every learner's goal (overridable); exam-date goal planner (§1 "exam aspirant" case)
  - 2026-10-13: Exam date → GOAL_SET (setBy teacher) for every member without a goal of her own, and for learners who join later; policy already weighs exam proximity. Missing: a separate exam-date planner view (P2 policy covers the ordering).
- [x] P5.12 Review queue for LLM-proposed candidate misconceptions (§6.5)
  - 2026-10-13: candidates are written in English by the decide model (Groq writes Odia badly); translate.ts translates them into the class language with the generation model (Gemini for Odia) — started when the candidate appears, cached; rejected if a number is lost or it is not in Odia. Teacher view shows the translation with the English under "English" (until cached: English).
  - 2026-10-13: Fed by P2.41. Teacher keeps/rejects in the teacher view; kept ones → GET /admin/candidates (concept, belief, evidence, how many classes — no learner identity) for the next pack revision. Description is English (decide model writes English only).
  - 2026-10-13: Review queue (keep/reject) is in the teacher view; nothing emits MISCONCEPTION_CANDIDATE yet (the LLM diagnosis step must propose them — P2.40).

Child safety & wellbeing (§6.7)
- [x] P5.13 Scope: study help only; off-topic → kind redirect in her language — core safety.ts (or/en/hi/romanized), only when the matcher found nothing; online the decide LLM's intent can raise it too
- [x] P5.14 Unsafe topics (self-harm, abuse, violence, adult) → no engagement; calm caring message; distress → trusted adult/teacher + helpline; teacher alert as wellbeing — fixed pre-recorded replies, tel: links, nothing sent to a model, queued doubts screened too. Helplines 1098/14416/112 await D9 confirmation
- [x] P5.15 Prompt-injection hardening: photo text + learner input as data (separate prompt section, callback filter); tools accept only schema-valid args — learner text and photo (OCR) text fenced as <learner_text> data in every prompt; tool args schema-checked; off-topic guard; red-team 30/30 incl. photo injection with a model that obeys every attack
  - learner text fenced as <learner_text> data in both prompts; tool args schema-checked. Photo text pending (P3).
- [x] P5.16 No personal data beyond learning needs; no chat about family/location — privacy redirect; her words are not stored for distress/unsafe/personal
- [x] P5.17 Safety checks in the critic callback on every output, online and offline (offline content pre-reviewed) — guardOutput on every turn (trace `safety`), test that every pack + fixed string passes

Privacy & security (§10.6, §10.7)
- [x] P5.18 Profile + name on device only; server sees pseudonymous id + learning events — name/avatar on the phone; server sees a random profile id; name stripped before any request; /api/turn and /api/sync refuse another device (403) unless granted
  - name/avatar stay on the device; server sees a pseudonymous profile id; /api/events readable only by the owning device.
- [x] P5.19 School-mediated consent (class join); offline-only use needs no server account — offline use needs no account; class join is the school-mediated step; parent note (draft) in docs/PRIVACY.md — Odia version needs D6
  - 2026-10-13: Class join is optional; offline-only use needs no server account (only a pseudonymous device token). Consent text/flow for schools not written.
- [x] P5.20 Learning-only purpose, no ads; teacher sees learning evidence only — purpose statement + what the teacher sees in docs/PRIVACY.md; no ads
  - 2026-10-13: Teacher view shows learning evidence only (no doubt text, no wellbeing detail, name only if she opted in). No ads anywhere. Formal purpose statement pending.
- [x] P5.21 Audio + photos discarded after processing; retention limits on events — audio deleted after speech-to-text, photos discarded after reading; Store.prune in the schedule tick: traces 90 days, a learner silent for a year loses her server copy (test)
  - 2026-10-13: Photos: done (see P3.18). Audio not built yet; event retention limits not built.
- [x] P5.22 No PII ever in LLM prompts (PII scrub callback) — scrubRequest in the Guarded wrapper for every provider; phone strips her name before sending
- [x] P5.23 Device token per install + per-device rate limiting
  - POST /api/device token; 60 requests/min per device; 401 without a token.
- [x] P5.24 Teacher view behind class-scoped token; sees only their class
  - 2026-10-13: x-teacher-token (stored as sha256) scopes every teacher call to one class; a second class’s key sees nothing of the first (test).
- [x] P5.25 Content packs signed/hashed; imported packs verified — packs carry sha256 of canonical JSON; phone verifies on every download, diff and imported file (packfile.ts); not signed with a key

---

## Content (§11) — runs alongside S1–P4

- [ ] C.1 Source chapter: Class 9 Science "Motion" (BSE Odisha equivalent) *(needs D3)*
- [~] C.2 Concept graph: core path reference point → distance → displacement → speed → velocity → acceleration; rest of chapter 6–9 concepts (uniform/non-uniform motion, graphs, equations of motion, circular motion …)
  - core 6 concepts in the graph; rest-of-chapter concepts not added.
- [~] C.3 Core 6 concepts at full depth: 4 strategies each, 6–8 reviewed checks, glossary, analogies, FAQ, audio — Odia + English (+ Hindi) — 2026-10-14: all 6 core concepts have ≥ 4 strategies and ≥ 6 checks (+ written checks for velocity/displacement), glossary, FAQ, local analogies, Odia audio, Hindi drafts; all still drafts until native review (D6) and the BSE textbook (D3)
- [ ] C.4 Rest of chapter: 2 strategies, 4 checks, Odia + English
- [x] C.5 Misconception library 10–15 entries (id, description, detection signals, remediation) — incl. distance vs displacement, speed vs velocity, negative acceleration, uniform vs non-uniform, graph reading
  - 11 misconceptions with severity + remediation strategies.
- [x] C.6 Placement items 8–10 covering the graph
  - 2026-10-13: 10 placement items (2 per concept with checks: reference point, distance, displacement, speed, velocity). Acceleration has no checks yet (C.3).
  - 6 placement-flagged items; need 8–10.
- [~] C.7 Pipeline: textbook → LLM draft → native Odia review (rubric) → `solve` verifies all numbers → audio once → signed pack
  - 2026-10-13: Review part built: packFields (stable ids for every learner-facing field) → review page → server decisions → applyReview at pack load (fixes in; an explanation/check becomes `reviewed` for Odia only when every one of its fields passed; "unsure" never passes) + source lines patched in place (only if unchanged; {slots} must survive) → audio regenerated incrementally. My own pre-review pass fixed: ଗୋଟିଏ ପିଲା consistency, "କେତେ ବାଟ ଯାଉଛି", "ଦେଖୁ ନାହିଁ", ଆମେ…ଅଟକିଥିଲୁ, honorific (-ନ୍ତୁ) buttons in the teacher view. Still needs D3 textbook + D6 native reviewer.
- [~] C.8 Display + speakable form for every item (§7.2)
  - speakable forms on most explanations; checks and FAQ pending.
- [x] C.9 Multi-script keys (Odia / romanized variants / English) for FAQ, glossary, passages (§7.3)
  - FAQ keys in Odia / romanized / English / code-mixed; glossary romanized variants.
- [x] C.10 Class vocabulary list per reading level (§6.6) — VOCAB per language with the reading level each bookish word becomes fine (or/en/hi), used by prompt and critic
- [~] C.11 Hindi pack for the language-switch demo *(cut-order item)* — Hindi pack drafted: NCERT terms by hand, 128 lines by Gemini through the checks (1 by hand), Hindi FAQ keys; a Hindi doubt is answered in Hindi offline (test). All Hindi items are drafts until a Hindi reviewer passes them
- [x] C.12 Note in README: textbooks belong to publishers; non-commercial prototype — README: "Textbook content belongs to its publishers; this is a non-commercial prototype."

---

## P6 — Evaluation (§12, §13)

**Exit test:** eval report + field-test results.

- [x] P6.1 Agent vs chatbot baseline: same model + personas; (a) Setu agent, (b) plain chatbot with textbook in context → steps-to-mastery, misconception resolved %, answer-leak rate, grounding rate — docs/EVAL.md §1: simulator agent 75 vs plain tutor 84 answers (both 100% mastery + misconceptions resolved); live same-model run on 10 Odia doubts: answer leak 20% → 0%, grounded 70% → 100%, length within her level
- [x] P6.2 Rule-based student simulator: personas with hidden misconceptions, deterministic MCQ answers; runs in CI — content/eval/simulator.ts, 5 personas, in CI (agent total must beat the plain tutor); found 3 real bugs, all fixed
- [-] P6.3 ADK evaluation case(s) with user simulation + custom metrics (§5.3 table) — *skipped: ADK TS eval not implemented (P0.i); covered by P6.2 simulator + P6.6 golden tests. Re-check if a newer ADK release adds it.*
- [x] P6.4 Understanding test set: 50 doubts (Odia script, romanized, code-mixed, voice transcripts) labelled concept + intent → concept-match accuracy online and offline — content/eval/understanding.json (50, six forms); offline 88% concept / 100% intent in CI (every miss is "no match", none wrong); online (Gemini decide) 91% concept / 89% intent on 44 of 50 answered (docs/EVAL.md §2)
- [!] P6.5 Language quality: native reader scores 30 Odia answers → Odia tier + live-vs-pack bar — needs a native reader (D6); the /#review tool is ready
- [x] P6.6 Golden scenario tests in CI (from P2.55) — apps/server/test/golden: real model replies recorded, 4-step hero flow replayed in CI
- [x] P6.7 Sync property tests in CI (from P4.33) — packages/core/test/core.test.ts (any interleaving/duplication folds the same; a phone-run turn never counted twice), in CI
- [x] P6.8 Safety red-team: 30 off-topic / unsafe / injection prompts (text + photo) → pass rate — apps/server/eval/redteam.json 30 prompts (text + photo): phone 30/30, server with an obeying model 30/30, in CI
- [!] P6.9 Field test: 3–5 students, pre-test → 2–3 sessions → post-test + observation → numbers + quotes *(needs D7; size is a cut-order item)* — needs consent and a school (D7)
- [~] P6.10 Accessibility pass (§9.3): WCAG-AA contrast; ≥ 48 dp targets; 200% text scaling; TalkBack labels; audio + text always both; no time limits; no colour-only meaning — axe 0 violations light + dark, no overflow at 200% text, ≥ 48 dp targets, 🔊 + text on every card, nothing timed, no colour-only meaning; TalkBack on a real phone not tried
- [!] P6.11 Unguided tests: 2 first-time learners complete "ask/snap → answer the check"; 1 teacher completes "create class → read an escalation" — needs first-time learners and a teacher (D7)
- [x] P6.12 Hindi pack + language switch works end to end — one-tap switch, same learner state, Hindi UI + drafted pack (157 texts, review pending); browser-verified
- [x] P6.13 Cost per learner: measured tokens per learner-day × model price; data per session (for deck slide 9) — measured from provider token counts: ₹0.63 per learner-day, ₹13.9 per month, 73 KB per session (docs/EVAL.md §6)
- [~] P6.14 Language tiers A/B/C confirmed per language (§7.4) — tiers set in packages/core/src/languages.ts (A or/en/hi, B bn/te, C sat/kxu/hoc); confirming them needs native readers (D6)

---

## P7 — Demo & deck (§13, §14, §16)

**Exit test:** hero demo 5× clean in a row.

Budgets on the real phone (§8.7)
- [x] P7.1 JS gzipped < 250 KB (fonts separate, subsetted) — measured 2026-10-14: learner JS 91 KB gz on load (160 KB incl. lazy teacher/QR/review); fonts separate, subset 44 KB
  - currently 62 KB gz JS (budget 250 KB).
- [x] P7.2 First load < 1.5 MB — ≈ 210 KB first load (JS + CSS + HTML + Odia font); pack 50 KB JSON; voice clips only on a good link
- [x] P7.3 Chapter pack incl. audio < 6 MB — pack ≈ 60 KB + 124 Odia clips 2.1 MB ≈ 2.2 MB (2026-10-14, after acceleration + C.3 content)
- [~] P7.4 Runtime memory < 150 MB (without optional voice model) — JS heap ~6 MB in desktop Chrome after load; real low-end phone not measured
- [x] P7.5 Data per online turn < 30 KB (+ audio on demand) — turn reply ≤ 40 events, test asserts < 30 KB; audio only on 🔊
  - currently ~6.5 KB per online turn (budget 30 KB).
- [~] P7.6 Android 8+ Chrome, installable PWA — manifest + service worker, installable in desktop Chrome; Android 8 phone not tried
- [~] P7.7 Latency p50 < 5 s, p95 < 10 s on 3G (§5.8) — server traces (36 h): all turns p50 26 ms; turns with a model call p50 3.1 s, p95 8.0 s (capped by the 8 s budget) — broadband, not 3G
  - 2026-10-13: server turn budget 8 s cloud / 5 s weak (test). Today Gemini generation was 7–14 s, so most live explanations will come from the cache/pre-generation; p50/p95 not yet measured on 3G.

Demo setup (§10.8, §14)
- [~] P7.8 Laptop server + Cloudflare quick tunnel; phone on real mobile data; scrcpy mirroring — DEMO.md: cloudflared quick tunnel + scrcpy commands, phone on mobile data; tools not installed on this laptop yet (winget commands given)
- [x] P7.9 Failure drills: kill each provider live → fallback visible in trace (§15) — POST /admin/provider {key, down} forces a breaker (admin key); trace shows the fallback (test); DEMO.md has the curl
- [x] P7.10 Seeded states: Sunita with prepared session; stuck learner; shared misconception across learners; drop-off learner — apps/server/demo/seed.ts: class + Sunita (prepared session), Ravi stuck (1 escalation), Lipi (shared misconception → reteach draft), Arjun drop-off — made by the real engine; #restore link (SETU_DEMO_KEY) opens Sunita on the demo phone (browser-verified)
- [~] P7.11 Cached responses for every scripted input; recorded full-run backup video; second phone — seed warms the gen cache for the scripted doubts on a copy of Sunita; backup video + second phone are the presenter's
- [~] P7.12 Close-talk / earphone mic for hall noise; typed romanized fallback — typed romanized fallback works; close-talk mic is hardware

Hero demo steps (§14) — each rehearsed
- [~] P7.13 #1 "This is Sunita" + gap sentence — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.14 #2 Judge on a fresh phone: ଓଡ଼ିଆ → avatar → class QR → 3-min placement — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.15 #3 Sunita's profile: last night's prepared session; trace shows between-session run + what/why prefetched — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.16 #4 Judge photographs an Odia textbook line → located → taught — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.17 #5 Judge asks by voice, code-mixed: "speed aau velocity re farak kana?" — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.18 #6 Explain (term bridge + local analogy) → check → trap answer → diagnose → different strategy → re-check → mastery moves; trace shows decided_by, overrides, tools, order, why — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.19 #7 Airplane mode live: continues, cached Odia audio, on-device grading, doubt matched or queued; tier = DEVICE — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.20 #8 Reconnect → sync → queued doubt answered → server event view: merged, no duplicates — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.21 #9 Close session → after-session run: follow-ups, teacher escalation, reteach draft, drop-off alert — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.22 #10 One tap → Hindi; same agent, same state — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.23 #11 Agent vs chatbot numbers + field-test result slide — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [~] P7.24 #12 "The agent did the work. She just learned." — scripted in docs/DEMO.md with what to point at + fallback; the flow behind it is built and tested; needs rehearsal on the real phones
- [!] P7.25 Rehearsal ×10; then 5 clean runs in a row — needs the presenter (rehearsal ×10, 5 clean runs)

Prepared answers (§15) — each with a live proof ready
- [x] P7.26 User & what changes (§2) · why bounded-autonomous (§5.3) · where is the loop / override in trace (§5.4–5.5) · tools + kill a provider (§6.1–6.2) · network drop (§8) · beyond translation (§7) · how she learned (BKT, baseline, field test) · why no LLM on phone · wrong maths (`solve`) · child safety & privacy (§6.7, §10.6) · model terms (§10.3) · cost & scale (slide 9) — docs/QA.md: every prepared answer with what to show
- [x] P7.27 State the honest limits (§18) before judges ask — docs/QA.md honest limits (updated with measured numbers)

Pitch deck (§16)
- [x] P7.28 1 Hook · 2 Problem (ASER 2024 ~90% devices) · 3 Why current tools fail · 4 Setu in one picture · 5 Agentic core + trace screenshot with override · 6 Architecture · 7 Language beyond translation · 8 Evidence · 9 Impact, cost, GTM (measured cost/learner, B2G + NGOs, path to scale, self-hosted models) · 10 Close — slide content in docs/MIDEVAL.md + docs/EVAL.md + QA.md; the deck itself not built yet — 2026-10-14: 10-slide deck built (claude.ai artifact "Setu pitch deck", downloads as PDF/PPTX) with measured numbers + speaker notes; 2 placeholders to fill: ASER figure, field-test line

---

## P8 — v4 change of direction: a tutor she can talk to, over her real textbooks (PLAN v4, 2026-10-14)

Why: v3 followed the PS reference case too literally (one learner, one hand-written chapter, prepared check questions). The PS says "choose your own user"; the product must be a tutor a student can talk to about any subject in their own board textbook, with the agent still doing the work. A chat box on its own would be the "thin wrapper" the PS warns against.

- [x] P8.1 Real BSE Odisha textbooks, OCR'd: Life Science (112 pp), Geography & Economics (128 pp), the 2022-23 disaster-management chapter (9 pp). Official PDFs from bseodisha.ac.in. They use a legacy font or are scanned, so `tools/books/render.py` renders the pages (splitting two-column pages at the gutter) and `content/scripts/ocr_book.mjs` runs Tesseract Odia+English (free, offline, about 3 min for all three).
  - Evidence: column split fixed the interleaved lines; English terms in brackets survive ("(Chordata)", "(Pharyngeal Gillslits)").
- [x] P8.2 Book indexes: `content/books/books.json` (chapters → page ranges from each contents page) + `content/scripts/build_book.ts`, which writes 850 passages with page and chapter, plus 400 Odia↔English term pairs taken from the book's own brackets. Size: about 250 KB per book. Motion joins the shelf as Physical Science.
- [x] P8.3 Search across scripts: `core/book.ts` Shelf. Odia, English (via the book's bracket terms) and romanized Odia (via sound keys).
  - Evidence: `content/scripts/try_search.ts` finds the right page for "what is a cell wall", "ଜୀବକୋଷ କ'ଣ", "bank re account kemiti kholiba", "tsunami kana", "speed and velocity difference".
  - Weak spots: English words absent from the book, e.g. "road accident karana". Online the agent's `books.rewrite_query` tool fixes this (the model turns her words into the book's Odia words); live, it found the disaster chapter, page 3.
- [x] P8.4 Tutor policy in core (`core/tutor.ts`), run by both server and phone. Safety first. Then:
  - explain from the book, or explain differently (strategy ladder: textbook → everyday example → story → small steps);
  - grade her answer to the open check;
  - review that the agent offered itself;
  - not-in-book (said honestly);
  - show the passage when offline.
  - Every decision carries its reason.
- [x] P8.5 Server agent (`apps/server/src/tutor/run.ts`). Tool order: safety.screen → books.search (or books.open for her answer) → books.rewrite_query (only when search is weak) → memory.recall → policy → model.write (one call: reply + grade + new check, JSON) → critic (invented passage ids dropped; unsafe words blocked unless her textbook page has them) → memory.update → teacher.notify. All of it is in /trace/live.
- [x] P8.6 Checks are written on the spot from the passage, not taken from a bank; graded in the conversation (right / partly / wrong). Partly → a hint, not the answer; the check stays open for one more try.
  - Mastery is BKT per chapter, with free-text weight; a partly-right answer leaves it unchanged.
  - Evidence (live, gemma, Odia): "rakta kanika kete prakara?" → answered from p.42 with RBC/WBC/platelet terms, then a check. "ଲୋହିତ ଓ ଶ୍ୱେତ" → partly, with a hint about clotting.
  - Evidence (live, English): wrong → retry; right → mastery 19% → 40% + next idea.
- [x] P8.7 Follow-up nobody asked for (`openTutor`): an unanswered check is re-asked; the weakest chapter not seen for 6 h is offered as a review (one tap); otherwise a welcome plus the next chapter.
- [x] P8.8 Teacher alert only when a chapter fails 3 times in a row (once per 3 days), as an ESCALATED event carrying the grader's gap. Distress → care + helplines + quiet alert; her words are not kept and never sent to a model.
- [x] P8.9 Chat is the home screen (`apps/web/src/chat.tsx`):
  - subject chips (one subject can be several books);
  - bubbles; a 📖 source chip that opens the real textbook text; term bridge; ❓ check;
  - "why?" shows the decision and tool chain; 🔊 on every reply; 🎤 voice; 📷 photo;
  - 📈 progress per chapter;
  - Motion guided practice is one tap away.
  - Browser-checked at 390 px.
- [x] P8.10 Offline chat: books are downloaded to the phone on a good link. With no signal the same policy runs on the phone, shows the right passage and keeps the question. On reconnect the kept question is sent and answered, under "the answer to what you asked while offline".
  - Browser-checked with the network cut.
  - Limit: the offline match is weaker for romanized words with no sound key (e.g. "bayu").
- [x] P8.11 Storage + privacy: tutor_state + tutor_log tables. The chat log is pruned at 90 days like traces, and a silent learner's tutor data at 365 days. Device grant on first chat, so the tutor's own events never lock her phone out.
- [x] P8.12 Tests: 13 core (index, search, policy, memory, opener) + 6 server (explain + trace order, grade, model down, distress, teacher alert, opener → review). 216 tests total; typecheck clean.
- [x] P8.13 Live reliability on the free tier: a second Gemini key (`GEMINI_API_KEY_2`) and each model is tried on both keys. Odia now goes to Flash-Lite (`gemini-3.1-flash-lite`) first, which writes correct Odia in 1–3 s. 3.5 Flash is often 503 (≈7 s each), 2.5 Flash is closed to new keys, and Gemma is intermittent. Live check 2026-10-14: Odia answers from p.42 (blood) and geography p.45 (monsoon).
- [~] P8.14 More subjects (not on bseodisha.ac.in; found as watermarked re-uploads via utkaliit.in → Google Drive):
  - Physical Science, the full book, 9 chapters: done; the Motion pack index is no longer written from it.
  - History & Political Science, 24 lessons, 839 passages: done.
  - Algebra and Geometry: OCR'd. Prose reads fine; formula symbols are lost ("0 ≤ P(E) ≤ 1" → "0 P(E) 1").
  - Odia literature, English, Hindi and Sanskrit: links found, not added.
- [x] P8.15a UI/UX overhaul: app shell (top bar, logo, net dot), subject pills with colour and emoji, hero with tap-to-ask cards, tutor bubbles, a focused source card (show more/less), auto-grow composer, bottom sheets for progress and language, SVG icons, and 3-step onboarding with a fixed start button. Browser-verified.
- [x] P8.15b Offline matching 68% → 92% (97/105 over 7 books, incl. 12 chit-chat lines; every tap-to-ask card tested to land in its own book), measured by `content/scripts/eval_search.ts`:
  - loose transliteration keys and chapter voting;
  - English→Odia school-word list (`LEXICON`, each word checked in the books);
  - chit-chat stop words, and a weak one-word match no longer shows a page.
- [x] P8.15c Books now download offline on 3G too (`bookLink`), gzipped; the effect waited for `online`.
- [~] P8.16 Native review of shown Odia: OCR fix rules applied (ଥି, ଥିବା, ଧି, ୍ୟ, ୍ୱ; English-acronym noise dropped) and the 📖 quote is focused on the matching sentence. `docs/NATIVE_CHECK.md` (from `content/scripts/native_check.ts`) lists what a native reader must tick: UI strings, tutor lines, suggested questions, word list, typed chapter titles, OCR rules and sample pages.
- [~] P8.17 Maths formulas: Gemini vision re-reads Algebra/Geometry pages as LaTeX (`content/scripts/vision_ocr.ts`), `latexToText` turns it into phone text (0 ≤ P(E) ≤ 1, a^(1/2)/b^(1/2), ∛a, ∠ABC), and `ocr_merge.ts` puts Tesseract's word back where vision swapped an Odia word. A page keeps vision text only if ≥ half of Tesseract's Odia words are in it. Done: Algebra 129/156 pages, Geometry 116/158 (free-tier daily quota: Flash 20/day/key, Flash-Lite spent too). Re-run `vision_ocr.ts geometry-9 <dir>` on later days to finish; saved readings are reused.
- [x] P8.18 Language books: Odia Literature + Grammar (one Odia pill), English (PDF text layer, `tools/books/pdf_text.py`), Hindi and Sanskrit (Tesseract hin/san, low-confidence lines dropped, header-above-columns split). 12 books. A language book is searched only when picked or when the question names a lesson; Hindi matches romanized typing (kabir → कबीर, silent a). Eval 131 cases, 93% right passage, 125/131 right chapter in top 3.
- [x] P8.19 Guided path (user: "the agent asks which subject, then the lessons, then what I want in that lesson, and keeps going until I understand"): the agent opens by asking the subject → lists its chapters → offers Teach me this lesson / Quiz me / I have a doubt. Teach = the chapter part by part (`Shelf.lessonParts`, 4 passages ≈ 2 pages), each part explained from the book then checked; right → Next part; partly → hint, same question; wrong → re-explained + a new, simpler question; after the last part → lesson done with mastery, practise / next chapter. Lesson pointer in tutor memory; next session offers to continue. A doubt inside a picked chapter is searched there first. Free typing still works at any time. Offline: the part is shown from the book on the phone. Tap-to-ask cards removed. Live-checked in the browser (Life Science ch. 2, parts 1→2, partly → right).

---

## Risk drills (§17) — each mitigation verified before the demo

- [x] R1 Gemini weak for Odia → P0 result + fallbacks + reviewed packs — mitigated — see docs/QA.md risk table
- [x] R2 Quota → budgets, cache, multi-provider, separate eval key, seeded demo cache — mitigated
- [x] R3 ADK TS immaturity → P0.i decision; LangGraph.js fallback — mitigated
- [x] R4 Web Speech `or-IN` missing → Gemini audio / self-hosted ASR / Gboard — mitigated (self-hosted ASR first)
- [~] R5 Hall noise → close-talk mic; typed romanized fallback — typed fallback ready; mic is hardware
- [x] R6 No Odia voice in edge-tts (confirmed) → MMS-TTS / Parler pre-generated pack audio — mitigated
- [~] R7 Odia fonts on OEM phones → bundled subset font — mitigated, not device-tested
- [x] R8 Venue network → device tier; tunnel + phone hotspot — mitigated (device tier + tunnel + hotspot)
- [x] R9 Solo bandwidth → phase gates; cut order — managed
- [x] R10 "Is the agent real?" → trace with overrides & latencies; state-dependent decisions; baseline numbers — mitigated (trace, simulator, golden, red-team)

---

## Coverage index (PLAN section → TODO items)

| PLAN § | TODO |
|---|---|
| §0 pitch, §2 problem | P7.13, P7.28 |
| §1 coverage matrix | whole file; S1.18 (mid-eval), P7 (demo/deck) |
| §3 existing work | P7.28 slide 3 |
| §4 principles 1–11 | 1 trace → P2.52 · 2 verification → S1.12, P2.36–39 · 3 facts from curriculum/code → P2.22, P2.45 · 4 small models never invent → P3.15, P4.7 · 5 one source of truth → S1.5, S1.13 · 6 shared core → S1.3–8, P4.6 · 7 fallback chains → P2.14, P3.1–12 · 8 data is money → P4.2–3 · 9 child is the user → P5.13–25 · 10 honest claims → P7.27 · 11 vertical first → phase order |
| §5.1 triggers | P4.22 (OPENED), P4.16 (RESUMED), S1.10/P2.36 (DOUBT), P2.37 (ANSWER), P4.28 (CONNECTIVITY), P4.29 (BUDGET), P4.23 (ENDED), P4.27 (SYNC), P4.30 (TICK) |
| §5.2 around-the-clock | P4.24–26 |
| §5.3 framework | P0.i, S1.10, P6.3 |
| §5.4 cycle across turns | S1.10, P2.7–8 |
| §5.5 policy | P2.1–6 |
| §5.6 state & sync-before-think | S1.5, S1.8, S1.13–14, P4.17 |
| §5.7 trace | S1.15, P2.52–54, P4.9 |
| §5.8 budget & latency | P2.9–17, P0.g, P7.7 |
| §6.1 tools | P2.18–30, P3.14–15, P4.24, P5.7 |
| §6.2 failures | P2.12, P2.47–50, P3.6, P3.12, P3.17, P4.10, P4.15, P4.20 |
| §6.3 learner model | S1.4–7, P2.31–35 |
| §6.4 teaching loop | P2.36–38 |
| §6.5 assessment | P2.39–42, P5.12 |
| §6.6 pedagogy | P2.43–46, C.10 |
| §6.7 child safety | P5.13–17, D9 |
| §6.8 Snap | P3.14–18, P0.d |
| §7 table, 7.1–7.6 | P3.19–31, C.8–9 |
| §8.1–8.7 | P4.1–33, P7.1–6 |
| §9.1–9.3 | P5.1–11, P4.31, P6.10–11 |
| §10.1–10.5 | P3.1–12, P2.13–14, P3.14–15, C.7, D10–11 |
| §10.6–10.7 | P5.18–25, S1.2 |
| §10.8 stack | S1.1, P7.8 |
| §11 content | C.1–12 |
| §12 evaluation | P6.1–14, P2.55, P4.33 |
| §13 build plan & cut order | phase structure + rules above |
| §14 hero demo | P7.13–25 |
| §15 prepared answers | P7.26 |
| §16 deck | P7.28 |
| §17 risks | R1–R10 |
| §18 honest limits | P7.27 |
| §19 open items | D1–D8 |

---

## Build log

| Date | What was done | What's next / blocked |
|---|---|---|
| 2026-10-13 | TODO created from PLAN v3. Build started. | — |
| 2026-10-13 | P0.i ADK spike PASS (ADK TS has no eval → own simulator). P0.e: edge-tts has no Odia voice; MMS-TTS Odia works. Built core (events, fold, BKT, policy, solve, numerals, matcher, turn engine), Motion content (draft Odia), server (ADK cycle, critic, failover, SQLite, sync, /trace/live), PWA (online + offline + sync). 54 tests green. Browser-tested online → airplane mode → reconnect. | Blocked on user: D5 keys (real LLM path), D4 phone (S1 exit test), D3 textbook + D6 reviewer (content). Next without blockers: placement (P2.31), session-end prepare + between-session run (P4.24–26), Snap offline locate (P3.15), teacher view (P5). |
| 2026-10-13 | Keys added (D5). Live models probed (P0.a/f/g partial). Fixed: router name sent as model id (Google 404), Gemma thought parts, hanging calls (timeouts). Added: Groq never writes Odia, critic term check, turn budget 8 s/5 s, late generations critic-checked + cached, no greeting/gendered address, "use a different example" hint. 57 tests green. | Next: P4.24–26 pre-generation between sessions (main fix for slow Gemini), then placement, Snap, teacher. |
| 2026-10-13 | P4.24–26/30 between-session agent: prepared sessions (phone + server), pre-written Gemini explanations inside the plan, queued doubts answered, escalation + reteach draft, inactivity end, drop-off. Phone shows "ready for you" and answered doubts. 65 tests green. Browser-verified offline → end → reconnect → reopen. | Next: placement (P2.31), Snap (P3), teacher view (P5). |
| 2026-10-13 | P2.31 placement walk (phone + server), C.6 10 placement items. P3.14–18 Snap: core locate (trigram, OCR-noise-tested), engine photo doubts (passage card, pick-one-of-3, keep photo), /api/snap/read (Gemini vision), Tesseract.js `ori` offline (opt-in ~2.6 MB, served by us, SW-cached). P5.1/5.6–5.12/5.24 teacher view: class + QR + key, needs-you, wellbeing apart, drop-off, class reteach approve/edit, exam date → goals, join by code/QR link. 88 tests. Browser-verified end to end (teacher → QR link → placement → offline Snap → kept photo read online → teacher sees all). | Next: P2.12 revise-once, P2.40 candidate misconceptions, P6.2 simulator, voice (P3.1–13). Blocked: D3/D4/D6/D7/D9. |
| 2026-10-13 | P2.41/P5.12 LLM-proposed misconception candidates (validated, deduped, teacher review → /admin/candidates; live Groq verified). P5.1 in-app QR scan (BarcodeDetector/jsQR, browser-verified with a fake camera). P3.8/P3.17 MMS-TTS Odia pack audio: 67 clips, 1.1 MB, speakable-text prep, keyed by text hash, tutor lines offline (browser: clip plays instead of device voice). D6/C.7 native review tool: /#review (290 lines, voice rating) → server → review_apply.ts (pack overrides + `reviewed` gate + source patches); own pre-review pass fixed 5 issues. 97 tests. | Next: P2.12 revise-once, P6.2 simulator, voice input (P3.1–7), P3.9 live-reply audio. Blocked: D3/D4/D6 (tool ready)/D7/D9. |
| 2026-10-13 | P3.9 live voice for AI-written replies (server MMS worker, /voice/, phone fallback + offline warm-up). Candidate misconceptions translated for the teacher (Gemini, cached, number check, English kept). Language-picker ଓଡ଼ିଆ + photo-kept line recorded (69 clips); gen_audio refactored onto tools/tts/mms.py. 103 tests. Gemini free tier was 429/503 during live checks. |
| 2026-10-14 | Voice input P3.1–P3.7: /api/listen chain (IndicConformer self-hosted 1.8–3 s → Gemini audio ≈14 s → Sarvam), phone 🎤 with Web Speech / Gboard / type-or-snap fallbacks, store-and-forward voice. Matcher sound keys so English said in Odia script matches. Safety P5.13/14/16/17/22: core screen (distress/unsafe/personal/off-topic), care/decline/redirect, LLM wellbeing override, output guard, PII scrub on every provider request, queued doubts screened. 9 new Odia clips (78). 137 tests. | Next: teaching quality (P2.8, P2.11, P2.42–46, P2.49). Real-phone check of Web Speech/Gboard pending. Blocked: D9 helplines confirm, D3/D4/D6/D7/D10/D12. |
| 2026-10-14 | Teaching quality: P2.8 one replan, P2.11 LLM critic when unsure, P2.12 revise once, P2.42 free-text answers, P2.43 solver-backed hint ladder (phone UI, Odia digits, browser-verified), P2.44 no sycophancy, P2.45 citations, P2.46 reading-level rules, P2.49 solver repair. 163 tests. Live LLM runs of replan/judge/grade not tried (quota). | Next: offline & sessions (P4.x). |
| 2026-10-14 | Offline & sessions: P4.3 small turns, P4.4 idempotent turns (turnId, replay, phone copy wins), P4.12 good-link downloads, P4.13 pack file share/import with hash, P4.14 pack diffs, P4.22 who-is-learning on shared phones, P4.23 real minutes + inactivity end, P4.28 connectivity event, P4.29 data/time budget low, P4.31 opt-in Web Push. 174 tests; browser-verified who-screen, footer, hash parity. | Next: home & UX (P5.2–5.5, P2.16). |
| 2026-10-14 | Home & UX: P5.2 session time asked once/learned/one-tap, P5.3 one-screen home with Start + switcher, P5.4 avatar confirm, P5.5 🔊 everywhere, P2.16 instant ack (streaming not done). Browser-verified. | Next: language (P3.19…, C.10, C.11). |
| 2026-10-14 | Language: P3.19 term bridge, P3.22 regional analogies, P3.23 voice/level change decisions, P3.24 home-language anchors, P3.26 tiers, P3.27 quality-aware generation, P3.28, P3.29 subset fonts (real phone pending), P3.30 Hindi UI, P3.31 translation drafting, C.10 vocabulary, C.11 Hindi pack (draft). 184 tests. | Next: evaluation (P6). Hindi review and real-phone font check need people/devices. |
| 2026-10-14 | Evaluation + content + partials: placement starts at the top of her goal (simulator: agent 75 vs plain tutor 84 answers); matcher fixes (question-frame stop words, "tarana"≈train sound key, squared coverage penalty) → offline understanding 88% (no wrong-concept misses), online 91%/89% (44/50, free-tier retries); live baseline leak 20%→0%, grounded 70%→100%; cost ₹0.63/learner-day, 73 KB/session. docs/EVAL.md, docs/PRIVACY.md. C.3 depth: reference point +2 strategies +4 checks, distance +2, speed +1, 3 FAQs (incl. negative velocity), Hindi drafted (188 lines), 124 Odia clips (2.1 MB). P5.21 retention (traces 90 d, silent learner 365 d). Audio bytes count toward the data budget. P6.1/2/4/6/7/8/12/13, P2.18/19/26–30/51/55, P3.20/21, P4.10/19, P5.15/18–21/25, C.12 → done. 197 tests. | Next: deck (P7.28). Blocked on people/devices: D3, D4, D6, D7, D9, D10, D12; rehearsals P7.25. |
| 2026-10-14 | **v4 change of direction (user: "not just an MCQ generator; a proper chatbot; let the student pick the subject; don't build blindly on the reference case").** The real BSE Odisha textbooks (Life Science, Geography & Economics, disaster chapter) are OCR'd into 850 cited passages + 400 term pairs. A tutor chat agent searches them, explains with page citations, writes and grades its own checks, tracks mastery per chapter, explains differently when she is stuck, follows up unasked, and alerts her teacher only on repeated failure. Chat is the home screen with subject chips; Motion is guided practice; offline passage + queued question. P8.1–P8.12 done; 216 tests. Live: works in Odia (gemma) and English (groq); Gemini Flash quota/503 make it flaky (P8.13). | Next: P8.15 deck + demo script for v4; P8.14 more books when PDFs are available. |
| 2026-10-14 | Pushed to github.com/Jyoti0525/Setu. Second Gemini key, Flash-Lite first for Odia (P8.13). UI/UX overhaul (P8.15a). Offline matching 68% → 92% over 7 books (P8.15b), with books downloading on 3G (P8.15c). Fixed: a new question without a question word ("rakto konika kete prokar") was graded as the answer to the open check; same-page source cards shown twice; କ'ଣ split into two words. Who-screen centred. Physical Science (full), History & Political Science, Algebra and Geometry OCR'd and built (P8.14). OCR fix rules, focused quotes, docs/NATIVE_CHECK.md (P8.16). 226 tests. | Needs the user: native check of docs/NATIVE_CHECK.md; rotate the keys pasted in chat; `huggingface-cli login` by hand. Next: maths formulas, Odia/English/Hindi/Sanskrit books. |
| 2026-10-14 | Maths formulas via Gemini vision + LaTeX → Unicode with a Tesseract word check (P8.17; Algebra 129/156, Geometry 116/158; multi-line arrays and proof braces too). Odia Literature, Odia Grammar, English, Hindi, Sanskrit added (P8.18): 12 books, language books only when picked or named, Hindi romanized matching. Eval 131 cases 93%. NATIVE_CHECK 227 boxes. The rewrite step no longer overrides a search when she named the chapter. 238 tests. | Next: finish Geometry vision on later days' quota. Needs the user: native check; rotate keys pasted in chat. |

| 2026-10-14 | Guided learning path (P8.19): subject → chapter → teach part by part with checks / quiz / own doubt; lesson memory and continue offer; tests 242. | Needs the user: native check of the new Odia lines (ask_subject … continue_yes). || 2026-10-14 | Hybrid RAG + IndicTrans2 (POC for evaluation 2). Server search = keyword (BM25, same as offline) + meaning (multilingual-e5-small vectors in Postgres + pgvector via PGlite, 4387 passages), fused by rank; a meaning-only page counts only when 3 of the top 5 agree on one chapter. Her question is translated to English by AI4Bharat IndicTrans2 (self-hosted, ~0.6 s) as a hint for the model and a second search query; the reply is still written from the Odia pages. Fixed: transformers 5 loaded IndicTrans2's position tables as zeros (looping, dropped words) and its generate() could not cache, so we run our own cached beam search. Eval: textbook questions 94% (no change, 0 broken), everyday-words questions 3% → 21% (29% at agree 2). Trace shows question.translate and hybrid books.search. BGE-M3 optional (SETU_EMBED=bge-m3, over an hour to index on CPU). 84 server tests. | Next: deck slides from "next" to "built" with these numbers. |
| 2026-10-14 | Photo + voice input checked end to end (real API, Odia). Voice (`/api/listen`, IndicConformer): 0.6–3.4 s, clean words heard right. Photo (`/api/snap/read`): Gemini 503s walked the whole vision chain for 67 s (phone waits 25 s) → cloud now gets 12 s in all, then server-side Tesseract ori+eng (warm, ~6 s); tilted Odia page read and answered in 17 s. A translation of misheard speech came out rude → such hints are dropped. Server 84 tests green. | Try voice with a real voice on the phone; Groq still never writes Odia, so in a Google outage answers are the textbook passage. |
| 2026-10-14 | P8.20 Textbook figures: `content/scripts/figures.ts` sends each page (colour, 110 dpi) to Gemini vision (3.5 Flash-Lite, free), which returns every figure's box, printed number, caption and a 2–4 sentence explanation in the book's language, written from the picture and the page text around it. `tools/books/figures.py` cuts each figure from the PDF (PyMuPDF). 321 figures: Life Science 80, Physical Science 99, Geography 52, History 90 (14 MB, `content/books/figures/`). `build_book.ts` adds each as a searchable passage on its page (`fig` field), so a question can find a picture by meaning; the tutor prompt carries the page's figures with any passage from that page; answer cards show the book's own picture (`/figure/...`, cached by the phone once seen). Snap online also notes figures on a photographed page. Verified: "ମୋନେରା ଜଗତର ଉଦାହରଣ କ'ଣ?" → answer cites ଚିତ୍ର 1.1, page 7, with the picture in the card. Still to do: Disaster chapter (quota ran out) and the maths books' diagrams. |
| 2026-10-14 | PWA made installable for real (P7.6, P4.21): PNG icons 192/512 + maskable + apple-touch-icon, full manifest (id, description, portrait), iPhone meta tags; "Install Setu" button (Chrome's own install sheet via `beforeinstallprompt`, Share → Add to Home Screen steps on iPhone) in the top bar, hero and progress sheet (`apps/web/src/install.ts`). Server: sw.js / manifest / index.html `no-cache`, hashed assets immutable, so an installed app picks up a new build on the next open. Book pictures are saved on the phone with the book (Wi-Fi/4G only), so answer cards show them offline. Verified in Chrome: 0 installability errors, SW controls the page, offline reload works and answers from the book with its picture, new build taken on reload, 80/80 Life Science pictures cached. Disaster chapter: Gemini checked all 9 pages, it has no figures. 250 tests green. | Needs the HTTPS tunnel (cloudflared, not installed) to install on a real phone. |
