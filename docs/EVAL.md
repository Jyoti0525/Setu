# Agent evaluation — 50 student questions

_Run 2026-10-15 03:34 UTC · asked in the app (Playwright, real sign-in) · writer: Groq gpt-oss-120b (Gemini fallback) · reviewer: the decide model · grader: gemini-3.1-flash-lite (42) — Gemini grades, Groq writes most answers · questions: `content/eval/agent_eval.json` · raw results: `content/eval/results/agent-2026-10-15-03-34.json`_

Every question was asked in the **Physical Science** chat of a BSE Odisha Class 9 student: 40 about Physical Science (core ideas, numericals, common misconceptions, Odia script and romanized Odia), 7 from other subjects, 3 not about studies.

## Headline numbers

| What | Result |
|---|---|
| Routed right (answered here / sent to the right subject / care / declined) | **86%** (43 of 50) |
| Physical Science questions answered from her own book | 88% |
| …citing a page from the right chapter | **95%** |
| Answers graded factually correct | **83%** |
| Answers supported by the cited book pages | **93%** |
| Answers that actually answer the question | 83% |
| At Class 9 level | 93% |
| Other-subject questions sent to the right subject's chat | **71%** |
| Time to answer | median 4.5 s · 90th percentile 17.8 s |

## What the reviewer did (before the student saw anything)

| Outcome | Turns |
|---|---|
| Passed on the first read | 32 |
| Failed → rewritten → passed on the second read | 4 |
| Failed twice → the student got the book page instead | 5 |
| Saw the question belongs to another subject → sent there | 0 |
| Reviewer unavailable → local book-overlap check only | 0 |
| Not reviewed (redirected or answered by policy before any model) | 9 |

## By kind of question

| Kind | Questions | Routed right |
|---|---|---|
| core | 31 | 90% |
| numerical | 2 | 100% |
| misconception | 3 | 100% |
| odia | 2 | 100% |
| romanized | 2 | 50% |
| other_subject | 7 | 71% |
| off_topic | 2 | 100% |
| wellbeing | 1 | 0% |

## Every question

| # | Question | Expected | Agent did | Route | Chapter | Correct | Supported | Review | Time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | What is evaporation and why does it cause cooling? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.6 s |
| 2 | Why do we feel cool after sweating on a hot day? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.2 s |
| 3 | What is latent heat of fusion? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.4 s |
| 4 | Why does the temperature stay the same while ice is melting? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.9 s |
| 5 | What is the difference between a solution, a suspension and a colloid? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.1 s |
| 6 | What is the Tyndall effect? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.1 s |
| 7 | How can we separate a mixture of salt and sand? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 7.5 s |
| 8 | How is a compound different from a mixture? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.1 s |
| 9 | State the law of conservation of mass. | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.5 s |
| 10 | What is the law of constant proportions? | answer | fallback | ✗ | ✓ | ✗ | ✗ | none | 26.2 s |
| 11 | What is a mole in chemistry? | answer | answer | ✓ | ✓ | ✓ | ✓ | fixed | 8.4 s |
| 12 | What is the valency of an element? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.8 s |
| 13 | What did Rutherford's gold foil experiment show? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.8 s |
| 14 | What are isotopes? Give an example. | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 9.6 s |
| 15 | What is the difference between distance and displacement? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.0 s |
| 16 | What is uniform circular motion? | answer | answer | ✓ | ✓ | ✓ | ✓ | fixed | 12.7 s |
| 17 | What is acceleration? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.6 s |
| 18 | A car goes from 0 to 20 m/s in 5 seconds. What is its acceleration? | answer | answer | ✓ | ✓ | ✓ | ✓ | blocked | 20.4 s |
| 19 | What is inertia? | answer | answer | ✓ | ✓ | ✓ | ✓ | fixed | 5.3 s |
| 20 | State Newton's third law of motion with an example. | answer | fallback | ✗ | ✓ | ✓ | ✓ | blocked | 7.9 s |
| 21 | Why does a gun recoil when it is fired? | answer | answer | ✓ | ✓ | ✗ | ✓ | passed | 4.5 s |
| 22 | What is momentum? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.4 s |
| 23 | What is the universal law of gravitation? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.7 s |
| 24 | Why is our weight on the moon less than on the earth? | answer | answer | ✓ | ✓ | ✓ | ✓ | blocked | 17.8 s |
| 25 | What is Archimedes' principle? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.6 s |
| 26 | What is the difference between mass and weight? | answer | answer | ✓ | ✗ | ✓ | ✓ | fixed | 12.7 s |
| 27 | What is kinetic energy? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.3 s |
| 28 | When do we say that work is done? | answer | answer | ✓ | ✓ | ✗ | ✓ | passed | 4.4 s |
| 29 | What is power and what is its unit? | answer | fallback | ✗ | ✓ | ✗ | ✗ | none | 26.6 s |
| 30 | How does sound travel through air? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.2 s |
| 31 | What is an echo? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.4 s |
| 32 | What is ultrasound and where is it used? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 5.3 s |
| 33 | A body of mass 2 kg moves with a velocity of 3 m/s. What is its kinetic energy? | answer | answer | ✓ | ✓ | ✗ | ✓ | passed | 8.2 s |
| 34 | Does a heavy stone fall faster than a light stone? | answer | answer | ✓ | ✓ | ✗ | ✓ | passed | 3.3 s |
| 35 | If no force acts on a moving ball, will it slow down and stop? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.6 s |
| 36 | Is a book lying on a table free of all forces? | answer | not_in_book | ✓ | ✗ | ✓ | ✓ | passed | 2.6 s |
| 37 | ବାଷ୍ପୀଭବନ କ'ଣ? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 3.0 s |
| 38 | ଗତି କାହାକୁ କହନ୍ତି? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 4.5 s |
| 39 | newton ra pratham niyama kana? | answer | answer | ✓ | ✓ | ✓ | ✓ | passed | 9.7 s |
| 40 | dhwani kipari gati kare? | answer | fallback | ✗ | ✓ | ✗ | ✗ | blocked | 26.0 s |
| 41 | What is photosynthesis? | redirect → Life Science | redirect → Life Science | ✓ |  |  |  | none | 0.7 s |
| 42 | Explain the structure of a cell. | redirect → Life Science | redirect → Life Science | ✓ |  |  |  | none | 0.4 s |
| 43 | What causes the monsoon in India? | redirect → Geography & Economics | answer | ✗ |  |  |  | passed | 2.4 s |
| 44 | What were the causes of the First World War? | redirect → History & Political Science | redirect → History & Political Science | ✓ |  |  |  | none | 0.6 s |
| 45 | Find the area of a triangle with base 6 cm and height 4 cm. | redirect → Mathematics | fallback | ✗ |  |  |  | blocked | 4.3 s |
| 46 | What are fundamental rights? | redirect → History & Political Science | redirect → History & Political Science | ✓ |  |  |  | none | 0.7 s |
| 47 | What is a set in mathematics? Give an example. | redirect → Mathematics | redirect → Mathematics | ✓ |  |  |  | none | 1.2 s |
| 48 | Tell me a joke about cricket. | decline | decline | ✓ |  |  |  | none | 0.9 s |
| 49 | I feel very stressed and scared about my exams. | care | answer | ✗ |  |  |  | passed | 2.9 s |
| 50 | Who won the last IPL final? | decline | decline | ✓ |  |  |  | none | 0.4 s |

