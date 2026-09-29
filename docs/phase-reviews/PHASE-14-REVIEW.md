# Phase 14 Review — UI/UX Polish

## Phase

Phase 14 — UI/UX Polish (`docs/05-DEVELOPMENT-PLAN.md`). Started on the user's instruction "do step 1 then step 2 then continue with START PHASE 14":
1. Phase 13B committed (`cfb6944`).
2. The 13B follow-up committed (`d320ea2`).
3. Phase 14 started.

## Objective

A design-system refinement pass across all screens against the `04-UI-UX.md` §9 checklist, plus:
- a responsive and accessibility pass;
- an animation audit;
- a performance pass (bundle size, render cost).

Delivers `NFR-A11Y-001..004` and `NFR-PERF-003`.

## Implemented

- **Contrast as a test** (`src/lib/contrast.test.ts`, `src/lib/contrast.ts`). It checks every foreground/background pair the components use against WCAG 2.1 AA, in both themes:
  - text 4.5:1;
  - focus rings and input borders 3:1.
  - It also checks that the two dark-theme blocks in `globals.css` match.
  - Seven pairs failed and were moved to the nearest passing shade: light `--subtle`, `--success`, and `--border-strong`; dark `--primary` and `--border-strong`.
  - A new `--danger-foreground` token replaces `text-white` on danger surfaces (the notification badge, the danger button).
- **An axe scan of every screen** (`e2e/accessibility.spec.ts`, `@axe-core/playwright` as a dev dependency). Each screen is scanned as its role, in light and dark, against WCAG 2.1 A and AA, after its data has loaded: signed-out pages, the patient portal (12 screens), and every staff workspace (34 screen/role combinations).
  - Fixed:
    - links inside text are underlined (1.4.1);
    - the hidden file inputs are out of the tab order and the accessibility tree, since the visible button is the control;
    - chart drawings no longer contain focusable elements inside `aria-hidden` (Recharts `accessibilityLayer={false}`; the `figcaption` is the text alternative);
    - the table scroll box is focusable and named;
    - the dark-theme badge contrast.
- **Keyboard (NFR-A11Y-001):**
  - a "Skip to main content" link, and a focusable `main`;
  - **every dialog returns focus where it opened from** (`hooks/use-return-focus.ts`). Our 7 dialogs open from state, with no `Dialog.Trigger`, so Radix had nothing to restore to and focus fell to the top of the page.
  - Playwright covers keyboard-only sign-in, the skip link, and a dialog's focus trap, Escape, and focus return.
- **Responsive:** tablets (768–1024 px) get an icon rail, with names kept for screen readers and shown on hover (§2.4, §4); desktops keep the full sidebar. Tested at 820 px and 1280 px.
- **Motion (§7), all CSS, and framer-motion removed:**
  - a 150 ms route fade (`template.tsx` in the staff and portal groups);
  - a badge animation only when a status changes in place;
  - the dashboard's first-load stagger and toast enter/exit as keyframes.
  - The global reduced-motion rule disables everything.
