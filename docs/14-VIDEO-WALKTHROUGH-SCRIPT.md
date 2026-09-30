# Video Walkthrough Script — MedCore HMS

**Target runtime:** 5–8 minutes (brief requirement). This script totals ~7:15 read at a natural pace — trim the analytics or security section first if running long; both are marked optional-to-shorten below.

**Prerequisite:** run the full stack against production builds, not dev servers (`CLAUDE.md`'s standing rule — dev servers on this machine produce visible loading jank that reads badly on camera): `docker build -f infrastructure/docker/Dockerfile.frontend --target runtime -t medcore-hms-frontend-prod . && docker run -p 3000:3000 -e HOSTNAME=0.0.0.0 medcore-hms-frontend-prod`, and in `apps/backend`, `pnpm run build && pnpm exec dotenv -e ../../.env -- node dist/main.js`. Seed fresh demo data first (`pnpm run db:seed && pnpm run db:seed:history`) so dashboards aren't empty. Recording resolution: 1920×1080 minimum; the staff workspace is a dense clinical tool, not a mobile-first app, so don't record at a narrow width.

Two browser windows/profiles side by side (or fast alt-tabbing) makes the "two people see this happen live" beats (notifications, four-eyes approval) much clearer than narrating them.

Accounts used below (see `README.md` "Demo Credentials" for the complete list; password `Demo123!` for everyone): `hospitaladmin@medcore-city.medcore.test`, `dr.wade.weimann@medcore-city.medcore.test` (adjust to whichever doctor your seed actually names), `receptionist@medcore-city.medcore.test`, `lab_technician@medcore-city.medcore.test`, `lab_reviewer@medcore-city-hospital.medcore.test`, `pharmacist@medcore-city.medcore.test`, `accountant@medcore-city.medcore.test`, `superadmin@medcore.test`, and one seeded patient (pick any `*@patient.medcore.test`).

---

## 0:00–0:30 — Intro

**Screen:** a static title slide or the login page.

**Say:** "This is MedCore HMS — a multi-tenant Hospital Management Platform I built end to end: NestJS API, Next.js frontend, PostgreSQL, Redis, and Docker, following a strict phase-gated build across 17 phases. It's a real, working product — every screen you're about to see is backed by a real API call, real validation, and real role-based access control, not a mockup. Let's walk through a full patient journey, then a few of the platform's harder engineering problems."

---

## 0:30–1:15 — Login and role-based dashboards

**Screen:** login page → Hospital Admin dashboard.

**Do:** Sign in as `hospitaladmin@medcore-city.medcore.test`. Land on the admin dashboard.

**Say:** "Nine distinct roles across the platform, each with their own dashboard and their own navigation — a nurse never even sees a billing link in their sidebar, and the API enforces the same boundary independently of what the UI shows. This is the Hospital Admin's view: today's appointment volume, revenue, and occupancy, all computed live from the database."

**Do:** Quick sign-out, sign back in as the doctor (`dr.wade.weimann@...`). Show the doctor's dashboard (today's schedule, lab results panel).

**Say:** "Same login screen, completely different dashboard for a doctor — today's patient list and any lab results waiting on their review."

---

## 1:15–2:15 — Front desk: register and book

**Screen:** sign in as `receptionist@medcore-city.medcore.test`.

**Do:**
1. Navigate to Patients → Register New Patient. Fill a short realistic form (name, DOB, phone, email — make one up on the spot, it's a demo).
2. Save. Land on the new patient's profile.
3. Book an appointment: pick the doctor from step 0:30, pick an open slot from their availability grid.

**Say:** "Registration and booking both go through full server-side validation — not just the frontend form. The availability grid you're seeing is computed from the doctor's actual weekly schedule and any day-off exceptions, converted correctly for the hospital's local timezone — an easy bug to introduce if you naively treat a 9am slot as UTC, which is exactly what this system doesn't do."

---

## 2:15–3:30 — The doctor's encounter: vitals, notes, prescription, lab order

**Screen:** switch to the doctor's session. Open the appointment just booked (or any of today's).

**Do:**
1. Start the visit / encounter.
2. Record vitals (BP, pulse, temperature — whatever the form asks).
3. Add a clinical note.
4. Prescribe a medicine (pick one from the catalog, set dosage/frequency).
5. Order a lab test.
6. Complete the encounter.

