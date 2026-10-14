# Setu — evaluation report

Measured on 2026-10-14 on the Motion chapter (6 concepts, Odia). Every number below comes from a script in this repo, so it can be run again. The offline numbers are checked in CI on every push, and the live numbers come from `apps/server/eval/live.ts` (results in `docs/eval/live.json`).

**What is not measured yet:** learning gains of real students (field test, P6.9, needs a school, D7), a native reader's rating of Odia quality (P6.5, D6), unguided first-time users (P6.11, D7), and the real low-end phone.

## 1. Does the agent teach better than a plain tutor? (P6.1, P6.2)

**Student simulator** (`content/eval/simulator.ts`, in CI). There are 5 personas, each with knowledge and misconceptions hidden from the tutor. A persona answers a check right only if it knows the concept, and a misconception makes it pick that misconception's trap option. Each persona reaches its goal (velocity) after learning from the explanation(s) it needs.
- **Agent arm:** the real engine (placement, policy, diagnosis, strategy switch, prerequisites).
- **Plain-tutor arm:** teaches the chapter in book order and re-explains after a wrong answer, rotating explanation styles.

| Persona | Agent: answers to mastery | Plain tutor |
|---|---|---|
| Sunita (speed = velocity) | 17 | 16 |
| Ravi (distance = displacement) | 12 | 16 |
| Mina (weak start, slow) | 22 | 20 |
| Lipi (knows it all) | 5 | 15 |
| Arjun (two mix-ups) | 19 | 17 |
| **Total** | **75** | **84** |

Both arms bring every persona to mastery and resolve 100% of misconceptions. The agent saves 11% of the learner's answers overall. The saving comes from placement, which skips what she already knows (Lipi: 5 answers against 15). For a learner with one misconception the two arms are about even.

> **Bugs the simulator found:**
> - The agent kept re-teaching a concept that had no checks.
> - A possible (unconfirmed) misconception was never resolved.
> - After acceleration was added, placement started above the learner's goal.
>
> All three are fixed and guarded by tests.

**Live comparison with the same model** (`live.ts baseline`). The model is Gemini, and each arm gets 10 Odia doubts (script and romanized).
- **Chatbot:** the textbook passage is in its context, and it is asked to answer the doubt.
- **Setu:** one full turn of the agent.

| | Plain chatbot | Setu |
|---|---|---|
| Gives away the answer to the next check | 20% | **0%** |
| Every number traceable to the textbook | 70% | **100%** |
| Answer in Odia script | 100% | 100% |
| Typical length | 740–1160 characters, over her reading level in 10/10 | 80–220 characters, within level |

Note: Setu answered all 10 from reviewed pack texts or FAQ answers, because its matcher found each doubt in the book. That is how the agent is designed: model-written text is used only when the book has no reviewed answer.

## 2. Does it understand her doubt? (P6.4)

The set has 50 doubts, each labelled with a concept and an intent (`content/eval/understanding.json`). They cover six forms: Odia script, romanized Odia, code-mixed, English, Hindi, and speech-to-text transcripts.

| Path | Concept right | Intent right |
|---|---|---|
| Offline (phone, no network: matcher + solver + safety screen), in CI | **88%** | **100%** |
| Online (the decide model's own reading, with the matcher's evidence), 44 of 50 answered | **91%** | 89% |

Offline accuracy by form:

| Form | Concept right |
|---|---|
| Odia script | 82% |
| Romanized | 90% |
| Code-mixed | 88% |
| English | 82% |
| Hindi | 100% |
| Voice transcripts | 100% |

All six offline misses are *no match*; none is a wrong concept. With no network the phone asks her to say it again, and online the model reads the doubt.

Online, the model read 44 of the 50 doubts. The other 6 got no reply from the free tier even after 3 tries; the run made 13 retries in all.
- It missed one concept: "can distance be zero?" was read as displacement.
- Its intent misses were off-topic doubts (IPL, a phone game, Newton's laws) that it filed under a concept. This reading does not choose the action. When the safety screen calls a doubt off-topic, the model may teach only a concept that her words actually match, and §3 tests that rule.

## 3. Is it safe? (P6.8)

The red-team set has 30 prompts (`apps/server/eval/redteam.json`): distress, unsafe requests, personal data, off-topic, prompt injection, and injection hidden in a photographed page.

| Where | Handled as required |
|---|---|
| Phone, offline (core screen) | **30/30** |
| Server, with a model scripted to *obey every attack* | **30/30** |

Every provider request is also scrubbed of personal data (phone numbers, e-mail addresses, Aadhaar-like numbers and her name) before it is stored or sent to a model.

## 4. Does it stay correct? (P6.6, P6.7)

- **Golden replay** (`apps/server/test/golden/hero.json`): real model replies recorded on 2026-10-14 and replayed in CI.
  - The 4-step hero flow runs: doubt → FAQ answer, trap answer → contrast re-teach, right answer → next check, then review of a weak prerequisite.
  - Each step must make the same decision, show the same kinds of messages and make the same model calls.
- **Sync properties** (`packages/core/test/core.test.ts`): any interleaving or duplication of phone and server events folds to the same learner state. A turn the phone ran itself is never counted twice.

## 5. Can she use it? (P6.10, P6.12)

- **Accessibility:**
  - axe-core finds 0 violations in the light and dark themes.
  - There is no horizontal overflow at 200% text size.
  - Every tap target is at least 48 dp.
  - Every card has 🔊 and its text.
  - Nothing she does is timed. A session left untouched for 30 minutes is closed quietly, and her next tap opens a new one.
  - Right and wrong are shown by words and icons as well as colour.
- **Hindi:** the language picker switches the same learner to Hindi on the spot, and the state stays the same.
  - The Hindi pack is a model draft (157 texts) and has not been reviewed.
  - Browser-verified end to end.

## 6. Cost, data and speed (P6.13, P7.1–P7.7)

Measured from the providers' own token counts on 16 real turns (`live.ts cost`), at list prices:

| | |
|---|---|
| Model cost per learner-day (≈ 2 sessions) | **₹0.63** ($0.0075) |
| Per learner per month (22 school days) | **₹13.9** |
| Data per session (turns + sync, without audio) | **73 KB** |
| Data per online turn | ~6.5 KB (budget 30 KB) |
| Learner app JavaScript, gzipped | 91 KB (budget 250 KB) |
| First load (JS + CSS + Odia font) | ≈ 210 KB (budget 1.5 MB) |
| Chapter pack + 124 Odia voice clips | ≈ 2.2 MB (budget 6 MB) |
| JS heap after load (desktop Chrome) | ≈ 6 MB |
| Turn latency, no model call | p50 26 ms |
| Turn latency, with a model call | p50 3.1 s, p95 8.0 s (8 s budget; broadband, not 3G) |
| Speech to text (self-hosted IndicConformer) | ≈ 2 s |

Most turns need no model call: the matcher, policy, grading and pack texts run on the phone or the server without one. The free tier was congested during these runs, with 4 s timeouts, 503s and 429s. The circuit breakers moved each call to the next provider, which is why the cost figures mix Gemini and Groq.

## 7. How to run

```
pnpm test                                   # simulator, understanding (offline), red team, golden, sync — all of CI
cd apps/server && npx tsx eval/live.ts      # live: understand, baseline, cost (needs keys in apps/server/.env; ~15 min on the free tier)
```
