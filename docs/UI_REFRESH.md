# Setu UI refresh

## Provided Setu logo integration (2026-10-14)

- Replaced the hand-drawn SVG mark with the supplied transparent AI Learning Bridge artwork.
- Added an optimized 512px transparent image under the web app's public assets and kept the existing shared `Logo` component API, so the new mark carries through login, registration, landing, dashboard, onboarding, tutor, and loading views at their existing sizes.
- Updated the browser tab, installable app, and push-notification icons to use the same artwork and aligned the browser/app theme color with the current warm brand background.

## Brand colour and icon refresh (2026-10-14)

- Applied warm tan `#E5AA70` and beige `#DAC8AE` across the dashboard, onboarding, landing, login, and registration surfaces.
- Kept the existing dark-mode control and updated its palette with coordinated dark-brown surfaces and warm text.
- Restyled the Setu bridge mark with a finer bridge arch, inset border, balanced supports, and a small highlight, using the updated brand colours.
- Added restrained interaction polish to the main call-to-action and subject preview, and rounded the account form controls to match the new visual language.

## Contrast and dark learner picker polish (2026-10-14)

- Darkened the account-flow eyebrow, recovery, and account-switch text so it remains readable against the tan background; increased field-label weight and input-border contrast.
- Kept the tan call-to-action fill while using dark text for legibility.
- Added a warm framed avatar tile and clearer elevated profile cards in dark mode, preserving the existing palette and readable learner names.

## Student subject dashboard cards (2026-10-14)

- Replaced the dense subject table with responsive, clickable subject cards.
- Added subject-specific visual marks, actual textbook title previews and counts, and class/board chips from the loaded book metadata.
- Added search across subject names and textbook titles, with live result counts and localized empty states in English, Hindi, and Odia.
- Kept the recent-chat action and existing tutor navigation behavior, with higher-contrast warm text for small accent labels.
- Reworked the top of the subject dashboard into a welcoming learning banner with a student-centered headline, subtle book illustration, and a more prominent continue-learning action.

Files for this pass: `apps/web/src/styles.css`, `apps/web/src/icons.tsx`, and this change log.

This note records the frontend changes made to make Setu feel calmer, clearer, and more like a study companion than a generic chat screen.

## Dashboard and learner setup polish (2026-10-14)

This pass refines the learner setup and dashboard controls while preserving authentication, learner profile, language, class, and lesson behavior.

- Turn new-learner setup into distinct language, picture/name, and class steps, with contextual actions (“Continue to choose a picture,” “Continue to choose a class,” and “Start learning”). Existing learner language selection proceeds directly to subjects.
- Present the six learner avatars as compact selectable cards in one row on wide screens and responsive columns on phones.
- Give the learner picker a more prominent Setu logo and heading, remove its divider line, use larger Netflix-inspired profile cards with character art and a new-learner card, and add the requested soft gradient background.
- Remove the redundant Subjects sidebar heading and tighten the sidebar layout so navigation and controls fit at common desktop/laptop heights; retain scrolling only as a fallback for unusually short screens.
- Show “Learning at {account name}” using the authenticated Firebase display name, with an email-derived or generic fallback if no display name exists. Keep personal names in their original capitalization.
- Keep the light/dark toggle in the navbar and persist its selection. The dark variables now apply for an explicit user selection as well as the system preference; previously they only applied under the system dark-mode media query.
- Preserve the existing mobile navigation pattern and prevent avatar, account, and navigation text from overflowing their containers.

Files for this pass: `apps/web/src/app.tsx`, `apps/web/src/chat.tsx`, `apps/web/src/styles.css`, and this change log. The authenticated identity source is passed through the existing Firebase integration in `apps/web/src/product.tsx`.

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
- The All Subjects overview presents book metadata through responsive subject cards, including textbook names and class/board information, without inventing descriptions the project does not have.
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

## Learner portrait refresh

