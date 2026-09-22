# UI/UX Design Document — MedCore HMS

**Version:** 1.0
**Status:** Approved for Phase 1 (refined further in Phase 14)
**Related documents:** `01-PRD.md`, `03-ARCHITECTURE.md`

## 1. Design Principles

MedCore HMS must read as software a real hospital's IT department procured, not as a generated dashboard template. Five principles govern every screen:

1. **Clinical, not decorative.** Every pixel earns its place by helping a busy clinician or admin complete a task faster. No hero sections, no marketing-style gradients, no illustration filler.
2. **Information-dense but not cluttered.** Hospital staff scan tables and timelines all day; density is a feature, achieved through disciplined typography and spacing, not by shrinking touch targets.
3. **Status is always legible.** Appointment, lab, prescription, and invoice states are named in words and reinforced with an icon/colour pairing — never colour alone.
4. **Role-specific, not role-decorated.** A Doctor's dashboard and a Receptionist's dashboard share components and tokens but are laid out around genuinely different jobs to be done (§7).
5. **Motion explains, it doesn't perform.** Animation is used only to communicate a state change, hierarchy, or transition (§10) — never as ambient decoration.

Reference points named in the brief — Practo's doctor portal, Epic's Hyperspace — are used as interaction references for encounter workflows and appointment timelines, translated into an original visual language, not copied.

## 2. Design System Foundations

### 2.1 Color System

A restrained clinical palette: a desaturated blue as the primary/brand hue (trust, calm, matches the "medical software" register without becoming sterile-white), a neutral gray scale for structure, and semantic colours reserved strictly for status:

| Token                     | Light          | Dark          | Usage                                             |
| ------------------------- | -------------- | ------------- | ------------------------------------------------- |
| `--color-primary`         | `#0A2A5E`      | `#5B8DEF`     | Primary actions, active nav, links                |
| `--color-primary-surface` | `#E3F0FC`      | `#132A4D`     | Selected rows, active tab background              |
| `--color-neutral-900..50` | grayscale ramp | inverted ramp | Text, borders, surfaces                           |
| `--color-success`         | `#1B7F4C`      | `#4ADE80`     | Completed, Paid, Approved                         |
| `--color-warning`         | `#B45309`      | `#FBBF24`     | Pending, Low stock, Out-of-range (borderline)     |
| `--color-danger`          | `#B91C1C`      | `#F87171`     | Cancelled, Expired, Critical out-of-range, Errors |
| `--color-info`            | `#1D4ED8`      | `#60A5FA`     | In-progress, informational banners                |

Colour tokens are defined once as CSS variables and consumed by Tailwind's theme extension — never hard-coded hex values in components. Dark mode is a supported, not an afterthought: every token has a dark-mode pair from day one.

### 2.2 Typography

- **Font:** Inter (UI text) — high legibility at small sizes, wide language coverage, free.
- **Scale:** a 4-step type scale for data-dense UI (`xs 12px / sm 13px / base 14px / lg 16px`) plus larger steps reserved for page titles and empty-state messaging (`xl 20px / 2xl 24px`). Body defaults to `14px`/`base` — hospital software runs dense, not blog-sized.
- **Weight:** 400 for body, 500 for emphasis/labels, 600 for headings — never more than three weights in the system.

### 2.3 Spacing & Layout

- 4px base unit; spacing scale `4/8/12/16/24/32/48`.
- Page content max-width constrained on wide monitors for tables/forms (~1440px) to avoid unreadable line lengths, while dashboards use full width for chart grids.
- Consistent 16px gutter on mobile, 24px on tablet/desktop.

### 2.4 Navigation & Sidebar

- Persistent left sidebar (desktop/tablet) with role-scoped nav items only — a Pharmacist never sees an "EMR" nav entry, not even disabled; unreachable destinations are omitted, not greyed out.
- Sidebar collapses to icon-only on tablet, converts to a bottom-sheet/drawer on mobile (patient portal only — staff tools are desktop-first per §9).
- A persistent top bar carries global search, notification bell (live unread count via socket), and the account/hospital switcher (Super Admin only).

