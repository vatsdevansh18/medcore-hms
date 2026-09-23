# Global Phase Quality & Error-Resolution Protocol — MedCore HMS

**Version:** 1.0
**Status:** Mandatory, effective from Phase 1 onward — applies to every current and future phase, every feature, every major change, and final project delivery
**Related documents:** `05-DEVELOPMENT-PLAN.md` §5, `10-TESTING-STRATEGY.md`, `09-SECURITY.md`

The goal is not to finish phases quickly. The goal is a reliable, production-style system where each completed phase is a stable foundation for the next. A phase is never "done" merely because it compiles, the page loads, the API responds, or one happy-path test passes.

## 1. The Cycle

For every meaningful feature or implementation group:

```
IMPLEMENT → RUN CHECKS → IDENTIFY FAILURES → INVESTIGATE ROOT CAUSE → FIX
→ RUN CHECKS AGAIN → TEST EDGE CASES → SECURITY REVIEW → REGRESSION REVIEW
→ DOCUMENT → CONTINUE
```

## 2. Error Handling Rule

On every error: read it completely, identify the actual root cause, inspect surrounding code/architecture, determine whether the problem is local or traces back to an earlier architectural decision, fix the root cause, re-run affected checks, run regression checks, confirm the fix introduced nothing new, document decisions worth recording.

Never: patch symptoms, apply repeated random fixes, hide errors, suppress warnings to force a green build, or disable tests/lint/security checks/type checks because they're inconvenient.

## 3. Before Changing Existing Code

Inspect the relevant files, understand current behavior, check inter-module dependencies, identify possible regressions, preserve existing working behavior unless the change intentionally replaces it. Prefer targeted, maintainable changes over large rewrites.

## 4. Testing Requirement — Risk-Based, Not Mechanical

Choose checks based on the actual risk the phase introduces, not a rote checklist. Representative mappings:

| Change type    | Required testing focus                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Authentication | Login, logout, refresh, expiration, invalid credentials, token rotation, unauthorized access         |
| RBAC           | Authorized role succeeds; unauthorized role fails; authenticated-but-wrong-scope fails               |
| Multi-tenancy  | Explicit cross-tenant access attempts, in both directions                                            |
| Appointments   | Conflict detection, concurrent booking races                                                         |
| Billing        | Calculation correctness, payment state transitions, duplicate webhook events, signature verification |
| File upload    | Invalid types, oversized files, malicious inputs                                                     |

## 5. Negative Testing Is Mandatory

Every important feature needs both: the **happy path** (expected valid workflow) and the **failure path** (invalid input, unauthorized access, missing data, duplicate requests, race conditions, expired resources, illegal state transitions, network/API failures). A feature isn't complete until its important failure cases have been considered.

## 6. Security Review Is Continuous

Reviewed every phase, not just at the end: authentication, authorization, RBAC, tenant isolation, input validation, SQL injection, XSS, CSRF (where applicable), CORS, rate limiting, secure cookies, token handling, secrets management, audit logging, file upload security, sensitive-data exposure, error-message leakage, dependency vulnerabilities, API access control. Vulnerabilities touching authentication, authorization, medical data, payments, secrets, or tenant isolation are **HIGH/CRITICAL** by definition.

## 7. Multi-Tenancy Rule

Any feature touching hospital-specific data must have its tenant isolation explicitly verified server-side — never rely on frontend filtering. Confirm: the user belongs to the expected hospital, the requested resource belongs to that hospital, IDs cannot be used to bypass tenancy, queries cannot accidentally cross hospitals, privileged roles (Super Admin) are handled intentionally, not by accident.

**A cross-tenant data leak is a CRITICAL failure.** If found: stop the affected progression, fix the issue, add or strengthen a regression test, re-run the relevant suite, only then continue.

## 8. RBAC Rule

Frontend visibility is not security. Every protected backend operation enforces authorization independently. Test: authorized role succeeds, unauthorized role fails, authenticated-but-improperly-scoped fails, cross-tenant access fails. Never rely on a hidden button/route as the only control.

## 9. Database Rule

Any schema-changing feature is reviewed for: relationships, foreign keys, constraints, indexes, uniqueness, nullability, transaction safety, tenancy boundaries, soft-delete behavior where applicable, migration safety, query performance. Don't casually modify the schema after dependent features exist — inspect and update affected services/tests first.

## 10. API Rule

Every new/modified API is checked for: authentication, authorization, validation, tenancy, correct HTTP status codes, consistent response structure, correct error structure, pagination/filtering where applicable, database integrity, edge cases, API documentation. A 200 on the happy path does not make an API complete.

## 11. Frontend Quality Rule

Every important screen is reviewed for: visual consistency, usability, responsive layout, accessibility, loading/empty/error/success states, form validation, keyboard navigation, focus behavior, correct permission-based UI, reasonable information density. Stays professional, clinical, modern, usable — animation only communicates transitions, state changes, feedback, or hierarchy, never decoration.

## 12. Backend Quality Rule

Reviewed for: modularity, separation of concerns, maintainability, correct business rules, validation, authorization, error handling, logging, transaction safety, performance, testability. Business logic lives in services/domain modules, not controllers.

## 13. Dependency Rule

Before adding a package: check whether the functionality already exists, whether an existing dependency already solves it, whether it's actually necessary, its maintenance/compatibility, its bundle/performance impact, its security implications. Document the reason when a dependency is added for an important architectural reason.

## 14. No Fake Completion

