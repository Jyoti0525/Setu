# Setu — demo run sheet (finals, ~6 min)

For the person running the demo. Every beat lists what to do, what to point at, and the fallback. Beats follow PLAN §14.

## The day before

1. **Keys.** In `apps/server/.env`: Gemini + Groq keys (already there), plus
   `SETU_ADMIN_KEY=<long random>`, `SETU_DEMO_KEY=<long random>`, `SETU_PUBLIC_URL=<tunnel URL, after step 3>`.
   Rotate the Gemini/Groq keys that were pasted in chat before the finals.
2. **Seed the demo class** (server can be running):
   ```
   cd apps/server
   npx tsx demo/seed.ts
   ```
   It prints the class code, the **teacher key** (keep it off screen), and the link that opens Sunita on the demo phone.
   It creates: Sunita (prepared session waiting, mixes up speed and velocity), Ravi (stuck → "needs you"),
   Lipi (same mix-up → class reteach draft), Arjun (not seen for 9 days → drop-off), and warms the cache for the scripted
   questions so beats 5–6 answer instantly. `--no-llm` seeds without spending quota.
3. **Tunnel + mirroring** (free, one-time install):
   ```
   winget install Cloudflare.cloudflared     # or download from github.com/cloudflare/cloudflared/releases
   winget install Genymobile.scrcpy
   cloudflared tunnel --url http://localhost:8787     # prints https://<random>.trycloudflare.com
   scrcpy                                              # phone screen on the laptop, USB debugging on
   ```
   The phone uses **real mobile data**, not the venue Wi-Fi. Laptop on phone hotspot if the venue network is bad.
4. **Demo phone (Sunita):** open the restore link from step 2 (with `&k=<SETU_DEMO_KEY>`), "Add to home screen".
   **Fresh phone (judge):** nothing installed; have the class QR on screen (teacher view → class card).
5. **Record a full clean run** as the backup video (screen + trace side by side).

## On stage — screens

Left: phone via scrcpy. Right: `https://<tunnel>/trace/live` (every decision, live). Teacher view in a second tab.

| # | Do | Point at | If it fails |
|---|---|---|---|
| 1 | "This is Sunita. Class 9, Odia medium, the family phone for an hour a day." | — | — |
| 2 | Judge, fresh phone: open link → **ଓଡ଼ିଆ** → avatar → **⌗ QR** scan the class QR → 3 placement questions | Trace: `place` decisions, "placement done after 3 questions → first lesson …" | Type the 6-digit code instead of the QR |
| 3 | Sunita's phone: home shows **"ତୁମ ପାଇଁ ପ୍ରସ୍ତୁତ"** with items and ✨ (pre-written last night) | Trace (earlier entry): `between_sessions:session_end` — review_evidence, plan_next_session, prepare_offline + why | Re-run `demo/seed.ts` |
| 4 | Judge photographs an Odia textbook line (📷) | Passage card "📖 ତୁମ ବହିରୁ", then teaching; trace `read_page` | If unsure, she taps one of 3 passages; photo can be kept for later |
| 5 | Judge taps **🎤** and says "speed aau velocity re farak kana?" (earphone mic) | Transcript card 🎤, answer card; `/api/listen` provider (IndicConformer ~2 s) | Type it in the box (romanized works the same) |
| 6 | Read the explanation (📘 term bridge line) → check → **pick the trap** ("କିଛି ପାର୍ଥକ୍ୟ ନାହିଁ") → remediate with a *different* strategy → right → mastery bar moves | Trace: decided_by llm/policy, override + reason, tools in order, critic checks, `why` | — |
| 7 | **Airplane mode** on the phone. Ask another doubt, answer a check | Status "ଫୋନରେ (ଅଫଲାଇନ)"; grading still works; an unmatched doubt says it is kept (📥 promise) | — |
| 8 | Airplane mode off | Note "ସିଙ୍କ ହେଲା ↑n ↓m"; the kept doubt is answered; trace shows the device-tier steps arriving, no duplicates | The phone re-checks the link every few seconds; tap ▶ ଆଗକୁ to trigger a turn |
| 9 | ✓ **ଆଜି ପାଇଁ ଶେଷ** | Trace: after-session run. Teacher tab → **refresh**: Ravi in "needs you" (evidence, strategies tried), class reteach draft for speed=velocity (approve), Arjun in "not coming" | Admin "tick": `curl -X POST <url>/admin/tick -H "x-admin-key: …"` |
| 10 | Header **ଓଡ଼ିଆ → हिन्दी**, ask "चाल और वेग में क्या अंतर है?" | Same record (mastery bars unchanged), Hindi answer and UI | — |
| 11 | Slide: agent vs plain tutor, red-team, understanding numbers (docs/EVAL.md) | — | — |
| 12 | "The agent did the work. She just learned." | — | — |

## Failure drill (if a judge asks "what if a model dies?")

```
curl -X POST <url>/admin/provider -H "x-admin-key: <SETU_ADMIN_KEY>" -H "content-type: application/json" -d "{\"key\":\"gemini-flash\",\"down\":true}"
```
Ask a doubt: the trace shows the next provider in the chain (or "reviewed pack content" if none can write Odia).
Bring it back with `"down":false`. Provider names: `/api/health` → `providers`.

## Checklist (morning of)

- [ ] `pnpm test` green; `npx vite build` in `apps/web`; server started with the keys
- [ ] `/api/health` shows providers and `listen.or: true` (IndicConformer warm: first transcription after start takes longer)
- [ ] Seed run, restore link opened on the demo phone, cache warm lines printed
- [ ] Tunnel URL in `SETU_PUBLIC_URL`, phone on mobile data, scrcpy mirroring
- [ ] Backup video on the laptop; second phone charged
- [ ] Rehearsed 10×; last 5 runs clean

## Not yet verified (say so if asked)

Real low-end Android phone (font rendering, Web Speech, Gboard mic, push delivery), the venue network, and native-speaker
review of the Odia and Hindi text (all items are drafts until reviewed — they never move mastery on their own).
