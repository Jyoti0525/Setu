# Setu — Master Plan (v3)

> Working name: **Setu** (ସେତୁ / सेतु — "bridge"). Rename freely.
> Hackathon: NIRMIT · Nextech 2.0 · Agentic AI Hackathon — "Agentic EdTech for Regional Language & Geography". Finals: ~43 teams, top 3 win.
> Constraints: **solo builder · free tools only · no Bhashini** · national/multilingual product · demo language Odia.
> Audit history (v1 → v3) is in Appendix A. This document is the single source of truth for the build.

---

## v4 — Change of direction (2026-10-14). Read this first; it overrides the sections below where they differ.

**What was wrong with v3.** We built the whole product around the PS reference case (Sunita, Class 9, one chapter, "Motion"). The PS says plainly: *"Your solution need not serve this exact learner. Choose your own user and problem."* The result looked like a quiz app: the agent pulled prepared check questions from one hand-written chapter, and a free question only worked if it matched that chapter. A student could not pick a subject, could not just talk to it, and nothing outside Motion existed.

**What v4 is.** **Setu is a tutor a student can talk to, in Odia, about any subject in their own board textbook.** It is a tutor, not a quiz.
- **Chat is the main screen.** The student asks anything by typing in Odia or English letters, by voice, or with a photo. They pick a subject (Life Science, Geography & Economics, Physical Science, …) or just ask, and the agent finds the right book.
- **Answers come from the real textbook.** The BSE Odisha books are turned into searchable text by OCR. Each reply quotes and cites the page the answer comes from, at the student's level, with the English exam term beside the Odia one.
- **The agent still does the work. This is what separates it from the plain chatbot the PS warns about** (*"a quiz and a chatbot can be shipped in a day"*). Each turn the agent chooses its tools in order: safety check → search the textbook → look up what this learner already knows → explain → *decide* whether to check understanding. When it checks, it writes the question on the spot from that textbook passage; nothing comes from a stored question bank. It grades the reply in the conversation, tracks mastery per chapter, re-explains differently when the student is still confused, and opens the next session with a follow-up nobody asked for ("yesterday the cell wall was confusing — one quick question?"). It tells the teacher only when a topic keeps failing.
- **Users.** Odia-medium secondary students (Class 9 first, any textbook next), including exam aspirants. Sunita is one example user, not the whole design. The teacher is the secondary user.
- **Any textbook.** `tools/books/render.py` + `content/scripts/ocr_book.mjs` + `content/scripts/build_book.ts` turn a board PDF into a book index. Adding a subject means running these scripts; no hand-written content is needed.
- **Offline.** The phone keeps each downloaded book's index (text only, small). With no signal it still finds and reads out the right textbook passage, and keeps the doubt; the full explanation arrives when the signal returns.
- **What stays from v3.** Voice in/out, Snap, safety layer, PII scrub, model router with breakers, trace, teacher view, profiles, sync. Motion (the hand-written, verified chapter) stays as **guided practice** inside Physical Science.

**Textbooks used (2026-10-14).** Official PDFs from bseodisha.ac.in/CL-IX-Text-Book.html:
- Jiba Bigyan (Life Science), 112 pages.
- Bhugola O Arthaniti (Geography & Economics), 128 pages.
- The disaster-management supplement, 9 pages.

Life Science is set in a legacy non-Unicode font, and Geography is scanned images, so the text layer is useless and every page is OCR'd (Tesseract `ori`, free, offline). The other Class 9 books (Physical Science, Maths, History) are not on the board site. When a teacher supplies the PDF, it is added with the same three scripts.

---

## v5 — More languages, tribal languages, CBSE (2026-10-15). Read after v4.

**Tribal languages first.** A probe (Gemini Flash-Lite, "what is a tissue", back-translated by a second call) showed what free models can and cannot write: Santali in Ol Chiki — yes (real Santali words); Kui and Saora — no (it writes plain Odia); Ho in Warang Citi — no (garbage). So:
- **Santali** is a written language in Setu (tier B, draft): replies in Ol Chiki, and every science word carries the Odia and English school words in brackets — ᱠᱚᱥ (ଜୀବକୋଷ, cell) — so she can match it with her Odia-medium book and a wrong Santali word is caught.
- **Kui, Kuvi, Ho, Saora, Munda** (tier C): taught in very easy Odia, with her home-language words from the **Government of Odisha's Odia–<language> Sabdakosh (2018) and Sarala Tribhasi primers** (archive.org, `in.gov.tribals.*`; CC BY 4.0 via Odisha Virtual Academy). Pages were OCR'd with word positions (`content/scripts/ocr_words.mjs`), parsed into 830–1,540 word pairs per language with example sentences (`content/scripts/tribal_words.ts` → `content/tribal/<id>.json`). Each turn the model is given ≤ 40 relevant pairs (words of her question and passages, then everyday words) and may only copy them; a critic removes any home-language word not on the list (`apps/server/src/tutor/home.ts`). The words used are shown under the reply.

**More languages.** Bengali, Kannada, Telugu, Tamil, Marathi, Bhojpuri (+ Santali): tutor replies in the language (probe: natural, with the board terms), all 175 interface lines drafted by `content/scripts/translate_ui.ts` and checked (every key, {0} slots, helplines 1098 / 14416 / 112, own script). Marked "AI-written, not yet checked by a speaker" in the app. The phone downloads only her language (≈ 5 KB).

**Boards.** CBSE (NCERT 2026-27, official chapter PDFs): Science *Exploration* (13 ch), Maths *Ganita Manjari* I (8) + II (6), Social Science *Understanding Society: India and Beyond* I (9) + II (6), English *Kaveri* (8); Hindi-medium *Anveshan* and *Ganita Manjari* (OCR: their text layer is broken). Printed page numbers are kept (`tools/books/ncert_book.py`), chapter names in English, Odia and Hindi. She picks her board at sign-up (default: BSE Odisha for Odia / Santali / tribal, CBSE otherwise); search, subjects and offline books are limited to her board. **CHSE Odisha is Classes 11–12** — no Class 9 books; next boards for Class 9 are state boards matching the new languages (Karnataka, West Bengal, …). Classes 8 and 10 come after.

---

## 0. The pitch

**Sunita has the family phone for one hour a day. Setu's work doesn't stop when she puts it down.**

Tonight's session is already on the phone before she opens it — Setu prepared it at the end of yesterday's session. She asks her doubt in Odia — spoken, typed in English letters, or *photographed straight from her textbook*. Setu explains at her level, checks whether she really understood, finds the misconception behind a wrong answer and switches strategy. When the signal dies, it keeps teaching. When she puts the phone down, it reviews her mistakes, schedules what comes back tomorrow, answers the doubts she asked offline, and tells her teacher only what genuinely needs a human.