Never mark something complete when it's only a placeholder, an undisclosed mock, visually implemented but not wired up, connected only on the frontend, an API that doesn't persist correctly, a button with no real behavior, or a simulated workflow where real behavior is expected. A genuinely necessary temporary mock is labeled as temporary with what remains documented.

## 15. Build Stability Rule

At appropriate checkpoints: lint, type-check, tests, production build. A feature isn't stable if it leaves unrelated parts of the project broken. Regressions are fixed before proceeding.

## 16. Regression Testing

After a significant fix, ask "what else could this have affected?" and test accordingly. Examples: auth changes → protected routes + refresh behavior; Prisma schema changes → related API services; shared UI component changes → all important consumers; authorization changes → multiple roles; appointment logic changes → booking, cancellation, status transitions, concurrency.

## 17. Performance Review

Where relevant, inspect: unnecessary API calls, unnecessary renders, expensive queries, missing indexes, large payloads, pagination, cache behavior, client/server component boundaries, bundle size, image optimization. No premature complexity — prefer measurable improvements.

## 18. Observability Review

Where applicable, ensure: useful structured logs, observable errors, no sensitive information logged, auditable security events, diagnosable background jobs, working health checks, investigable production failures.

## 19. Documentation Synchronization

Whenever implementation changes an architectural decision, update the relevant document(s): PRD, SRS, Architecture, UI/UX, Database design, RBAC matrix, API contract, Security, Testing strategy, Decision log. Documentation and implementation never drift apart.

## 20. Phase Completion Gate

A phase is not complete merely because its planned code has been written. Before marking PASS, verify:

- **Functional:** all phase requirements implemented, business rules correct, important edge cases handled.
- **Code Quality:** clean implementation, no obvious duplicated logic, no accidental dead code, no unjustified `any`, no unnecessary hacks.
- **Testing:** relevant unit/integration/component/E2E tests pass; regression tests pass where applicable.
- **Static Checks:** lint, type-check, production build all pass.
- **Security:** applicable checks pass; authorization and tenancy verified; sensitive data protected.
- **UI/UX:** important screens, responsive behavior, accessibility, loading/error/empty states reviewed.
- **Architecture:** no inconsistency introduced; dependencies sensible; DB/API boundaries clean.
- **Documentation:** required docs updated; important decisions recorded.

## 21. Active Break-It Testing

Before declaring PASS, actively try to break the implementation — think like a malicious user, an unauthorized user, a careless user, a concurrent user, a user submitting invalid data, a network failure, a duplicate request, an expired session, an unexpected database state. Ask "what happens if this goes wrong?" and test the important cases that follow.

## 22. Phase Status Values

Recorded at `docs/phase-reviews/PHASE-X-REVIEW.md`:

- **PASS** — all important requirements verified, no critical/high-severity issues remain.
- **PASS WITH DOCUMENTED MINOR ISSUES** — only genuinely minor, non-blocking issues remain, explicitly documented.
- **BLOCKED** — a critical dependency or issue prevents safe progression.
- **FAIL** — the phase does not satisfy its acceptance criteria.

Never PASS merely because the application launches.

## 23. Phase Review Format

Every `docs/phase-reviews/PHASE-X-REVIEW.md` contains: **Phase** (name/number) · **Objective** · **Implemented** · **Requirements Verified** (IDs + status) · **Files/Modules Changed** · **Tests Executed** · **Test Results** · **Security Review** · **UI/UX Review** · **Bugs Found** · **Fixes Applied** · **Regression Checks** · **Known Minor Issues** · **Technical Debt** · **Documentation Updated** · **Final Gate**.

## 24. Do Not Auto-Proceed

At every phase gate: stop. Do not automatically start the next phase. Wait for explicit authorization (e.g. "START PHASE 2"). This is unchanged from `05-DEVELOPMENT-PLAN.md`'s original phase-gate discipline — this protocol adds rigor to what happens _inside_ a phase, not to the stop-and-wait boundary between phases.

## 25. When a Critical Error Traces to an Earlier Phase

If a later phase surfaces a critical issue that actually originated earlier: don't work around it. Identify the root architectural cause, determine affected modules, assess regression risk, fix the underlying issue, add regression tests, rerun affected checks, update documentation, record the decision (`11-DECISIONS.md` if architectural), then resume the current phase. Preserving an earlier mistake to avoid rework is not acceptable.

## 26. Priority Order for Problems

1. Security vulnerabilities
2. Data corruption/data-loss risks
3. Cross-tenant access problems
4. Authentication/authorization failures
5. Payment/billing integrity issues
6. Critical business logic errors
7. Backend/API failures
8. Database integrity problems
9. Test/build/type failures
10. UX/accessibility issues
11. Performance issues
12. Cosmetic issues

Don't polish visuals while critical security or data-integrity defects remain open.

## 27. Final Project Quality Gate

Before final delivery, a complete project-wide audit covers: requirements coverage, architecture, database, APIs, authentication, RBAC, multi-tenancy, every clinical/operational workflow (appointments, EMR, prescriptions, lab, pharmacy, billing, payments, notifications, patient portal, analytics), frontend UX, accessibility, security, testing, CI/CD, deployment, observability, documentation. Issues are found proactively, not left for the user to discover. All critical and high-severity issues are fixed before final delivery.

## 28. What "Done" Means Here

Optimize for "the implementation has been verified," not "Claude says it's finished." Optimize for "the system remains correct under realistic and adversarial conditions," not "zero terminal errors at one moment." Problems are never hidden — every phase communicates explicitly what passed, what failed, what was fixed, what remains, and what is blocking progression.
