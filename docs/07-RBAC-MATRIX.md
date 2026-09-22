# RBAC / Permissions Matrix — MedCore HMS

**Version:** 1.0
**Status:** Approved for Phase 3
**Related documents:** `02-SRS.md` §2.2, `03-ARCHITECTURE.md` §5, `08-API-CONTRACT.md`, `09-SECURITY.md`

## 1. Enforcement Model

RBAC is enforced server-side by a `RolesGuard` reading a `@Roles(...)` decorator on every controller method; a route with no decorator denies all roles by default (`FR-RBAC-001`). This matrix is the spec the guard's decorators are written against and the spec the authorization integration tests are written against — the two must never silently diverge. Frontend navigation/UI hiding mirrors this matrix for UX only and carries zero security weight (`FR-RBAC-002`).

Legend: `✅` full access · `🟡` scoped/partial (see note) · `⛔` no access.

## 2. Roles

`SUPER_ADMIN` (SA) · `HOSPITAL_ADMIN` (HA) · `DOCTOR` (DOC) · `NURSE` (NUR) · `RECEPTIONIST` (REC) · `LAB_TECHNICIAN` (LAB) · `PHARMACIST` (PHM) · `ACCOUNTANT` (ACC) · `PATIENT` (PAT)

All roles except `SUPER_ADMIN` are scoped to exactly one `hospitalId`, resolved from the JWT, never from a request parameter (`FR-TENANT-001`).

## 3. Permission Matrix by Module

### 3.1 Platform / Hospital Management

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Create/verify hospital | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| List all hospitals | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| View/update own hospital settings | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Manage departments | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Manage rooms/beds | 🟡 any | ✅ own | ⛔ | 🟡 read/update bed status only | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Create/manage staff accounts | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Platform-wide analytics | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Hospital-level analytics | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 🟡 own, financial only | ⛔ |

