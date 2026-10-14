# Setu — prepared answers, honest limits, risks

For the presenter, to rehearse with. Each answer names what to show. Numbers come from `docs/EVAL.md`.

## Prepared answers (P7.26)

**Who is the user, and what changes for her?**
A Class 9 Odia-medium student with a shared phone for about an hour a day, weak and costly data, and a textbook in Odia but exams and the web in English. Setu teaches in her language at her reading level and checks that she understood. It keeps working when the signal drops and keeps working for her between sessions.

**Is it really an agent, or a chatbot with steps?**
Most of its work is not a reply to a message:
- It plans tomorrow's session after she closes the app.
- It pre-writes explanations and prefetches them within her data budget.
- It answers doubts she queued offline.
- It escalates to her teacher with the evidence.
- It flags drop-off.

Show `/trace/live`: `between_sessions:*` runs, `decided_by`, overrides with stated reasons, tools in order.

**Where is the loop? Does the LLM really decide?**
- **Each turn:** perceive → policy ranks the candidates → the LLM may override, but only with a stated reason, and the result is validated → act → critic → commit. One replan is allowed when the observation contradicts the plan, for example a weak prerequisite (P2.8).
- **Across turns:** her answer is the next observation.

Show an override in the trace. A golden test replays real model replies, so the decisions are reproducible.

**Why bounded autonomy?**
She is about 14. The model can choose among actions and words. It cannot invent concepts, skip verification, overrule the safety screen without evidence from her own words, or change her record unchecked. Tests: `redteam.test.ts` with a model scripted to obey every attack, 30/30 handled.

**Which tools, and what if one fails?**
The tools are search_curriculum, teach, make_check, evaluate_answer, solve, read_page, notify_teacher, plan_next_session and prepare_offline. Each model is wrapped in a circuit breaker, and the router falls back to the next provider, then to cached text, then to the reviewed pack.

Kill a provider live: `POST /admin/provider` (see DEMO.md).

**What happens when the network drops mid-task?**
The same engine runs on the phone (device tier): matching, grading, the policy, safety and the hint ladder. Every step is an event committed before it is shown. When the signal returns:
- the outbox syncs;
- queued doubts are answered;
- turns are idempotent (a retried turn is never run twice).

Show airplane mode (beats 7–8).

**How is this beyond translation?**
- Term bridge (textbook term = English exam term · everyday phrase).
- Code-mixed and romanized input.
- Speech in Odia, matched even when English words come out in Odia script.
- Snap a textbook line.
- Speakable forms, regional analogies, and reading level that changes the decisions.
- Language tiers A/B/C, with honest bridging for Kui, Santali and Ho.

**How do you know she learned?**
- **Mastery evidence:** only reviewed bank checks move mastery (BKT, plus two correct in a row). Placement is the starting point.
- **Simulator:** the agent against a plain tutor on the same personas.
- **Not yet:** the field test is planned (needs D7).

**Why no LLM on the phone?**
2 GB of RAM. Small on-device models get school science wrong too often for a child. The phone runs the deterministic agent and pack content instead, and the server writes when there is signal.

**Wrong maths from the AI?**
Numbers come from `solve`. The critic re-checks distance–time–speed relations in generated text and replaces a wrong result with the solver's value. Ungrounded numbers mean revise once, else the reviewed pack. Homework gets a solver-backed hint ladder, never the answer up front.

**Child safety and privacy?**
- **Screening:** a safety screen runs on the phone and the server (distress → caring message with helplines plus a quiet teacher alert; unsafe → calm no; off-topic and personal → back to study).
- **Output guard:** every message is checked before it is shown.
- **Personal data:** a PII scrub runs on every model request, and her name never leaves the phone. Profiles are tied to the devices that wrote them.

**Terms of the free models?**
Free tiers are for an adult-operated demo. Production runs on self-hosted open models through the same interface. Speech-to-text is already self-hosted (IndicConformer, MIT).

**Cost and scale?**
Measured tokens per learner-day × list prices, and data per session (docs/EVAL.md, cost). Channel: state education programmes and the NGOs already in these schools. Path: one chapter → Class 9 science → the state board → other states via the language tiers.

## Honest limits (P7.27) — say these before a judge asks

- A spoken doubt with zero signal gets no instant answer. It is recorded and answered on reconnect; typed, tapped and photographed doubts work offline.
- A brand-new free-form doubt offline cannot get a generated answer. It is matched to the pack and FAQ (86% concept accuracy offline on our 50-doubt set), else queued with a promise.
- Offline photo reading is approximate. It only locates a passage, and she confirms which one.
- Odia and Hindi text are drafts until native reviewers pass them, so drafts never move mastery on their own. The Hindi pack is machine-drafted through checks.
- Not tested yet on a real low-end Android phone or with real students (field test pending).
- Free-tier quotas are small. The free Gemini tier is slow (about 14 s for audio), so the self-hosted model is used first.
- The data budget counts only Setu's own bytes; a web app cannot read the phone's balance.

## Risks (R1–R10) — status

| Risk | Status | Evidence |
|---|---|---|
| R1 Gemini weak for Odia | Mitigated | P0.a: Gemini writers use BSE terms; the critic requires the textbook term; Groq never writes Odia; reviewed pack fallback |
| R2 Quota | Mitigated | Breakers + router, gen cache, pre-writing between sessions, demo cache warm (`demo/seed.ts`), turn budget 8 s |
| R3 ADK TS immaturity | Mitigated | ADK 2.2.1 pinned; graph workflow works; eval module missing → own simulator + golden replay |
| R4 Web Speech `or-IN` missing | Mitigated | Self-hosted IndicConformer (≈2 s) → Gemini audio → Sarvam → Web Speech → Gboard hint → type/snap |
| R5 Hall noise | Planned | Earphone/close-talk mic (hardware); typed romanized fallback works |
| R6 No Odia voice in edge-tts | Mitigated | MMS-TTS clips for every fixed line; live voice for AI-written lines |
| R7 Odia fonts on OEM phones | Mitigated, not device-tested | Subset Noto Sans Odia 44 KB bundled |
| R8 Venue network | Mitigated | Device tier; tunnel + phone hotspot (DEMO.md) |
| R9 Solo bandwidth | Managed | docs/TODO.md phase gates, cut order |
| R10 "Is the agent real?" | Mitigated | Trace with overrides and latencies; state-dependent decisions; simulator, golden and red-team tests |
