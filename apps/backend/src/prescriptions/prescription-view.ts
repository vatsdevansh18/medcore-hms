/**
 * A prescription as returned to any client. `pdfUrl` and `signatureImageUrl`
 * are S3 storage keys: they're dropped (files are only ever reached through
 * a short-lived pre-signed URL, SEC-FILE-003) and replaced by `pdfReady`,
 * which says whether `GET /prescriptions/:id/pdf` will succeed yet
 * (docs/11-DECISIONS.md D-036).
 */
export function toPrescriptionView<T extends { pdfUrl: string | null; signatureImageUrl: string | null }>(
  row: T,
): Omit<T, "pdfUrl" | "signatureImageUrl"> & { pdfReady: boolean } {
  const { pdfUrl, signatureImageUrl: _signatureImageUrl, ...rest } = row;
  return { ...rest, pdfReady: pdfUrl !== null };
}

/** The doctor on a prescription or lab order, as a patient may see it. */
export const DOCTOR_NAME_SELECT = {
  select: {
    id: true,
    specialization: true,
    user: { select: { id: true, firstName: true, lastName: true } },
  },
} as const;