### 3.2 Users & Profiles

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| View own profile (`/auth/me`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update own profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View any staff profile | ✅ | 🟡 own hospital | 🟡 own hospital, own dept | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Create doctor profile | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Register a patient | 🟡 any | ✅ own | ⛔ | ⛔ | ✅ own | ⛔ | ⛔ | ⛔ | 🟡 self-registration only |
| View patient directory (list/search) | 🟡 any | ✅ own | ✅ own hospital | ✅ own hospital | ✅ own hospital | ⛔ | ⛔ | 🟡 own hospital, billing view | ⛔ |
| View a specific patient's demographic profile | 🟡 any | ✅ own | ✅ own hospital | ✅ own hospital | ✅ own hospital | 🟡 order context only | 🟡 dispensing context only | 🟡 billing context only | ✅ self only |

### 3.3 Appointments

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Set/update own availability | ⛔ | ⛔ | ✅ self | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| View doctor availability (for booking) | ⛔ | ✅ own hospital | ✅ self | ✅ own hospital | ✅ own hospital | ⛔ | ⛔ | ⛔ | ✅ own hospital |
| Book appointment | ⛔ | ⛔ | ⛔ | ⛔ | ✅ on behalf of patient | ⛔ | ⛔ | ⛔ | ✅ self |
| Update appointment status | ⛔ | 🟡 own hospital, admin override | ✅ own appointments | 🟡 check-in only | ✅ own hospital | ⛔ | ⛔ | ⛔ | 🟡 cancel own, pending only |
| View appointment list | 🟡 any | ✅ own | ✅ own only | ✅ own hospital | ✅ own hospital | ⛔ | ⛔ | ⛔ | ✅ self only |
| Create emergency appointment | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |

### 3.4 EMR / Clinical

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Create medical record (start encounter) | ⛔ | ⛔ | ✅ own encounter | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Read medical record | ⛔ | ⛔ | ✅ own hospital | ✅ own hospital | ⛔ | ⛔ | ⛔ | ⛔ | ✅ self only |
| Add addendum | ⛔ | ⛔ | ✅ own hospital | ✅ own hospital, notes only | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Record vitals | ⛔ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Upload attachment | ⛔ | ⛔ | ✅ | ✅ | ⛔ | 🟡 lab reports only | ⛔ | ⛔ | ⛔ |
| Manage allergy/vaccination/family history | ⛔ | ⛔ | ✅ | ✅ vitals-adjacent only | ⛔ | ⛔ | ⛔ | ⛔ | 🟡 view own only |

Receptionist, Lab Technician, Pharmacist, and Accountant have **no** direct read access to clinical notes/diagnosis text — this is intentional (`FR-EMR-007`) and is one of the authorization test scenarios in `10-TESTING-STRATEGY.md`.

### 3.5 Prescriptions

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Create prescription | ⛔ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| View prescription | ⛔ | ⛔ | ✅ own hospital | 🟡 for admin note | ⛔ | ⛔ | ✅ own hospital, for dispensing | ⛔ | ✅ self only |
| Download prescription PDF | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ self only |

### 3.6 Laboratory

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Create lab order | ⛔ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Update order status (sample collected → in progress) | ⛔ | ⛔ | ⛔ | ⛔ | 🟡 sample collected only | ✅ | ⛔ | ⛔ | ⛔ |
| Enter result | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ |
| Approve result | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 🟡 different user than enterer | ⛔ | ⛔ | ⛔ |
| View result | ⛔ | ⛔ | ✅ own hospital, post-approval | ✅ own hospital, post-approval | ⛔ | ✅ own hospital | ⛔ | ⛔ | ✅ self only, post-approval |

### 3.7 Pharmacy

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Search medicine inventory | ⛔ | 🟡 own hospital | ✅ own hospital | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ |
| Manage medicine catalog/batches | ⛔ | 🟡 own hospital | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ |
| Dispense against prescription | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ |
| Receive low-stock/expiry alerts | ⛔ | ✅ own hospital | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ |

### 3.8 Billing & Payments

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| Create/add draft invoice items | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ | ✅ own hospital | ⛔ |
| Finalise invoice | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ | ✅ own hospital | ⛔ |
| View invoice | ⛔ | 🟡 own hospital | ⛔ | ⛔ | ✅ own hospital | ⛔ | ⛔ | ✅ own hospital | ✅ self only |
| Initiate payment | ⛔ | ⛔ | ⛔ | ⛔ | 🟡 cash only | ⛔ | ⛔ | 🟡 cash/reconciliation | ✅ self only |
| Handle payment webhook | System-only endpoint, signature-authenticated, no user role applies | | | | | | | | |
| Reconcile payments / financial reports | ⛔ | 🟡 own hospital, read | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ own hospital | ⛔ |

### 3.9 Notifications & Audit

| Action | SA | HA | DOC | NUR | REC | LAB | PHM | ACC | PAT |
|---|---|---|---|---|---|---|---|---|---|
| View own notifications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View hospital audit log | 🟡 any | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| View platform-wide audit log | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

## 4. Notes on 🟡 Scoping

- "own hospital" means the guard additionally verifies `resource.hospitalId === caller.hospitalId`, sourced from the JWT — never trusts a `hospitalId` in the request body/query.
- "self only" (Patient) means the guard verifies `resource.patientId === caller.patientProfileId`.
- "any" (Super Admin) is only reachable on routes explicitly marked `@BypassTenantScope()` per `03-ARCHITECTURE.md` §5; unmarked routes deny even Super Admin outside a specific tenant context switch action.

## 5. Traceability to Tests

Every ⛔ cell that represents a plausible attack surface (a role attempting an adjacent role's action, or any role attempting cross-tenant/cross-patient access) has a corresponding negative-path authorization test enumerated in `10-TESTING-STRATEGY.md` §3. This matrix is the enumeration source those tests are generated from — when the matrix changes, the test list changes with it.
