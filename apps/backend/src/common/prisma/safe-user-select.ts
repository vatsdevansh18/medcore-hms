/**
 * The set of `User` fields safe to return in any API response — every place
 * that includes a related `User` (DoctorProfile.user, PatientProfile.user,
 * etc.) must use this `select`, never a bare `include: { user: true }`,
 * which returns every column including `passwordHash`. Found leaking a
 * bcrypt hash in the POST /doctors response in Phase 4 — see
 * docs/phase-reviews/PHASE-4-REVIEW.md. Mirrors the field list
 * AuthService.me() already used.
 */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  role: true,
  hospitalId: true,
  status: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  createdAt: true,
} as const;
