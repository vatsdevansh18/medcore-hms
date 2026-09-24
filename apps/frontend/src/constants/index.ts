/** API base, e.g. http://localhost:3001/api. The browser calls the API
 * directly (CORS allow-list + credentials), so the API sees the real client
 * IP for rate limiting (docs/11-DECISIONS.md D-038). */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

/** Origin of the API, for the Socket.IO connection (namespace /notifications). */
export const API_ORIGIN = new URL(API_BASE_URL).origin;

export const ROUTES = {
  login: "/login",
  register: "/register",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  staff: "/staff",
  dashboard: "/dashboard",
  staffSearch: "/dashboard/search",
  staffAppointments: "/dashboard/appointments",
  labQueue: "/dashboard/lab-orders",
  rxQueue: "/dashboard/prescriptions",
  invoiceQueue: "/dashboard/invoices",
  paymentList: "/dashboard/payments",
  inventory: "/dashboard/inventory",
  beds: "/dashboard/beds",
  auditLog: "/dashboard/audit",
  portal: "/portal",
  appointments: "/portal/appointments",
  bookAppointment: "/portal/appointments/book",
  appointment: (id: string) => `/portal/appointments/${id}`,
  records: "/portal/records",
  record: (id: string) => `/portal/records/${id}`,
  prescriptions: "/portal/prescriptions",
  prescription: (id: string) => `/portal/prescriptions/${id}`,
  labReports: "/portal/lab-reports",
  labReport: (id: string) => `/portal/lab-reports/${id}`,
  invoices: "/portal/invoices",
  invoice: (id: string) => `/portal/invoices/${id}`,
} as const;

/** How many days ahead the booking flow offers (availability is fetched a
 * week at a time; the API caps a range at 31 days). */
export const BOOKING_HORIZON_DAYS = 28;
