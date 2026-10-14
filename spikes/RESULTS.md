# P0 spike results

| Spike | Status | Result | Decision |
|---|---|---|---|
| a Gemini Odia text | **partial** | Gemini 2.5 Flash and 3.1 Flash-Lite use the BSE textbook terms (ଦ୍ରୁତି speed, ବେଗ velocity) and pass the critic (100% Odia script). Native rubric scoring of 30 answers not done (needs D6) | Odia live generation ON, Gemini-only, behind the critic incl. the new term check; reviewed pack is the fallback |
| b Gemini Odia audio | not run | needs Gemini key | — |
| c Chrome `or-IN` speech | not run | needs the Android phone | — |
| d Vision + Tesseract locate | not run | needs textbook photos + key | — |
| e Odia TTS | **partial** | edge-tts has **no Odia voice**; MMS-TTS Odia works offline on CPU; quality not yet judged by a native ear; Parler needs an HF token | MMS-TTS for pack audio now; Parler-TTS (Apache-2.0) when token is available; edge-tts only for hi/en/other languages |
| f Gemma / Groq Odia | **done** | Groq gpt-oss-120b / qwen3.8-27b / gpt-oss-20b: fluent but **wrong terms** (ଗତିଭେଗ, ଭେଗ, ତିର୍ୟକ ଦୂରତା). Gemma 4 26B: correct terms but 9–61 s and frequent 500s | Groq may **decide** (JSON) and write en/hi only, never Odia (`GROQ_GEN_LANGS=en,hi`); Gemma last in every chain |
| g RPM/RPD + 2-call latency | **partial** | 2026-10-13 (a heavy day: many 503 "high demand"): Groq decide 0.8–2 s; Gemini Flash-Lite decide 3–12 s; Gemini Flash Odia generation 7–14 s. Quotas not measured | Turn budget 8 s (cloud) / 5 s (weak), under the phone's 12 s timeout; decide timeout 4 s → Groq; late generations are critic-checked and **cached**; pre-generate between sessions (P4.24/26) so most explanations come from cache |
| h Low-end phone PWA | not run | needs the phone | — |
| i ADK TS 2.x | **PASS (except eval)** | see below | **Use ADK TS 2.2.1** |

## (i) Google ADK for TypeScript — 2026-10-13

Package `@google/adk@2.2.1`. Script: `spikes/adk/spike.ts` (`pnpm --filter spike-adk spike`). Runs with no API key.

| Requirement (PLAN §5.3) | Result |
|---|---|
| Graph workflow with function nodes + LLM node | PASS — `Workflow({edges:[['START', perceive, decide, ask, evaluate]]})` |
| Function tool with zod schema | PASS |
| Before-tool callback blocks an invalid decision (semantic validation) | PASS — returning an object skips the tool; the model sees the rejection and retries |
| Session state written by node, tool and `outputKey` | PASS |
| Human-input pause + resume | PASS — `RequestInput` emits `adk_request_input`; resume by sending a `functionResponse` with the same id |
| Provider failover | PASS — `RoutedLlm` router gets `failedKeys` and moves to the next model |
| Non-Gemini model | PASS — own `OpenAICompatLlm extends BaseLlm` (Groq/OpenRouter/Ollama/vLLM format), tested against a local fake server: tool schema sent, tool result round-tripped |
| Real Gemini call | SKIP — no key yet (run with `GEMINI_API_KEY=...`) |
| ADK evaluation (user simulation) | **FAIL for TS** — `@google/adk-devtools@2.2.1` eval endpoints all return `501 Not implemented` |

Findings that change the build:
1. **Evaluation:** ADK TS has no working eval module. Our own rule-based simulator + golden replay tests (PLAN §12) are the evaluation harness. No loss: they were already the main plan.
2. **Failover retries the dead model every call.** `RoutedLlm` routes per request, so a failing primary is retried on each LLM call (3 calls → 3 failures in the spike). We add our own **circuit breaker** in the router (open for N seconds after a 429/5xx).
3. **The loop spans turns (PLAN §5.4) fits better than `RequestInput`.** Each learner answer is a new trigger with state rebuilt from the event log; `RequestInput` works but is not needed for the core loop. Kept available for teacher approval of reteach drafts.

## (e) Odia text-to-speech — 2026-10-13

- **edge-tts: no Odia voice.** 324 voices listed, none `or-*` (it has bn, gu, hi, kn, ml, mr, ta, te, ur, en-IN). PLAN §10.2 assumed one; corrected.
- **MMS-TTS Odia** (`facebook/mms-tts-ory`, VITS, 36.3 M params, CC-BY-NC-4.0): runs on laptop CPU, ~5–6 s of audio in ~2 s. Script `spikes/tts/mms_tts.py`, samples in `spikes/tts/out/`. **To do:** a native speaker listens to the samples and rates them.
- **Indic Parler-TTS** (`ai4bharat/indic-parler-tts`, Apache-2.0, lists Odia): gated on Hugging Face (auto-approve) → needs a free HF token. Larger (~0.9 B), fine for one-time pack pre-generation.
- No ONNX build of MMS Odia is published (`Xenova/mms-tts-ory` absent) → on-device voice (stretch) would need our own ONNX export.
- Licence note: MMS is non-commercial → OK for this prototype; production pack audio should come from Parler-TTS (Apache-2.0).

## (a, f, g) Live models — 2026-10-13

Keys from the user (server `.env` only). Model names that exist for these keys today (old defaults were gone: `gemini-2.5-flash-lite` is closed to new keys, `llama-3.3-70b-versatile` is gone from Groq). Re-check any time with `npx tsx apps/server/scripts/probe-models.ts`.

| Job | Chain (first that is up) |
|---|---|
| decide (JSON, 4 s timeout) | gemini-3.1-flash-lite → groq openai/gpt-oss-120b → gemma-4-26b-a4b-it |
| write Odia | gemini-2.5-flash → gemini-3.1-flash-lite → gemma-4-26b-a4b-it → reviewed pack |
| write en / hi | same + Groq |

Bugs only real keys could show (fixed): ADK put the router's name (`decide-router`) in the request, so Google returned 404 while Groq ignored it; Gemma 4 returns its reasoning as extra text parts (now dropped); Gemini sometimes hangs > 60 s (per-provider timeouts).

Sample (Gemini 2.5 Flash, critic pass): «ବେଗ (velocity) ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି। ଦ୍ରୁତି କେବଳ "କେତେ ଜୋରରେ" କହେ, କିନ୍ତୁ ବେଗ "କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ" କହେ। ନଦୀର ସ୍ରୋତ କଥା ଭାବ। …» One earlier output said «ପ୍ରିୟ ଝିଅ» ("dear girl"), so the prompt now forbids greetings and gendered address.