## Problems the grader noted

- **#10** What is the law of constant proportions? — The tutor failed to provide an explanation or answer the student's question.
- **#11** What is a mole in chemistry? — The reply explains the concept well but fails to provide the numerical value (Avogadro's number).
- **#20** State Newton's third law of motion with an example. — The tutor failed to answer the student's question about Newton's third law.
- **#21** Why does a gun recoil when it is fired? — Incorrectly states the bullet exerts force on the air; it exerts force on the gun.
- **#23** What is the universal law of gravitation? — The reply is accurate, well-explained, and correctly addresses the student's question.
- **#24** Why is our weight on the moon less than on the earth? — The tutor failed to provide the numerical answer to the follow-up question asked in the reply.
- **#28** When do we say that work is done? — Incorrectly states displacement must be in the direction of force for work to occur.
- **#29** What is power and what is its unit? — The tutor failed to provide a definition or unit for power, offering no actual educational content.
- **#30** How does sound travel through air? — The reply is accurate and well-suited for a Class 9 student.
- **#33** A body of mass 2 kg moves with a velocity of 3 m/s. What is its kinetic energy? — Calculation error: 0.5 * 2 * 3^2 = 9, but the tutor incorrectly calculated 0.5 * 2 * 9 as 9.
- **#34** Does a heavy stone fall faster than a light stone? — Incorrectly claims a mango hits before a pea due to air resistance; they are both heavy objects.
- **#38** ଗତି କାହାକୁ କହନ୍ତି? — The explanation is accurate and appropriate for a Class 9 student.
- **#40** dhwani kipari gati kare? — The tutor failed to provide an explanation and did not answer the student's question.
- **#48** Tell me a joke about cricket. — The tutor correctly identified the request as off-topic and redirected the student to academic content.
- **#50** Who won the last IPL final? — The tutor correctly identified the question as off-topic and redirected the student to academic content.

## How to read this

- **Routing** and **chapter** come from the agent's own trace and the book index: no model is involved in scoring them.
- **Correct / supported / answers / level** are graded by Gemini, a different model family from Groq, which wrote most answers, reading the reply next to the book pages it cites. Model grading is not a teacher's grading: treat these as estimates and read the notes.
- 50 questions are a small sample: one question is 2–2.5 points. The question set is fixed in `content/eval/agent_eval.json`, so later runs are comparable.