PS test (§3): *if you remove the AI, does the same app remain?* — No. No plan, no diagnosis, no follow-up, no offline continuation, no prepared session — just a list of chapters.

---

## 1. Problem-statement coverage matrix

| PS requirement (source) | How Setu satisfies it | § |
|---|---|---|
| Agentic core: plan, decide, use tools, act toward an educational goal (§2) | Goal hierarchy; LLM planner over typed tools; observe → update → replan across turns; work between sessions | 5, 6 |
| "Not merely respond to a prompt" (§2, §3) | Most agent runs are triggered by events, not messages | 5.1 |
| "Take meaningful action on the learner's behalf" (§1) | Prepares sessions, prefetches within data budget, answers queued doubts, escalates, detects drop-off, drafts reteach | 5.2 |
| Understand doubt in her own language, by voice or text, at her level (§2.2) | Free ASR chain, romanized + code-mixed text, textbook photo, reading-level control, grounded answers | 6, 7, 10 |
| Typing Odia is slow (§2.2) | Voice, romanized typing, Snap | 6.8, 7 |
| Results in English and above her level (§2.2) | Odia answer at her reading level, grounded in her textbook, term bridge | 6, 7 |
| Keep working when signal drops; resume where she left off (§2.2) | Device-tier policy, chapter pack, outbox sync, interruption-safe steps | 8 |
| Video buffers, data pack runs low (§2.2) | No video, text-first, data budget is agent state, < 30 KB turns | 8.1 |
| Notice what she hasn't understood, decide what next, follow up unasked (§2.2) | Verification after every explanation, misconception diagnosis, BKT, placement, scheduling, drop-off detection | 5, 6 |
| Simple for first-time user on a shared low-end phone (§2.2) | One screen, voice-first, audio labels, no login, profiles, < 250 KB JS | 9 |
| Teacher can't answer every doubt (§2.2) | Teacher gets only escalations + reteach drafts, with evidence | 9.2 |
| §3 table: goal pursuit · AI as engine · native language · adaptation · recovery | §5 · §5 · §7 · §6 · §6.2 + §8 | — |
| Core: Problem understanding | Sunita-type learner, one-sentence gap, before/after | 2 |
| Core: Technicalities | §5–§8 + measured evaluation vs a chatbot baseline | 5–8, 12 |
| Core: Presentation | Hero demo mapped to evaluator checks; rehearsed Q&A | 14, 15 |
| Core: Pitch deck (CTOs/VCs) | Problem → agent → evidence → cost → go-to-market | 16 |
| Bonus: Regional language (interface, content, translation, voice, AI assistance) | All five + term bridge, code-mix, romanized, Snap, fonts, numerals | 7 |
| Bonus: Ease of use **& accessibility** (student, teacher **or admin**) | Unguided tests for learner *and* teacher; WCAG-AA basics, TalkBack, text scaling | 9 |
| Bonus: Offline (cached content, edge models, sync on reconnect) | Chapter packs (shareable phone-to-phone), on-device models, event-sourced sync | 8 |
| Bonus: Framework type | Bounded-autonomous on Google ADK (TypeScript) + deterministic offline policy | 5.3 |
| Deliverable: working MVP with real tool calls | Every demo step hits real tools; trace proves it | 14 |
| Deliverable: mid-eval (problem, users, architecture, running loop skeleton, planned bonuses) | Producible from the vertical slice (S1) | 13 |
| Deliverable: live pitch deck | §16 | 16 |
| Demo checks (gap sentence · decision trace · Indic voice/text · unguided user · network off + sync · framework reason) | Hero demo steps | 14 |
| Other PS cases: multi-grade teacher, exam aspirant | Class view + reteach drafts; exam-date goal planner | 5.2, 9.2 |
| National scope | Language tiers A/B/C over English + 22 scheduled languages | 7.4 |

---

## 2. Problem understanding

**Primary user (PS reference case):** Class 9, rural/tribal-majority block; home language ≠ school language; English technical terms; one shared phone (~1 h/evening); weak signal; small data pack; overloaded teacher.
**Secondary user:** her teacher — receives only what needs a human.

**Gap in one sentence (say on stage):**
> *"Sunita has a phone and an Odia textbook, but nobody who can answer her doubt in her language, check if she understood, tell her what to study next, and keep going when the signal drops — so she memorises what she doesn't understand."*

| Before (PS §2.2) | With Setu |
|---|---|
| Follows half the class; no time for doubts | Asks that evening — speaks, types in English letters, or photographs the line |
| English app, buffering video, data runs out | Odia, text-first, no video, prepared offline, data-budget aware |
| Search results in English, above her level | Answer at her level, from her own textbook, term bridged |
| Memorises before tests; nobody tracks or guides | Per-concept mastery; plan to exam date; mistakes return until fixed |

---

## 3. What existing work taught us

| Project | Weakness | Setu |
|---|---|---|
| Mo Saathi (Odia voice tutor) | No offline; live voice needs strong network; no learner model; escalation without "why" | Weak-signal design; store-and-forward voice; BKT + misconceptions; evidence-rich escalation |
| Guru Offline (2 GB phone, 135M model) | English only; not agentic; 63% correct answers | Tiny models never state facts; on-device models only read, match, speak |
| ANEETA (offline multi-agent NEET) | Laptop-only; no learner tracking | Phone-first; learner model is the core |
| Shiksha Copilot / SwiftChat | Teacher tool / chatbot collections, cloud-only | One goal-pursuing agent per learner |
| LLM-tutor research 2025–26 | Answer leakage, multi-turn decay, sycophancy, ungrounded feedback | Critic + verification loop + measured eval |
| Knowledge-tracing research | Classical KT beats LLMs at predicting mastery | LLM labels evidence; BKT tracks mastery |

---

## 4. Design principles

1. **The agent decides; the UI renders.** Every "next step" has a trace entry.
2. **Learning ≠ answer generated.** Every explanation is verified; mastery moves only on trustworthy evidence.
3. **Facts and numbers come from the curriculum and from code, not from the model.**
4. **Small models may read, match and speak — never invent facts.**
5. **One source of truth:** the learner's event log. Everything else (ADK session state, caches, UI) is derived.
6. **Same brain on phone and server** — one shared TypeScript core.
7. **Every tool has a fallback chain.** No single failure ends a session.
8. **Data is money.** Text first, audio on demand, never video.
9. **A child is the user.** Safety, privacy and wellbeing rules are part of the agent, not an afterthought.
10. **Honest claims only.** Limits are stated before judges ask (§18).
11. **Build vertical, then wide.** A thin end-to-end slice first; every later phase thickens a working product.

