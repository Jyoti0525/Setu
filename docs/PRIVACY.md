# Setu — privacy, purpose and consent

## Purpose (P5.20)

Setu exists only to help a student learn her school chapter. Data it keeps is used for that purpose and nothing else:

- to choose what to teach her next, and to prepare her next session;
- to show her teacher who needs help, with the learning evidence behind it.

Setu has no ads, sells nothing, and builds no profile for anyone but her teacher.

## What is kept, and where

| What | Where | How long |
|---|---|---|
| Her name and avatar | Her phone only. The server gets a random profile id. | Until she removes the profile |
| Learning events (answers, doubts, sessions) | Her phone, and the server once she syncs | The server copy is deleted after a year without activity |
| Her question text | Server, with phone numbers, e-mail addresses, Aadhaar-like numbers and her name removed first | As above |
| Decision traces (why the agent chose an action) | Server | 90 days |
| Voice recordings | Not kept. Turned into text, then deleted on the server straight away | — |
| Photos of the textbook | Not kept on the server, which reads the page and discards the image. On the phone, only while waiting for a signal | — |
| Words about distress, unsafe acts or personal life | Not stored. Only the kind of message is logged, so a wellbeing note can reach the teacher | — |

Every request to a model provider is scrubbed of personal data first. Models never see her name.

## What the teacher sees

The teacher sees only learning evidence:
- which concepts a learner is stuck on;
- the misconception and what was tried;
- a separate wellbeing list (that a learner may need a kind word, without her words);
- who has stopped coming.

The teacher sees a learner's name only if she typed one when she joined the class.

## Consent (P5.19)

- **Without a class.** A student can use Setu with no account and no class. Only a random device token is created.
- **With a class.** Joining a class is how a school takes part. The school decides, with parents, before giving out the class code or QR. The note below is for the school to send home.

> **Note for parents (draft; Odia version to be written and reviewed)**
>
> Your child's class uses Setu, a free study helper for the Science chapter. It answers your child's doubts in Odia and checks understanding with short questions.
> - Your child's name stays on the phone. The teacher sees only how your child is doing in the chapter.
> - Voice and photos are not kept. Nothing is sold, and there are no ads.
> - Your child can stop at any time. A year after your child stops using Setu, the school's copy is deleted.
>
> If you do not want your child to join the class, tell the teacher. Your child can still use Setu on its own, without the class.

## Limits

- The server is a single machine run by the project for the hackathon prototype. There is no data-processing agreement with a school yet.
- The free model tiers (Gemini, Groq) receive only the scrubbed text of a turn. Their terms apply to that text (see PLAN §10.3).