**Say:** "This is the core clinical workflow. The medical record is append-only by design — once a doctor signs a note, it can't be edited or deleted, only appended to, which matters for an audit trail in a real clinical setting. The prescription and lab order both automatically create billing line items behind the scenes — nobody has to remember to bill for them separately."

---

## 3:30–4:15 — Lab: four-eyes approval (the two-account beat)

**Screen:** two sessions — `lab_technician@...` and `lab_reviewer@...`.

**Do:**
1. As the lab technician: find the order just created, mark the sample collected, enter a result.
2. Try to approve it yourself — **show that the Approve button either doesn't appear or the API refuses it** (the same person who entered a result can't approve it).
3. Switch to the second lab tech account: approve the result.

**Say:** "Four-eyes approval — a lab result can't be approved by the same person who entered it. This is enforced on the backend, not just hidden in the UI; even a direct API call from the entering technician's own session is refused. Once approved, the doctor and patient are both notified in real time — no page refresh needed."

*(Optional: briefly show the real-time notification badge updating live in the doctor's session, via Socket.IO, to make the "no refresh needed" claim visible.)*

---

## 4:15–4:45 — Pharmacy: dispensing

**Screen:** `pharmacist@medcore-city.medcore.test`.

**Do:** Find the prescription, dispense it.

**Say:** "Dispensing pulls stock from the earliest-expiring batch first — FIFO by expiry, not by which batch was received most recently — and the system tracks expiry and low-stock thresholds automatically, alerting the pharmacist and admin exactly once per crossing of the reorder point, not on every page load."

---

## 4:45–5:30 — Billing: automatic charges, finalize, cash payment

**Screen:** `accountant@medcore-city.medcore.test` (or receptionist, if billing is also in their scope).

**Do:**
1. Open the patient's invoice — show the consultation, prescription, and lab charges already there automatically.
2. Finalize the invoice.
3. Take a cash payment.

**Say:** "Every one of these line items appeared without anyone manually adding a billing entry — the consultation, the prescription, and the lab order each triggered their own charge the moment they happened, all inside the same database transaction as the clinical action, so billing can never silently drift from what actually happened clinically."

---

## 5:30–6:15 — Patient portal

**Screen:** sign in as the patient from step 1:15 (or any seeded patient with history).

**Do:** Show the visit record, the prescription (download the PDF), the approved lab result with its reference-range flag, and the invoice (now paid).

**Say:** "And the patient sees all of this themselves, self-service, the moment it's ready — their visit history, a downloadable prescription PDF, lab results with abnormal values flagged automatically against reference ranges, and their bill."

---

## 6:15–6:45 — Analytics (optional — trim if running long)

**Screen:** back to Hospital Admin or Super Admin.

**Do:** Show the revenue/appointments/occupancy charts, and the global search (search for the patient by name from the top bar).

**Say:** "Role-specific analytics dashboards, and a global search that only searches within what that role is allowed to see — a receptionist can't search medicines, a pharmacist can't search other patients' billing."

---

## 6:45–7:15 — Security in one demo (optional — trim if running long)

**Screen:** attempt a cross-tenant or cross-role action.

**Do (pick one, whichever is fastest to show):**
- As a staff member from Hospital A, try to open a patient/appointment URL belonging to Hospital B by editing the ID in the address bar → show a 404, not the data.
- As a nurse, try to navigate directly to a billing URL → show it's refused, both in the UI and (open dev tools Network tab briefly) at the API level with a 403.

**Say:** "Two hospitals share this exact deployment, and their data is completely isolated — not just hidden in the UI, but refused at the database query level itself, independently, twice over. This is the single most important guarantee in a multi-tenant system, and it's tested automatically on every code change, not just checked by hand."

---

## 7:15–7:30 — Close

**Say:** "That's MedCore HMS — full patient journey, role-based access control, real-time updates, and tenant isolation, all backed by an integration-tested, CI-checked codebase. Thanks for watching."

---

## Recording checklist

- [ ] Fresh seed data (`pnpm run db:seed && pnpm run db:seed:history`) — empty dashboards look bad on camera.
- [ ] Production builds running, not dev servers (see Prerequisite above).
- [ ] Close any browser extensions/bookmarks bar that would reveal personal information on screen.
- [ ] Test the microphone/audio levels before the full take — re-recording an 8-minute walkthrough for an audio issue is avoidable.
- [ ] Have both accounts for the four-eyes lab beat (§3:30) already logged in, in two windows, before recording starts — fumbling a second login live wastes time.
