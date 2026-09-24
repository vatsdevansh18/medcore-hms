/**
 * Browser uploads go straight to storage through a pre-signed PUT URL the
 * API issued after validating the file's type and size (SEC-FILE-*). No
 * auth header is sent: the URL's signature is the permission, and it
 * expires in minutes. The Content-Type must match what was declared, since
 * it's part of the signature.
 */
export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const res = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!res.ok) throw new Error(`The file upload failed (${res.status}). Try again.`);
}

/** Mirrors the API's allow-lists (attachment-validation.ts,
 * signature-validation.ts) so a wrong file is refused before any request. */
export const ATTACHMENT_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const SIGNATURE_TYPES: Record<string, string[]> = { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] };
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/** Why a file can't be uploaded, or null if it can. Both the declared type
 * and the extension must match, as the API checks. */
export function fileProblem(file: File, types: Record<string, string[]>, maxBytes: number): string | null {
  if (file.size === 0) return "The file is empty.";
  if (file.size > maxBytes) return `Files can be at most ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  const dot = file.name.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
  const allowed = types[file.type.toLowerCase()];
  if (!allowed || !allowed.includes(ext)) {
    const list = [...new Set(Object.values(types).flat())].join(", ");
    return `That file type isn't accepted. Use ${list}.`;
  }
  return null;
}