### 2.5 Component Strategy

Built on shadcn/ui primitives (Radix-based, accessible by default) with a MedCore-specific composition layer in `components/shared/` — `DataTable`, `StatCard`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `PageHeader`. Feature components live in `components/modules/` (`AppointmentCard`, `PrescriptionForm`, `VitalsPanel`). `components/ui/` (raw shadcn output) is never hand-edited — customisation happens through the Tailwind theme and composition, so `shadcn add` upgrades stay clean.

### 2.6 Table Patterns

Every data table shares: sticky header, column sort, server-side pagination (never client-side pagination of an unbounded list), a filter bar above the table, row-level status badges, and a consistent empty/loading/error state slot (§2.8–2.10). Row density defaults to "comfortable" for clinical tables (EMR, prescriptions) and "compact" for high-volume operational tables (billing line items, medicine batches).

### 2.7 Form Patterns

React Hook Form + Zod, validated on blur and on submit (not on every keystroke — that reads as nagging). Every field shows its error inline below the input, in red text plus an icon, with `aria-describedby` wired to the error. Multi-step forms (patient registration, appointment booking) show a persistent step indicator, never a modal-within-modal.

### 2.8 Modal / Dialog Patterns

Dialogs are reserved for focused, short-lived tasks (confirm cancellation, quick edit) — anything requiring more than ~2 fields or multiple steps is a dedicated page or a slide-over panel instead. Destructive actions always route through `ConfirmDialog` with the consequence stated in plain language ("This cancels the appointment and notifies the patient by SMS."), never a bare "Are you sure?".

### 2.9 Notification Patterns

In-app notifications appear as a bell-icon badge (top bar) plus a slide-over panel listing recent events, and as transient toasts only for actions the current user just took (e.g. "Invoice finalised") — never for background events unrelated to the current screen, which would be noisy for a clinician mid-encounter.

### 2.10 Loading / Empty / Error / Success States

Every data-bearing view defines all four explicitly — this is treated as a component contract, not an afterthought:

