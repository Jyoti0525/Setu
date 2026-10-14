# Setu UI refresh

This note records the frontend changes made to make Setu feel calmer, clearer, and more like a study companion than a generic chat screen.

## Changes

- **New-chat welcome:** Replaced the large logo and three feature badges with a smaller brand greeting, a clear “What are you learning today?” prompt, and a short explanation. The prompt and greeting are available in Odia, Hindi, and English.
- **Less repeated copy:** When the chat is empty, the welcome panel is the introduction. The equivalent generic tutor greeting is hidden so the student does not see two introductions in a row. Suggested questions remain available.
- **Calmer visual hierarchy:** The welcome panel now has a soft, paper-like surface, a clear heading, and shorter spacing. Suggestion cards have simpler borders and no extra shadow. Chat bubbles no longer add a shadow to every message.
- **Clearer offline provenance:** An offline tutor reply is labeled “Offline · saved book” (localized in Odia and Hindi). This describes how that reply was produced, separately from the live connection indicator in the header.
- **More room on larger screens:** The chat column grows from 680px to 800px. On wider screens, content gets more breathing room and suggested questions display in two columns. Small screens keep a single-column layout.
- **Source cards:** Kept the existing expandable textbook reference, including chapter, subject, and page. Its surface now uses a quieter tint so it reads as supporting evidence rather than another main message.

## Dashboard redesign

- Replaced the horizontal subject chip bar with a text-only vertical subject list in a left sidebar. The active area uses a restrained selected state; no subject icons or emoji are shown.
- Added a simple top bar with the Setu mark and name. Removed the live online indicator from this bar.
- Moved language and progress controls into the lower sidebar section. Added a compact initial avatar and learner switch action at the sidebar bottom; on narrow screens, the learner action moves into the top bar.
- Added an All Subjects overview table built from the real book metadata: subject, textbook titles, class/board, and an Open Subject action. The project metadata has no subject description field, so the table uses existing textbook and class information instead of invented descriptions.
- Opening a subject leads to its existing tutor chat. New turns are tagged with the selected book IDs so changing subjects does not show unrelated new messages. Older saved turns predate subject tagging and remain available through “Continue recent chat” under All Subjects.
- The chat retains book sources, suggested questions, voice/photo input, progress, and language controls.
- On narrow screens, the sidebar becomes a compact text navigation and table rows reflow into labeled blocks while retaining table semantics.
- The learner setup and learner switch flow retain language, class, home-language, and class-code behavior. New Firebase users are prompted to create a named local learner profile after authentication.

## Landing and account access

- Added a public landing page with a product preview built from Setu's actual subject labels, supported capability descriptions, subject discovery, and registration/login calls to action.
- Added `/login`, `/register`, and protected `/dashboard` routes. Firebase Authentication supports email/password, password reset, Google popup, and India (+91) phone verification with Firebase reCAPTCHA, OTP cooldown, loading feedback, and provider conflict messaging.
- Firebase identity is separate from Setu's existing learner profile. The current learner profile and learning history remain local/offline; a local account-to-profile mapping prevents one signed-in Firebase account from being offered another account's learner profiles.
- Removed CSS gradients from the app styles. The mastery ring uses a quiet neutral outline while its percentage remains visible.
- Firebase web config is read from `VITE_FIREBASE_*` variables. Console steps and cross-device profile limitation are documented in `apps/web/FIREBASE_SETUP.md`.

Firebase credentials and Console provider settings are not present in this repository, so actual account creation, Google popup, and SMS delivery require the project owner to configure them.

## Files changed

- `apps/web/src/product.tsx` — public landing page, route guard, login and registration interfaces, and Firebase flows.
- `apps/web/src/firebase.ts` — centralized Firebase app/Auth initialization from environment config.
- `apps/web/src/main.tsx` — entry routing between public product pages and existing teacher/review views.
- `apps/web/src/app.tsx` and `apps/web/src/chat.tsx` — account-scoped local learner profiles and dashboard sign-out action.
- `apps/web/src/styles.css` — previous dashboard refresh plus responsive landing/auth styles, with gradients removed.
- `apps/web/.env.example` and `apps/web/FIREBASE_SETUP.md` — required config placeholders and Console setup guide.
- `docs/UI_REFRESH.md` — this change record.

## Notes

- The existing system light/dark color preference remains in effect.
- Existing conversation history and stored learner data are not cleared by this refresh.
- `@setu/web` typecheck and production build pass. The landing, login, and registration routes render in the local browser. This package does not define a lint script. Firebase provider flows were not exercised because no Firebase web config is present.
- These changes have not been committed or pushed.
