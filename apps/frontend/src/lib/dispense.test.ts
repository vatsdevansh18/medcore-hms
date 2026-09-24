import { describe, expect, it } from "vitest";
import { dispensePlan } from "./dispense";

const items = [
  { id: "a", quantityPrescribed: 10, dispensedQuantity: 4, medicine: { name: "Amoxicillin" } },
  { id: "b", quantityPrescribed: 5, dispensedQuantity: 0, medicine: { name: "Paracetamol" } },
  { id: "c", quantityPrescribed: 3, dispensedQuantity: 3, medicine: { name: "Cetirizine" } },
];

describe("dispensePlan", () => {
  it("dispenses what's typed, skips blank and zero lines, and ignores finished lines", () => {
    const plan = dispensePlan(items, { a: "6", b: "", c: "1" });
    expect(plan.lines).toEqual([{ itemId: "a", name: "Amoxicillin", quantity: 6 }]);
    expect(plan.valid).toBe(true);
    expect(dispensePlan(items, { a: "0", b: "2" }).lines).toEqual([{ itemId: "b", name: "Paracetamol", quantity: 2 }]);
  });

  it("refuses more than what's left, fractions, and negatives", () => {
    expect(dispensePlan(items, { a: "7" }).errors.a).toBe("Only 6 left on this line.");
    expect(dispensePlan(items, { b: "1.5" }).errors.b).toBe("Enter a whole number.");
    expect(dispensePlan(items, { b: "-1" }).errors.b).toBe("Enter a whole number.");
    expect(dispensePlan(items, { b: "abc" }).valid).toBe(false);
  });

  it("is invalid when nothing would be dispensed", () => {
    expect(dispensePlan(items, { a: "", b: "0" }).valid).toBe(false);
  });
});