---

## 5. Agent architecture

### 5.1 Triggers
| Trigger | Agent reaction |
|---|---|
| `SESSION_OPENED` | Confirm who is using the phone; serve the prepared session; repair the plan if state changed |
| `SESSION_RESUMED` | Interrupted mid-step (phone taken away, app killed) → "We were on question 2 of 3 — continue?" |
| `DOUBT_ASKED` (voice/text/photo) | Understand → locate concept → teach at level → verify |
| `ANSWER_SUBMITTED` | Evaluate → diagnose → update mastery → continue / remediate / step back / move on |
| `CONNECTIVITY_CHANGED` | Switch tier; replan with available tools; prefetch if signal improved |
| `DATA_BUDGET_LOW` / `TIME_BUDGET_LOW` | Drop audio / compress plan; finish highest-value item; save resume point |
| `SESSION_ENDED` | Explicit close **or** inferred (inactivity timeout / next sync) → between-session run |
| `SYNC_COMPLETED` | Answer queued doubts; reconcile; escalate if offline attempts kept failing |
| `SCHEDULE_TICK` (daily, server) | Exam-date replanning; **drop-off detection** (no activity N days → gentle nudge + teacher digest); class digest |

### 5.2 Around-the-clock agent
```
 END of session (online)     WHILE she learns                     AFTER she stops (server)
 ──────────────────────      ──────────────────                   ─────────────────────────
 plan NEXT session now       understand doubt (voice/text/photo)  review today's evidence
 size it to her time budget  teach → verify → diagnose → adapt    schedule spaced follow-ups
 download extras within      step back to prerequisites           answer queued offline doubts
 data budget (what & why)    keep going offline                   escalate what needs a human
                                                                  detect drop-off; draft reteach
                                                                  → refinements sync next time online
```
- The **chapter pack** (all lesson text, checks, audio) is already on the phone (§8.3). The "prepared session" is only a small plan + extras (≈ few KB–200 KB), so even if her session ended offline, the device policy can build tonight's session locally.
- Preparing at session end, not before opening: a web app can't reliably download in the background while someone else uses the phone.

### 5.3 Framework: bounded-autonomous (PS bonus answer)
- **Autonomous (online):** LLM planner chooses tools and order — doubts are open-ended, misconceptions unpredictable, the right next move depends on combinations a fixed flow can't anticipate.
- **Bounded:** deterministic graph shell, typed tools, schema **and semantic** validation of every LLM decision, budgets, timeouts, circuit breakers, critic before output.
- **Deterministic (offline):** the same goal structure driven by the shared-core policy — no reliable LLM fits a 2 GB phone.
- **If pure deterministic:** no free-form mixed-language doubts or photos; strategy change becomes fixed retry; novel misconceptions invisible.
- **If pure autonomous:** dies offline; hard to audit; one bad generation reaches a child unchecked.
- **Implementation:** **Google ADK for TypeScript 2.x** (`@google/adk` 2.2.1, graph workflows). P0 spike (i) passed on 2026-10-13 (`spikes/RESULTS.md`); LangGraph.js fallback no longer needed.

