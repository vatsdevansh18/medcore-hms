import { cloneElement, isValidElement, useId, type ReactElement } from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";

/**
 * A labelled field with its error shown inline below it, wired through
 * `aria-describedby`/`aria-invalid` (docs/04-UI-UX.md §2.7).
 *
 * The line under the input is always reserved (hint or error, else empty),
 * so an error appearing on blur never moves the fields and buttons below:
 * a moved Submit button can swallow the click that caused the blur.
 */
export function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const describedBy = error || hint ? messageId : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })
    : children;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      <p id={messageId} className={`min-h-4 text-xs leading-4 ${error ? "flex items-start gap-1 text-danger" : "text-subtle"}`}>
        {error ? (
          <>
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </>
        ) : (
          hint
        )}
      </p>
    </div>
  );
}
