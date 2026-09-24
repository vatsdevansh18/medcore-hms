import { ArrowDown, ArrowUp } from "lucide-react";
import { LabResultFlag, type LabValueView } from "@medcore/types";

/** Out-of-range values: word + arrow + colour, never colour alone (§1.3). */
export function Flag({ flag }: { flag: LabValueView["flag"] }) {
  if (flag === LabResultFlag.HIGH) {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <ArrowUp className="size-3.5" aria-hidden="true" /> High
      </span>
    );
  }
  if (flag === LabResultFlag.LOW) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <ArrowDown className="size-3.5" aria-hidden="true" /> Low
      </span>
    );
  }
  if (flag === LabResultFlag.NORMAL) return <span className="text-success">Normal</span>;
  return <span className="text-muted">No reference range</span>;
}