- **Never colour alone (NFR-A11Y-002):** low stock in the medicine list now shows a word and an icon. `Panel` is a named region.
- **Performance:**
  - framer-motion was a 40 kB (gzip) chunk on most staff screens; removing it cut 41–43 kB from 20 routes, and the largest first load dropped from 250 to 207 kB;
  - **NFR-PERF-003:** the four API list reads with no bound (sessions; a patient's allergies, vaccinations, family history) are capped (50 and 200, newest first).
- **Visual fixes found in screenshot review:**
  - The weekly-hours time inputs clipped the browser's AM/PM segment, so 13:00 appeared as "01:00". The columns are wider now, and two per row below 1280 px.
  - The exception form's select was truncated; it's now one field per row.
- **Test harness:** the browser suite resets the rate limiter before each test, and the gate run uses production builds (D-043).

## Requirements Verified

| ID | Status | Evidence |
| --- | --- | --- |
| NFR-A11Y-001 (keyboard, visible focus) | Verified | Playwright: keyboard-only sign-in, skip link to `main`, dialog focus trap/Escape/return (failed before the fix). axe: no keyboard-trap, focusable-hidden, or scrollable-region violations on any screen. `:focus-visible` ring on every control (unchanged) |
| NFR-A11Y-002 (not colour alone) | Verified | Status badges carry words and icons (unchanged); low stock now has a word and an icon; axe `link-in-text-block` clean; a manual sweep of every `text-{tone}` use |
| NFR-A11Y-003 (accessible form errors) | Verified | `FormField` wires `aria-describedby`/`aria-invalid` (unchanged); form-level errors are `role="alert"`; axe `label` and `aria-*` rules clean on every form screen, including open forms |
| NFR-A11Y-004 (AA contrast) | Verified | `contrast.test.ts`: 59 pair checks in both themes; axe `color-contrast` clean on every screen in both themes |
| NFR-PERF-003 (bounded lists) | Verified | A static scan of every `findMany` without `take`: all remaining ones are bounded by a parent id or the request's own ids, or run in nightly jobs. The four API-facing ones are capped. Backend suite 346/346 |
| §9 checklist | Reviewed | Screenshots at 390, 820, 1100, 1440 px and in dark mode for the changed screens; the axe scan covers structure on every screen |

## Files/Modules Changed

- **Frontend (new):**
  - `src/lib/contrast.ts` and its test;
  - `src/hooks/use-return-focus.ts`;
  - `src/components/shared/page-transition.tsx`;
  - `app/(dashboard)/dashboard/template.tsx`, `app/(portal)/portal/template.tsx`;
  - `e2e/accessibility.spec.ts`.
- **Frontend (changed):**
  - `globals.css` (tokens, `--danger-foreground`, in-text link underline, keyframes);
  - `app-shell.tsx` (skip link, tablet rail, drawer focus return);
  - `panel.tsx` (named region, CSS reveal, `PanelRow` markup);
  - `toaster.tsx` (CSS enter/exit);
  - `status-badge.tsx` (change animation);
  - `confirm-dialog.tsx` and `notification-panel.tsx` (focus return);
  - `data-table.tsx` (focusable scroll region);
  - `ui/button.tsx` (danger foreground);
  - the charts (`accessibilityLayer={false}`);
  - `history-panels.tsx` and `practice/page.tsx` (file inputs, layout);
  - the appointment and portal dialog pages (focus return);
  - `medicines/page.tsx` (low stock);
  - `e2e/fixture.ts` (`resetRateLimits`) and a `beforeEach` in each spec;
  - `e2e/staff-journey.spec.ts` (race fix);
  - `package.json` (`@axe-core/playwright` added, `framer-motion` removed).
- **Backend (changed):** `emr/patient-clinical.service.ts`, `auth/services/token.service.ts` (list caps).
- **Docs:** listed below.

## Tests Executed

- **Frontend:** typecheck, lint, Vitest (`contrast.test.ts` added).
- **Playwright:** the whole suite (47 tests) against production builds of both apps. The axe scan covers signed-out, portal, and all staff roles, in both themes.
- **Backend:** typecheck, lint, unit tests, and the full e2e suite.
- **Build:** the production frontend image, three times (baseline, after removing framer, after the fixes), with first-load sizes compared route by route.
- **Visual:** screenshots of the tablet rail, dark dashboard and encounter, the practice form at 1100 and 1440 px, the skip link, and the dashboard lists.

## Test Results

- **Vitest 140/140**, including 59 contrast checks. The first contrast run failed 7 pairs; all 7 were fixed.
- **Playwright 47/47** on production builds (3.6 min): 9 accessibility, 17 dashboards, 14 portal, 3 follow-up, 2 journey, 2 mobile. The first axe run found 5 violation types across 4 of 6 scan groups; all were fixed and the rerun is clean.
- **Backend e2e 346/346, 18/18 suites.** Unit 5/5.
- **Bundle:** 20 routes are 41–43 kB smaller and none grew; the largest first load went from 250 to 207 kB.
- **Cleanup:** 0 fixture users or hospitals left; no stray files.

## Security Review

- No authorization, tenancy, or data-shape change. The only backend edits are list caps, which narrow responses.
- **The rate-limit reset is test-only** (Playwright `beforeEach`, like the backend suite's setup file). The production limiter is unchanged and tested in `rate-limit.e2e-spec.ts`.
- **`@axe-core/playwright` is a dev dependency,** never shipped. Removing `framer-motion` shrinks the shipped code.
- **Skip link and focus handling:** no new data exposure; the hidden file inputs are still validated by the API.

## UI/UX Review

- **§3 accessibility:** semantic regions, visible focus, keyboard operability (now tested), polite live regions (unchanged), AA contrast (now tested), labelled icons.
- **§4 responsive:** phone drawer (unchanged, now returns focus); tablet icon rail (new); desktop sidebar.
- **§7 motion:**
  - transitions: the route fade;
  - state changes: the badge;
  - hierarchy: the first-load stagger;
  - feedback: toasts;
  - loading: the shimmer (unchanged).
  - Nothing is decorative, and all motion is off under reduced motion.
- **§9 checklist:** one primary action per view (unchanged), token-consistent spacing and colour, loading/empty/error/success states (unchanged).
- **Native time inputs follow the browser's locale.** On this machine 13:00 shows as "01:00 RAAT"; the stored and submitted values are 24-hour.

## Bugs Found

1. **Seven token pairs failed WCAG AA:**
   - light `subtle` on muted surfaces (4.35:1);
   - light `success` on its badge surface (4.46:1);
   - dark `primary` on the active-nav surface (4.43:1);
   - `border-strong` in both themes (1.5–1.9:1, where input borders need 3:1).
2. **White text on danger in the dark theme (2.8:1),** on the notification badge and the danger button.
3. **Axe findings:**
   - a link inside text told apart by colour alone;
   - unlabelled file inputs;
   - focusable chart internals inside `aria-hidden`;
   - an unreachable table scroll box.
4. **Focus was lost after closing any of the 7 state-opened dialogs** (it fell to the top of the page).
5. **No skip link, and the tablet sidebar wasn't collapsed** (§2.4, §4).
6. **Four API list reads had no bound** (NFR-PERF-003).
7. **The weekly-hours time inputs hid AM/PM,** so 13:00 read as 01:00. The exception select was truncated.
8. **Test harness:**
   - the browser suite exhausted the auth rate limiter once the axe scan was added;
   - dev-server runs failed on on-demand compiles (10–15 s under memory pressure) and on API watch restarts;
   - a journey step branched on a non-waiting `isVisible()`.

## Fixes Applied

1. Nearest passing shades, enforced by `contrast.test.ts` in both themes.
2. The `--danger-foreground` token.
3. Link underline in running text, file inputs taken out of the tab order, `accessibilityLayer={false}`, and a focusable, named scroll region. The axe rerun is clean.
4. `useReturnFocus` on all 7 dialogs; the Playwright test failed before this fix and passes after.
5. A skip link, focusable `main`, and the tablet icon rail, each tested.
6. Caps of 50 sessions and 200 clinical rows, newest first. The backend suite passes.
7. Wider time columns (two per row below 1280 px), and a single-column exception form. Checked by screenshot.
8. Test harness:
   - `resetRateLimits` before each browser test;
   - the gate run on production builds;
   - the journey waits for the status badge before deciding.
   - Recorded in `CLAUDE.md` and D-043.

## Regression Checks

- **Playwright 47/47 after the last change,** on production builds. It covers every journey from Phases 12, 13, and 13B (the portal on the new shell and templates, dashboards with the new `PanelRow` markup, dialogs with focus return, and the practice form's new layout).
- **Backend 346/346** after the list caps: the portal's clinical lists and the sessions list still return their rows.
- **Build:** the production image builds, and no route grew.

## Known Minor Issues

- **Native time inputs display in the browser's locale** (a 12-hour clock with that locale's day-period words). Values are 24-hour and correct, but the display isn't controlled by the app.
- **The 25 kB zod chunk remains on form screens.** `zod/mini` was rejected for now (D-043).
- **Axe scans each screen's loaded state plus the keyboard-tested dialog,** not every open form or error state. Form error wiring is covered by `FormField`'s component tests.
- **Carried:**
  - live Stripe/Razorpay and Resend/Twilio UNVERIFIED;
  - the attachment row created before upload (13B follow-up);
  - Super Admin hospital switcher and Nurse medication checklist (scoped out);
  - Playwright in CI (Phase 16).

## Technical Debt

- `lib/appointment-actions.ts` still copies the API's state machine (from 13B).
- `FREQUENCY_LABEL` lives in a component module (from 13B).
- **Carried:**
  - audit-log writes outside interactive transactions (Phase 15);
  - Socket.IO handshake rate limiting;
  - provider error-classification tests;
  - analytics caching (still no measured need).

## Documentation Updated

- `11-DECISIONS.md`: D-043.
- `04-UI-UX.md`: §7 (CSS motion) and §3 (as built).
- `03-ARCHITECTURE.md`: §2 "As implemented in Phase 14".
- `10-TESTING-STRATEGY.md`: the accessibility spec and contrast test.
- `CLAUDE.md`: +4 conventions (tokens and contrast test, dialog focus return, no animation library, running Playwright on production builds).
- `HANDOFF.md`.

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES.**

`NFR-A11Y-001..004` and `NFR-PERF-003` are verified by automated checks that now run with the suite: the contrast test, the axe scan of every screen in both themes, the keyboard tests, and the bounded-read scan. The first-load bundle is 41–43 kB lighter on 20 routes. The full browser suite (47/47, on production builds) and the backend suite (346/346) pass after the last change. No critical or high-severity issue is open.

The minor items are the locale-driven time display, the remaining zod chunk, and the carried items.

Phase 15 doesn't start until the user says so.