- Replaced emoji choices with the supplied illustrated portraits: four boy options and four girl options, each clearly labeled.
- Removed the animal option. Older saved profiles, including profiles that used the former animal emoji, now display as a human portrait without changing their stored data.
- Replaced the new-learner emoji with a neutral people icon and retained the add badge.
- Added compact portrait styling for setup choices and larger profile cards, including support for the existing light and dark themes.
- Updated portraits to use exact crops of the user-provided reference image instead of recreated drawings. The source artwork and face proportions are not edited or reshaped; the picker now offers four boy and four girl portraits and omits the cat.

Files for this pass: `apps/web/src/avatar.tsx`, `apps/web/src/app.tsx`, `apps/web/src/styles.css`, and this change log.

## Subject chat history across all subjects

- Every textbook subject now opens a fresh, separate conversation whenever selected. The previous transcript is saved under that subject, and the chat title area has a right-aligned **Chat history** control plus **New chat** action.
- The history drawer lists earlier chats for the active subject by the first learner question and last activity time. Selecting an entry restores that transcript; the all-subjects “Continue learning” action opens the most recently used saved conversation.
- Existing subject-tagged lines are moved from the older shared transcript into a legacy history entry the first time each subject is opened. This retains earlier Mathematics and Geography & Economics pilot chats and gives remaining subjects the same history behavior.
- Tutor follow-up checks are scoped per subject, so an unanswered check in one subject cannot carry into another. Topic mastery remains profile-wide. Offline queued replies retain their originating subject and conversation.
- The history controls and labels support English, Hindi, and Odia; the history drawer adapts to mobile layout.

Files for this pass: `apps/web/src/chat.tsx`, `apps/web/src/styles.css`, `apps/web/src/icons.tsx`, `apps/server/src/app.ts`, `apps/server/src/db.ts`, `apps/server/src/tutor/run.ts`, and this change log.

## Collapsible subject sidebar

- Added an arrow control above the subject navigation to hide or restore the full sidebar, giving the subject overview and tutor chat the available screen width while collapsed.
- Kept the expand arrow visible at the left edge so navigation can be restored from either dashboard view; the selected subject and open chat remain unchanged when toggled.
- Persisted the learner's collapse preference locally and added accessible, localized labels in English, Hindi, and Odia.
- Adapted the toggle to mobile layout, where it sits above the horizontal subject links and leaves the dashboard content unobstructed when collapsed.
- Removed the toggle's permanent border and filled button background, and placed it in its own row above the subject links so the arrow is visually separate from “All subjects.”

Files for this pass: `apps/web/src/chat.tsx`, `apps/web/src/styles.css`, and this change log.

- Refined the collapse control to use a simple left chevron, matching the expand control's icon style while preserving the existing expand appearance.

## Mathematics welcome rollback and chat composer spacing

- Reverted the Mathematics-only welcome panel and numbered quick-start cards at the learner's request. Mathematics is back on the original shared chat welcome and suggestion layout; history and New chat remain available.
- Removed the solid footer background and top divider behind the dashboard composer, then raised the question field and camera/microphone controls slightly by adding a small bottom gap. The controls and their behavior are unchanged.

Files for this pass: `apps/web/src/chat.tsx`, `apps/web/src/styles.css`, and this change log.

## Login page background artwork

- Replaced the standalone left-panel illustration with the user-provided “Multilingual AI Learning Across India” artwork as the full login-page background.
- Added the user-provided “Pastel Countryside Valley Sky” artwork as the background on narrow portrait screens; landscape screens retain the wide artwork.
- Positioned the artwork's open right side behind the existing login form, using cover sizing without distorting the image.
- Kept the Setu logo lockup and the right-side login form markup and interactions unchanged. Registration continues to use its existing layout.
- Converted the supplied PNG to an optimized JPEG for use as a web background.

Files for this pass: `apps/web/public/multilingual-ai-learning-bg.jpg`, `apps/web/public/pastel-countryside-portrait.jpg`, `apps/web/src/product.tsx`, `apps/web/src/styles.css`, and this change log.