- **Loading:** skeleton shapes matching the eventual content's geometry (never a generic spinner for list/table views); a spinner is acceptable only for button-level in-flight state.
- **Empty:** a short explanation plus the relevant primary action (e.g. Doctor's appointment list, empty: "No appointments today" + nothing further needed; Patient list, empty on first hospital setup: "No patients yet" + "Register a patient" button). Never a bare "No data."
- **Error:** human-readable message derived from the API error envelope's `code`, with a retry action where retrying is meaningful.
- **Success:** confirmation is inline/toast for quick actions, and a dedicated confirmation screen for consequential ones (payment completed, appointment booked) — enough to feel conclusive without demanding a dismiss click before continuing.

## 3. Accessibility Guidelines

- Semantic HTML first (`<table>`, `<button>`, `<nav>`, `<dialog>`) — ARIA is a supplement, not a replacement, per WAI-ARIA authoring practice.
- Full keyboard operability: tab order follows visual order, all custom components (comboboxes, date pickers) support arrow-key navigation per their Radix primitive's default behaviour.
- Visible focus rings on every interactive element, never `outline: none` without a replacement.
- Status announcements (toasts, form errors, async completion) use `aria-live="polite"` regions.
- Minimum WCAG 2.1 AA contrast for all text and meaningful icons.
- Every image/icon conveying information (not purely decorative) has an accessible label.

## 4. Responsive Behaviour

| Breakpoint   | Target  | Notes                                                                                                                                |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `< 640px`    | Mobile  | Patient portal fully supported; staff tools show a "best on larger screens" notice but remain functionally usable for quick lookups. |
| `640–1024px` | Tablet  | Staff tools usable for rounds/bedside use (nurse vitals entry, doctor quick lookup); sidebar collapses to icons.                     |
| `> 1024px`   | Desktop | Primary target for all staff workflows; full table/dashboard density.                                                                |

Per the brief and PRD, hospital staff primarily use larger screens, so staff-facing density is optimised for desktop first; the patient portal is designed mobile-first and progressively enhanced upward, since patients predominantly use phones.

## 5. Dashboard Patterns (by role)

Each dashboard is built from the same `StatCard`/`ChartCard`/`ListPanel` primitives but arranged around that role's actual first-hour-of-shift questions:

- **Doctor:** today's appointment timeline (colour + text status), patient quick-search, pending lab-approval widget, mini follow-up calendar, recent prescriptions.
- **Hospital Admin:** KPI row (patients today, revenue today, occupied beds, active doctors), 7-day appointment volume chart, department occupancy heat map, low-stock alerts, recent audit activity.
- **Nurse:** ward/bed occupancy board, today's vitals-due list, medication administration checklist.
- **Receptionist:** today's schedule across all doctors, walk-in registration shortcut, pending draft invoices.
- **Lab Technician:** queue of orders by status (`ORDERED → APPROVED`), urgent-flagged orders surfaced first.
- **Pharmacist:** pending prescriptions to dispense, low-stock and expiring-soon panels, batch lookup.
- **Accountant:** revenue/collections summary, outstanding invoices, payment reconciliation queue.
- **Patient:** upcoming appointment, latest prescription/report, outstanding invoice — a short, calm summary, not an operational console.

## 6. Role-Specific UX Priorities

Restated from the PRD as a UX contract — each role's primary navigation surfaces exactly these first:

- **Doctor** → Appointments, Patient lookup, Encounter workflow, EMR, Prescriptions, Lab orders, Availability.
- **Receptionist** → Registration, Scheduling, Billing, operational queue.
- **Pharmacist** → Prescriptions to dispense, Stock, Batches, Expiry.
- **Patient** → Appointments, Records, Reports, Prescriptions, Invoices, Payments.

No two staff roles receive the same dashboard with swapped labels; each is a distinct information architecture sharing only the design system.

## 7. Micro-Interaction & Animation Guidelines

Framer Motion is used exclusively for:

- **Transitions:** route/page transitions are a short (150–200ms) fade/slide, signalling navigation without disorienting.
- **Feedback:** button press states, form-field success flash, drag/drop reorder (medicine batch priority, if used).
- **Hierarchy:** staggered reveal of dashboard cards on first load only (not on every refetch) to establish reading order once.
- **State changes:** status badge transitions (e.g. `PENDING → CONFIRMED`) animate the badge, not the whole row, so the eye catches exactly what changed.
- **Loading:** skeleton shimmer, progress indicators for multi-step async flows (PDF generation, payment processing).
- **Navigation:** sidebar expand/collapse, slide-over panels.

Explicitly rejected: parallax, decorative background motion, auto-playing carousels, bouncing/elastic easing on anything clinical. Every animation respects `prefers-reduced-motion`.

## 8. Confirmation Patterns

Any action with a real-world or clinical consequence (cancel appointment, finalise invoice, dispense medicine, approve lab result, revoke session) requires an explicit confirmation step stating the consequence in plain language. Purely additive, reversible actions (save draft, add line item) do not require confirmation — confirmation fatigue is itself a usability failure.

## 9. Frontend Quality Bar (Working Checklist)

Applied to every significant screen before it is considered done, per the master build prompt's frontend design quality gate:

- [ ] Visual hierarchy — one clear primary action per view
- [ ] Spacing/typography consistent with the token system
- [ ] Responsive at the breakpoints in §4
- [ ] Keyboard-operable end to end
- [ ] Loading / empty / error / success states all implemented (§2.10)
- [ ] Appropriate data density for the role and device
- [ ] No animation used purely decoratively
