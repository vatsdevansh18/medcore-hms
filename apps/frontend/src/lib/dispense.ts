/** One line of a dispense request, as the confirmation lists it. */
export interface DispenseLine {
  itemId: string;
  name: string;
  quantity: number;
}

interface PlanItem {
  id: string;
  quantityPrescribed: number;
  dispensedQuantity: number;
  medicine: { name: string };
}

/**
 * Turns the pharmacist's typed quantities into a dispense request. A blank
 * or zero quantity skips the line (partial dispensing is allowed); anything
 * else must be a whole number no larger than what's left on that line. The
 * server re-checks all of it, plus stock and expiry.
 */
export function dispensePlan(
  items: PlanItem[],
  quantities: Record<string, string>,
): { lines: DispenseLine[]; errors: Record<string, string>; valid: boolean } {
  const lines: DispenseLine[] = [];
  const errors: Record<string, string> = {};
  for (const item of items) {
    const remaining = item.quantityPrescribed - item.dispensedQuantity;
    if (remaining <= 0) continue;
    const raw = (quantities[item.id] ?? "").trim();
    if (raw === "" || raw === "0") continue;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) errors[item.id] = "Enter a whole number.";
    else if (quantity > remaining) errors[item.id] = `Only ${remaining} left on this line.`;
    else lines.push({ itemId: item.id, name: item.medicine.name, quantity });
  }
  return { lines, errors, valid: lines.length > 0 && Object.keys(errors).length === 0 };
}