| Our need | ADK feature |
|---|---|
| Planner choosing tools | `LlmAgent` + function tools |
| Deterministic shell | Graph workflows (explicit paths, LLM nodes inside) |
| Critic, PII scrub, budget guard, safety, trace | Before/after model & tool callbacks (can block/replace a step) |
| Pause for her answer | Human-input support in graph workflows |
| Provider failover | `RoutedLlm` + our `OpenAICompatLlm` connector (Groq etc.) + our circuit breaker (ADK's router retries a dead model on every call) |
| Eval with simulated users | ADK TS eval is not implemented yet (501 in adk-devtools 2.2.1) → our own rule-based simulator + golden replay tests (§12) |
| Dev tracing | Built-in web interface/traces; judge view stays our `/trace/live` |
| Production path (self-hosted open models) | Swap model connector (Ollama/vLLM-served Gemma) |
Risks: ADK 2.x is new (breaking changes, fewer examples) → version pinned to 2.2.1. Non-Gemini providers verified in P0 via our own connector.

### 5.4 One decision cycle, and how the loop spans turns
```
 trigger → PERCEIVE → BUILD SITUATION → DECIDE (LLM call 1, may emit several tool calls)
         → ACT (deterministic tools run) → OBSERVE (results + checks)
            ├─ observation contradicts plan (e.g., retrieval empty, prerequisite weak) → ONE replan (LLM call ≤ 3)
            └─ ok → GENERATE (LLM call 2: explanation + check, structured) → CRITIC → RESPOND & COMMIT
```
**The agentic loop spans turns.** Each learner action is the observation for the next cycle: her answer to the check *is* the "observe" step; the agent's session plan and hypotheses (suspected misconception, weak prerequisite) persist in state and are revised every cycle. So "plan → act → observe → replan" happens continuously across the session, not inside one giant LLM call chain. Say this explicitly if a judge asks "where is the loop?"

### 5.5 How the agent decides (the policy, made explicit)
Deterministic `policy.recommend(state)` scores candidate actions; the LLM sees the top candidates with scores and reasons, plus everything the policy can't read (her words, the photo, her tone).

Candidate score (per concept/action, all terms 0–1, weights configurable):
```
value = w1·goalWeight(c)·(1 − pKnown(c))·prereqReady(c)     // learn what matters and is reachable
      + w2·reviewUrgency(c)                                   // spaced review due / overdue
      + w3·misconceptionSeverity(c)                           // confirmed misconceptions first
      + w4·examProximity                                      // closer exam → favour review & practice
      − w5·timeCost(action)/timeLeft − w6·dataCost(action)/dataLeft
prereqReady(c) = min over prerequisites p of sigmoid((pKnown(p) − 0.6)·k)
```
LLM decision rules (enforced by semantic validation in a before-tool callback):
- Must pick an action that exists, on a concept in the graph, affordable in time/data, available in the current tier.
- May override the top policy candidate **only with a stated reason** grounded in state or her input; override is logged.
- Invalid decision → rejected → policy's top candidate is used (trace shows it).

### 5.6 State ownership & sync-before-think
- **Authoritative:** append-only event log per learner (§8.5). `LearnerState = fold(events)` in the shared core.
- **ADK session state = per-turn working copy**, hydrated from `fold(events)` at cycle start; every change the agent makes is emitted as events, never written only into ADK state.
- **Sync-before-think:** every online request carries the phone's unsynced outbox events; the server applies them *before* building the situation — so the agent never decides on stale mastery.
- Content items are **immutable and versioned** (`itemId@version`); events reference versions so replay is stable even after content fixes.

### 5.7 Decision trace
```
{ step, trigger, tier: cloud|weak|device, facts_used: [...], candidates: [{action, concept, score}],
  chosen, decided_by: llm|policy, override: bool, reason, tool, args, latency_ms,
  status: ok|fallback|failed, fallback_used, critic: {checks, verdict}, state_diff }
```
- Learner view: one "Why?" line in her language.
- Judge view: `/trace/live` beside the mirrored phone; filters for tools, overrides, fallbacks, tiers.
- Device-tier traces are stored locally and synced, so offline decisions are auditable too.

### 5.8 LLM call budget & latency
| Rule | Detail |
|---|---|
| ≤ 2 LLM calls per cycle (≤ 3 with one replan) | Decide; generate. Deterministic tools never call an LLM |
| Critic deterministic first | Script ratio (Odia U+0B00–U+0B7F, glossary terms whitelisted), cited-chunk **term/number consistency**, answer-key leak match, numbers re-checked by `solve`, length/level heuristics, safety lexicon. LLM critic only when borderline |
| Cheapest capable model per job | Flash-Lite: decide/classify. Flash: generate, vision, audio |
| Cache | (concept, strategy, level, language, itemVersion) → approved output |
| Latency UX | Instant local acknowledgement in her language → streamed text → audio when ready. p50 < 5 s, p95 < 10 s on 3G |
| Quota hygiene | Content drafting & eval on a separate key/provider; demo inputs pre-cached; daily per-learner cap → pack content + queued generation, never an error |

---

## 6. Tools, learner model, assessment, safety

### 6.1 Tools
| Tool | Purpose | Online | Offline |
|---|---|---|---|
| `understand` | Voice/text → language, script, intent, concept candidates, wellbeing flag | LLM (+ASR chain) | multi-script matcher (§7.3) |
| `read_page` | Photo → text → passage location | LLM vision | Tesseract `ori` + fuzzy match (§6.8) |
| `search_curriculum` | Grounded chunks from her textbook pack | BM25 (+embeddings) | BM25 |
| `teach` | Explanation in a chosen strategy at a reading level | LLM, grounded | cached variants |
| `solve` | Deterministic math for worked examples & numeric checks (equations of motion, units) | ✓ | ✓ |
| `make_check` | Verification item | reviewed bank (mastery) / LLM (practice) | bank |
| `evaluate_answer` | Grade + diagnose | ✓ | MCQ/numeric + tags |
| `update_learner` | BKT, misconception counters, spaced schedule (shared core) | ✓ | ✓ |
| `plan` | Session plan / next action (policy + LLM) | ✓ | policy |
| `prepare_offline` | What to prefetch next, within data budget | ✓ | — |
| `notify_teacher` | Escalation, drop-off, reteach draft | ✓ | queued |
| `speak` | TTS output | ✓ | cached / on-device |
Rule: a tool exists only if calling it can change the next decision. (`solve` earns its place: a wrong number in a worked example teaches a wrong idea.)

### 6.2 Failure handling
| Failure | Response |
|---|---|
| ASR fails / language unsupported | Next in ASR chain → "type in English letters or snap a photo" |
| LLM rate-limited / down | Circuit breaker → next provider → cached variant → pack content |
| Photo unreadable | Retake tips (audio) → pick from 3 likely passages → queue for online |
| Retrieval finds nothing | One clarifying question with concept chips; never fabricate |
| Generated numbers disagree with `solve` | Replace with solver values or serve reviewed worked example |
| TTS fails | Cached audio → on-device voice → text |
| Critic rejects | Revise once → reviewed cached content |
| Ambiguous answer | Simpler diagnostic question |
| 3 strategies fail on one concept | Stop; escalate with evidence; switch to another reachable goal |
| Network drops mid-turn | Turn completes on device tier; remainder queued |
| App killed mid-step | Every step committed as an event before rendering → resume exactly (§5.1) |
| Sync conflict | Idempotent events; replay; nothing overwritten |

### 6.3 Learner model (shared core)
```ts
LearnerState {
  profileId, displayName(local only), avatar, class, board, classCode?,
  language: { ui, response, home?, inputMode, readingLevel: 1..5 },
  constraints: { typicalSessionMin, sessionMinutes, dataTier: "low"|"mid"|"high", dataUsedKB, sharedDevice },
  goal: { type: "exam"|"chapter", conceptIds, dueDate?, setBy: "learner"|"teacher" },
  concepts: Record<id, { pKnown, evidenceCount, attempts, correctStreak,
       misconceptions: Record<miscId,{signals, confirmed}>, strategiesTried, strategyThatWorked?,
       nextReviewAt?, lastSeenAt }>,
  commitments, queuedDoubts, preparedSession?, resumePointer?
}
```
- **BKT** per concept (p(L0)=0.2, p(T)=0.15, slip 0.1, guess 0.25 for 4-option MCQ); evidence weighted by source confidence.
- **Cold start — placement:** first session runs a 3-minute adaptive placement (5–7 tap questions) that walks the prerequisite graph (pass a concept → skip its prerequisites; fail → probe one level down). No more "everything 0.2 → step back to the root".
- **Unmeasured prerequisites:** when a prerequisite has little evidence, the agent **probes it with one question** instead of assuming it is weak.
- **Light evidence propagation:** success on a concept gives small credit to its prerequisites; failure raises a *hypothesis* (not a verdict) on the weakest prerequisite.
- **Spaced reviews:** 1d → 3d → 7d → 14d. **Mastered** = pKnown ≥ 0.85 and last 2 trustworthy checks correct.
- **Strategy memory:** prefer what worked for *her*.

### 6.4 Teaching loop
```
doubt → concept → prerequisites known? ── unknown → probe 1 question
  ├─ weak → step back to weakest prerequisite
  └─ ok   → teach (strategy from history + level; numbers from solve) → verify
              ├─ right → update → next plan item
              └─ wrong → diagnose
                   ├─ confirmed misconception → targeted remediation, DIFFERENT strategy
                   ├─ prerequisite gap         → step back
                   └─ unclear                  → simpler diagnostic
                   → re-verify (≤ 3 strategies) → else escalate
```

### 6.5 Assessment integrity
- **Mastery-affecting checks come only from the reviewed bank.** LLM-generated questions are *practice*: shown, graded, but low BKT weight until validated (key verified by `solve` for numeric items; consistency check for MCQs).
- **Numeral normalization:** Odia (୦–୯), Devanagari, Bengali and other digits → ASCII before numeric grading; unit-aware comparison with tolerance.
- **Two-signal rule** for confirming a misconception; novel misconceptions proposed by the LLM are logged as *candidates* for teacher review, not auto-added.
- Free-text answers: LLM grade with confidence; low confidence barely moves BKT.

### 6.6 Pedagogy guardrails
- Conceptual doubts → clear direct explanation; practice/homework items → hint ladder, no answer-leak.
- No sycophancy: if she insists on a wrong answer, re-ground in the textbook.
- Every factual claim cites retrieved chunks; key terms and numbers must be consistent with them.
- Reading level controls sentence length, vocabulary (class vocabulary list), step count.

### 6.7 Child safety & wellbeing (she is ~14)
- **Scope:** study help only; off-topic requests get a kind redirect in her language.
- **Unsafe topics** (self-harm, abuse, violence, adult content) → no engagement on the topic; a calm, caring message; for distress signals, encourage talking to a trusted adult/teacher and show a helpline; teacher alert flagged **as wellbeing, not academic** and with minimal detail. (Helpline list to be confirmed for India before demo.)
- **Prompt-injection hardening:** text from photos and learner input is treated as *data*, never as instructions (separate prompt section, callback filter); tools only accept schema-valid args.
- **No personal data collection** beyond what learning needs; no chat about her family/location.
- Safety checks run in the critic callback on every output, online and offline (offline content is pre-reviewed).

### 6.8 Snap-to-Learn (the print bridge)
PS §2.1: *"mother-tongue support exists in print … how to bring intelligent, personalised support … onto the devices they already have."*
- Photograph the line/paragraph/question she didn't understand → agent locates it in her textbook pack → teaches that passage at her level → verifies.
- **Online:** LLM vision reads it. **Offline:** Tesseract Odia OCR is imperfect, so it is used only to *locate* the passage by fuzzy character-n-gram match against the pack text; then teaching uses the clean pack text. No confident match → tap one of 3 likely passages, or queue the photo.
- Photo text is data, never instructions (§6.7). Photos are discarded after processing.

---

## 7. Language: beyond translation

| PS layer | Setu |
|---|---|
| Interface | Fully localized; every label has 🔊 |
| Content | Packs authored per language (Odia human-reviewed for the demo chapter) |
| Translation | Only for teacher↔learner mismatch and drafting long-tail packs |
| Voice | Free ASR chain in, free TTS chain out (§10) |
| AI assistance | LLM reasons and replies directly in the target language, grounded |

### 7.1 Differentiators
1. **Technical-term bridge** (from the PS case): textbook term ↔ English exam term ↔ everyday phrase — "ବେଗ (Velocity) — କେଉଁ ଦିଗରେ କେତେ ଜୋରରେ".
2. **Code-mixed input**: "velocity aau speed madhyare difference kana?"
3. **Romanized typing**: type Odia in English letters.
4. **Snap the textbook line** (§6.8).
5. **Local analogies** per region (cycle to the haat, river current, paddy field).
6. **Language changes decisions**: low reading level + voice preference → shorter spoken explanations, tap-answer checks.
7. **Home-language anchors (stretch)**: teacher/community adds home-language words (e.g., Kui) for key concepts.

### 7.2 Rendering text vs speech
Every generated/authored item has a **display form** and a **speakable form**: technical terms said naturally (no bracketed English read aloud), formulas spoken ("v equals u plus a t" → in Odia), units expanded, numbers read in the learner's language.

### 7.3 Multi-script understanding offline
Offline matching must handle Odia script, romanized Odia and English terms. Packs ship a **multi-script index**: each FAQ/glossary/passage key stored in Odia, romanized (pre-generated transliteration variants) and English. Online, the LLM handles all three natively.

### 7.4 Language tiers (honest national scope)
| Tier | What works | Languages (confirmed per language in P0/P6) |
|---|---|---|
| **A — full** | Voice in/out, live native generation, reviewed packs, Snap | Odia (if P0 passes), Hindi, English for the demo; expandable to languages with good free ASR/TTS/LLM quality |
| **B — text-first** | Text/romanized input, reviewed packs, live generation where quality passes, voice where any free engine exists | Other scheduled languages with usable LLM quality |
| **C — bridge** | Localized UI + glossary + pictures; teaching in her school language with home-language anchors | Low-resource scheduled and tribal languages (e.g., Santali, Bodo, Kui) |
The agent never silently drops a learner: tier C says so and teaches in the school language with home-language anchors.

### 7.5 Language-quality-aware generation
Per-language measured quality score (P0 + eval) decides live generation vs reviewed pack content (LLM then used only for understanding/planning). Critic script check blocks wrong- or mixed-script output.

### 7.6 Script rendering on cheap phones
Bundle a subset of **Noto Sans Odia** (and Devanagari) as a web font so conjuncts render correctly on OEM builds with poor system fonts; test on the real low-end phone. Counts toward the JS/asset budget.

---

## 8. Connectivity: weak, not just off

### 8.1 Weak-signal mode
- **Data budget** in plain terms: first run asks "small / medium / big data pack?" (icons), then the agent tracks Setu's own bytes and adapts ("today: text only, 0.4 MB used"). (A web app can only count its own data — stated honestly.)
- Turns < 30 KB text; audio on demand.
- **Store-and-forward voice** (Opus, low bitrate): record → upload when possible → answer when ready.
- Resumable, idempotent requests.
- **Real connectivity detection:** active probe + timeouts + rolling RTT/failure estimate → cloud / weak / device tier (`navigator.onLine` is not trusted).

### 8.2 Device tier (airplane mode)
- Session continues from the chapter pack + prepared plan: cached explanation variants and Odia audio, bank checks, grading, distractor diagnosis, BKT, prerequisite walk, scheduling, `solve`.
- **On-device models (never invent facts):** Tesseract `ori` (Snap locate); multi-script BM25 matcher (stretch: small multilingual embedding model); stretch: MMS-TTS Odia voice (Wi-Fi download).
- Unmatched doubts → queued with a promise ("ସିଗନାଲ୍ ଆସିଲେ ମୁଁ ଏହାର ଉତ୍ତର ଦେବି").
- Device-tier decisions write trace entries locally.

### 8.3 Getting content onto the phone without good internet
- **Chapter pack** (text + checks + audio, < 6 MB) downloaded once over the best available link (school Wi-Fi / teacher hotspot).
- **Phone-to-phone sharing:** a pack is also a single file that can travel by WhatsApp, Bluetooth or any file-share app and be imported in Setu (file picker / share target), integrity-checked by hash. Content spreads the way files already spread in villages — no internet needed.
- Pack updates are small diffs by item version.

### 8.4 Interruption safety
Every step (question shown, answer given, explanation delivered) is committed as an event before/as it renders. App killed, phone taken away, battery dies → reopen resumes at the exact step.

### 8.5 Sync
Events `{id, profileId, deviceId, seq, ts, type, payload, itemVersion?}` in an IndexedDB outbox → piggybacked on every online request (sync-before-think) and flushed at every chance → server dedupes by id, applies in per-device `seq` order (phone clocks are unreliable), replays → returns new events (queued-doubt answers, prepared session, teacher notes). Per-profile streams on shared phones.
**Storage survival:** install prompt (installed PWAs are more likely to get persistent storage), `navigator.storage.persist()`, small packs, integrity check on every open, auto re-download, frequent outbox flush.

### 8.6 Edge tier (stretch)
School ICT/smart-class PC as a local AI + sync hub during school hours. Not needed for the home scenario.

### 8.7 Low-end budgets (exit criteria, on a real 2–3 GB phone)
| Budget | Target |
|---|---|
| JS gzipped | < 250 KB (fonts separate, subsetted) |
| First load | < 1.5 MB |
| Chapter pack incl. audio | < 6 MB |
| Runtime memory | < 150 MB (without optional voice model) |
| Data per online turn | < 30 KB (+ audio on demand) |
| Platform | Android 8+ Chrome, installable PWA |

---

## 9. UX & accessibility

### 9.1 Learner
- First run, no login: tap language buttons that **speak their own name** → avatar (+ optional name) → class → join class by **scanning the teacher's QR** or typing a 6-digit code (optional) → 3-minute placement → first lesson.
- Session time asked once, then learned; one tap to change ("only 10 minutes today").
- Home = one screen: **🎤 Ask**, **📷 Snap**, **Today's plan** (agent-prepared, one Start), profile switcher.
- Shared phone: on open, "Are you Sunita?" avatar confirm (stops a sibling's answers polluting her model).
- Every text has 🔊; answers by tap where possible; status in plain words; max 2 taps from open to learning.
- Optional Web Push when online ("Sunita: 10-minute review ready"), quiet hours, no personal content in the notification (it is the family phone).

### 9.2 Teacher (secondary, minimal)
- Creates a class in one step → gets QR + code.
- **Needs you:** learner, concept, misconception, strategies tried, attempts, recommendation. **Wellbeing** flags kept separate.
- **Drop-off:** learners inactive for N days.
- **Reteach draft:** when many learners share a misconception, a 5-minute class reteach in the teacher's language; approve/edit (human-in-the-loop).
- Teacher sets class exam date → becomes every learner's goal (overridable).

### 9.3 Accessibility (the bonus says "Ease of Use & Accessibility")
- WCAG-AA contrast, ≥ 48 dp touch targets, text scaling up to 200% without breaking layout.
- TalkBack: all controls labelled; audio and text always both available (helps low literacy, low vision and hearing loss).
- No time-limited interactions; no reliance on colour alone.
- **Exit tests:** 2 real first-time learners (non-developers, ideally school students) complete "ask/snap → answer the check" unguided; 1 real teacher completes "create class → read an escalation" unguided.

---

## 10. Free technology stack (no Bhashini)

### 10.1 Speech → text (tried in order)
1. Gemini Flash audio input (free tier) — *Odia verified in P0.*
2. Chrome Web Speech API `or-IN` on Android — *verify.*
3. Keyboard voice typing (Gboard mic) — zero-integration fallback.
4. Self-hosted open model on our server: AI4Bharat IndicConformer or `whisper-small-or` (~26.6 WER on Common Voice).
5. Sarvam's free signup credit (₹100) — emergency backup only.

### 10.2 Text → speech
1. Pre-generated pack audio: **Odia** via MMS-TTS Odia (works offline on CPU; CC-BY-NC, prototype only) or AI4Bharat Indic Parler-TTS (Apache-2.0, needs a free HF token) — *edge-tts has no Odia voice (P0.e)*; **Hindi/English/other** via edge-tts or the same open models.
2. Live replies online: same generators server-side, cached by text hash.
3. On-device: `speechSynthesis` if an Odia voice exists; stretch MMS-TTS Odia (CC-BY-NC).
4. Text only.

### 10.3 Language models
1. Gemini Flash / Flash-Lite (free tier; no card).
2. Gemma via the same API (same key).
3. Groq free tier (open models) — planning/classification fallback.
4. Response cache.
**Terms reality:** Gemini API terms require 18+ users and forbid clients directed at under-18s; free tier may train on prompts. → Hackathon demo is adult-operated; **no PII ever in prompts**; production swaps to self-hosted open models via the same connector interface. Groq/OpenRouter terms to be checked equally.

### 10.4 OCR
Gemini vision online; Tesseract.js `ori` on device (locate-only).

### 10.5 Translation (pack drafting only)
LLM draft + human review for demo languages; IndicTrans2 (open) for bulk drafts if needed.

### 10.6 Child-data compliance by design (DPDP Act)
Under-18 = child; verifiable parental consent; limits on behavioural tracking and targeted ads.
- Profile + name **on device**; server sees pseudonymous id + learning events only.
- **School-mediated consent** (class join implies school-collected parental consent); offline-only use needs no server account.
- Learning-only purpose; no ads; teacher sees learning evidence only.
- Audio and photos discarded after processing; retention limits on events.
(Prototype stance, not legal advice; confirm against notified Rules before any rollout.)

### 10.7 Security basics
- All API keys **server-side only**; the PWA never holds a model key.
- Device token per install + per-device rate limiting (the demo tunnel URL is public).
- Teacher view behind a class-scoped token; teacher sees only their class.
- Content packs signed/hashed; imported packs verified before use.

### 10.8 Application stack
| Layer | Choice |
|---|---|
| Language | TypeScript end-to-end |
| Repo | pnpm workspaces: `packages/core`, `apps/server`, `apps/web`, `content/`, `eval/`, `spikes/` |
| Agent | Google ADK for TypeScript 2.x (graph workflows + LlmAgent + callbacks); fallback LangGraph.js |
| Server | Node 20 + Hono + SQLite (better-sqlite3) |
| Retrieval | MiniSearch BM25, multi-script index (browser + server) |
| Web app | Vite + Preact + Dexie + Workbox; installable PWA; subsetted Noto fonts |
| Trace | SSE → `/trace/live` |
| Demo hosting | Laptop server + free tunnel (e.g., Cloudflare quick tunnel); phone on real mobile data; screen mirrored with scrcpy |

---

## 11. Content (demo chapter)

- **Class 9 Science — Motion** (or the matching BSE Odisha chapter). Classic misconceptions: distance vs displacement, speed vs velocity, negative acceleration, uniform vs non-uniform motion, graph reading.
- **Depth tiers (solo-realistic):**
  - **Core path, full depth (6 concepts):** reference point → distance → displacement → speed → velocity → acceleration. 4 strategies each, 6–8 reviewed checks, glossary, analogies, FAQ, audio — Odia + English (+ Hindi for the language-switch demo).
  - **Rest of chapter (6–9 concepts):** 2 strategies, 4 checks, Odia + English.
- Misconception library ~10–15 entries (id, description, detection signals, remediation).
- Placement items: 8–10 covering the graph.
- Authoring: textbook chapter → LLM draft → native Odia review (rubric: correctness, naturalness, level, term usage) → `solve` verifies all numbers → audio once → signed pack.
- Textbooks remain the property of their publishers; packs are for this non-commercial prototype; deployment would partner with the state education authority.

---

## 12. Quality & evaluation (proof, not claims)

| What | How | Reported as |
|---|---|---|
| **Agent vs chatbot baseline** | Same model, same personas: (a) Setu agent, (b) plain chatbot with the textbook in context | steps-to-mastery, misconception resolved %, answer-leak rate, grounding rate — side by side. Directly answers "is the AI decoration?" |
| **Rule-based student simulator** | Personas with hidden misconceptions answer MCQs deterministically (no LLM quota, no sycophantic simulated students) | Reproducible numbers, run in CI |
| **Understanding test set** | 50 real-style doubts (Odia script, romanized, code-mixed, voice transcripts), labelled with concept + intent | Concept-match accuracy, online and offline |
| **Language quality** | Native reader scores 30 generated Odia answers (rubric) | Sets Odia tier and live-vs-pack bar |
| **Golden scenario tests** | Recorded LLM responses replayed → deterministic agent runs | No regressions in the hero flow |
| **Sync property tests** | Random event interleavings across devices/outbox → identical state | 0 divergences |
| **Safety red-team** | 30 off-topic/unsafe/injection prompts (text + photo) | Pass rate |
| **Real-world field test** | 3–5 real Class 9 Odia-medium students (with parent consent), pre-test → 2–3 short sessions → post-test + observation | Small but real evidence + quotes for the deck |

---

## 13. Build plan (solo, vertical slice first)

| Phase | Build | Exit test |
|---|---|---|
| **P0 Spikes** | (a) Gemini Odia text quality, native-scored; (b) Gemini Odia audio; (c) Chrome `or-IN` speech on Android; (d) vision + Tesseract-locate on 10 textbook photos; (e) edge-tts / Parler Odia voice; (f) Gemma/Groq Odia fallback; (g) real RPM/RPD + latency of a 2-call cycle; (h) PWA persistent storage, memory, Odia font rendering on a real low-end phone; (i) ADK TS: graph + LLM node + tool + callback + state + human-input pause + non-Gemini fallback + one eval case | Each pass/fail recorded → fixes chain order (§10), Odia tier (§7.4), framework (§5.3). Fail → pre-decided fallback |
| **S1 Vertical slice** | Core types/events/fold/BKT (minimal) · 3 concepts of Motion in Odia+English · ADK cycle (decide → teach → check → evaluate → update) · bare PWA screen (text in Odia) · `/trace/live` | Text doubt in Odia → explained → check → wrong → different strategy → right → mastery moves, all visible in trace, **on the real phone**. **= mid-eval package** |
| **P2 Thicken the agent** | Full policy (§5.5), semantic validation, critic callbacks, `solve`, placement, two-signal rule, cache, model routing | Golden tests green; same input + different state → different decision |
| **P3 Voice, Snap, language** | ASR/TTS chains, Snap (online + offline locate), romanized/multi-script, speakable forms, fonts, or/hi/en UI | Judge-style voice and photo inputs work on the phone |
| **P4 Offline & around-the-clock** | Chapter pack + import/share, device-tier policy, outbox sync-before-think, interruption resume, session-end prepare, server between-session run, drop-off | Airplane mode mid-session continues; reconnect syncs with no duplicates; queued doubt answered; app-kill resumes; next open shows prepared session |
| **P5 Teacher & safety** | Class QR/code, escalations, wellbeing flags, reteach draft, exam goal, child-safety layer | Seeded stuck learner + shared misconception + unsafe prompt → each handled correctly |
| **P6 Evaluation** | §12 suite incl. baseline comparison, Hindi pack, accessibility pass | Eval report + field-test results |
| **P7 Demo & deck** | Budgets on real phone, failure drills (kill each provider), seeded states, rehearsal ×10, backup video, deck | Hero demo 5× clean in a row |

**Cut order (bottom first):** home-language anchors → edge tier → on-device voice model → embedding matcher → Hindi pack → reteach draft → field test size. **Never cut:** verification loop, learner model, around-the-clock agent, device tier + sync, Snap, trace, Odia voice, child-safety layer, baseline comparison.

---

## 14. Hero demo (~6 min; phone mirrored via scrcpy + `/trace/live`)

| # | Moment | Check satisfied |
|---|---|---|
| 1 | "This is Sunita." Gap sentence. "She has the phone for an hour; Setu's work doesn't stop." | Problem understanding |
| 2 | Judge takes a **fresh** phone: taps "ଓଡ଼ିଆ", avatar, scans class QR, 3-min placement | Ease of use, unguided |
| 3 | Switch to Sunita's seeded profile: home shows **last night's prepared session**; trace shows the between-session run and what it prefetched and why | Agentic core; follow-up unasked |
| 4 | Judge **photographs a line from the Odia textbook** → located → taught | Language + print bridge |
| 5 | Judge asks by voice, code-mixed: "speed aau velocity re farak kana?" (close-talk mic / earphone mic for hall noise; typed romanized fallback) | Odia voice |
| 6 | Explain (term bridge + local analogy) → check → judge picks trap answer → diagnose → **different strategy** → re-check → mastery moves; trace shows decided_by, overrides, tools, order, why | Decision trace |
| 7 | **Airplane mode, live**: session continues, cached Odia audio, on-device grading, new doubt matched or queued; tier = DEVICE | Offline |
| 8 | Reconnect → sync → queued doubt answered → server event view: merged, no duplicates | Sync later |
| 9 | Close session → after-session run: follow-ups, teacher escalation for a seeded stuck learner, reteach draft, drop-off alert | Acts on her behalf |
| 10 | One tap → Hindi; same agent, same state | National |
| 11 | One slide: **agent vs chatbot** numbers + field-test result | Evidence |
| 12 | "The agent did the work. She just learned." | Pitch |

Backups: recorded full run; seeded state per step; cached responses for every scripted input; a second phone.

---

## 15. Prepared answers

- **User & what changes:** §2.
- **Why bounded-autonomous; what breaks otherwise:** §5.3.
- **Where is the loop / does the LLM really decide?** §5.4–5.5 — show an override in the trace.
- **Which tools; what if one fails?** §6.1–6.2 — kill a provider live.
- **Network drops mid-task?** §8 — demo steps 7–8; interruption safety §8.4.
- **Beyond translation?** §7 — term bridge, code-mix, romanized, Snap, speakable forms, native generation, language changes decisions.
- **How do you know she learned?** Reviewed checks + BKT + placement; baseline comparison; field test.
- **Why no LLM on the phone?** 2 GB RAM; comparable on-device tutor ~63% correct — unacceptable for a child.
- **Wrong maths from the AI?** Numbers come from `solve`; critic checks consistency.
- **Child safety & privacy?** §6.7, §10.6 — on-device profiles, no PII in prompts, wellbeing flow.
- **Terms of free models?** §10.3 — demo adult-operated; production on self-hosted open models via the same interface.
- **Cost & scale?** §16 slide 9.

---

## 16. Pitch deck (10 slides)

1. **Hook** — one hour on a shared phone.
2. **Problem** — devices exist (ASER 2024 ~90%); language, connectivity, no follow-up are the gap.
3. **Why current tools fail** — chatbots answer; nobody checks, plans, survives offline (named examples).
4. **Setu** — the around-the-clock agent in one picture.
5. **Agentic core** — decision cycle, policy + LLM, trace screenshot with an override.
6. **Architecture** — shared core, tiers, ADK, free model chain, event log.
7. **Language beyond translation** — term bridge, code-mix, Snap, tiers A/B/C.
8. **Evidence** — agent vs chatbot; offline sync proof; low-end budgets met; field test.
9. **Impact, cost, go-to-market** — measured tokens per learner-day × model price = cost per learner (computed in P6, not guessed); data per session; channel: state education programmes (B2G) + NGOs already working in these schools; path: one chapter → Class 9 science → state board → other states via language tiers; production on self-hosted open models.
10. **Close** — "The agent does the work. She just learns."

---

## 17. Risks

| Risk | Mitigation |
|---|---|
| Gemini weak/unsupported for Odia text or audio | P0 decides; fallbacks §10; reviewed packs carry the demo |
| Free-tier quota/rate limits | ≤ 2 calls/cycle, cache, multi-provider, separate eval key, seeded demo cache |
| ADK TypeScript immaturity | P0 spike; LangGraph.js fallback with the same design |
| Web Speech `or-IN` unavailable | Gemini audio / self-hosted ASR / Gboard mic |
| Hall noise breaks voice demo | Close-talk mic; typed romanized fallback |
| No free Odia voice in edge-tts (confirmed P0.e) | MMS-TTS Odia / Indic Parler-TTS pre-generated pack audio |
| Odia font rendering on OEM phones | Bundled subsetted Noto Sans Odia |
| Venue network | Device tier needs nothing; tunnel + phone hotspot for cloud |
| Solo bandwidth | Vertical slice first; phase gates; cut order |
| "Is the agent real?" | Trace with overrides & latencies; same input + different state → different decision; baseline numbers |

---

## 18. Honest limits

| Limit | Why | What Setu does instead |
|---|---|---|
| Spoken doubt with zero signal gets no instant answer | No free Odia speech model fits a 2 GB phone browser | Record → answer on reconnect; tap/snap/typed doubts work offline |
| Brand-new free-form doubt offline can't get a generated answer | No reliable LLM fits a 2 GB phone | Multi-script match to pack + FAQ; else queued with a promise |
| Offline photo reading is approximate | Tesseract on camera photos of Odia is weak | Locate-only + tap-to-confirm |
| Not all 22 languages get equal quality | Free speech/LLM quality varies | Tiers A/B/C stated openly; nobody dropped |
| Free cloud models can't serve minors in production | Provider terms (18+) | Adult-operated demo; production on self-hosted open models |
| Self-hosted open models may be weaker in Odia than Gemini | Model quality | Reviewed packs carry teaching; quality-aware generation; re-measure per model |
| Home languages like Kui have no speech/AI models | No public data | Home-language anchors; teaching in school language |
| Data budget counts only Setu's own bytes | Web apps can't read the phone's data balance | Ask pack size in plain terms; be conservative |
| Free-tier quotas small and unpublished | Provider policy | Budgets, cache, fallbacks |
State these before a judge asks.

---

## 19. Open items

1. TypeScript end-to-end — OK?
2. Name "Setu" — OK?
3. Odia Class 9 Science "Motion" chapter — can you get it?
4. A low-end Android phone (2–3 GB RAM) for testing?
5. Free keys: Google AI Studio (Gemini) and Groq — can you create them?
6. **Native Odia reviewer** for content and the language-quality rubric — you, or someone you know?
7. **Field test:** 3–5 Class 9 Odia-medium students reachable (with parent consent)?
8. When is the **mid-evaluation**? (Decides how thin S1 must be.)

---

## Appendix A — Audit history

| Version | Main change |
|---|---|
| v1 | Agentic tutor + offline + Odia; built on Bhashini (wrong assumption) |
| v2 | Free stack; Snap-to-Learn; weak-signal design; around-the-clock agent; Phase 0 spikes |
| v2.1 | Provider terms (18+), Odia support risk, prepare-at-session-end, ≤ 2 LLM calls/cycle, latency UX, storage eviction, language tiers, honest limits |
| v2.2 | Google ADK for TypeScript as the agent framework |
| v3 | Gap audit: single source of truth + sync-before-think; loop-across-turns explained; explicit decision policy + semantic validation; `solve` for maths; reviewed-bank-only mastery; numeral normalization; cold-start placement & prerequisite probing; child safety, wellbeing & prompt-injection; multi-script offline matching; speakable forms; Odia fonts; phone-to-phone pack sharing; interruption safety; inferred session end; drop-off detection; class join; accessibility; security basics; content depth tiers; agent-vs-chatbot baseline, rule-based simulator, field test; vertical-slice build order; demo noise & mirroring; cost/GTM |
