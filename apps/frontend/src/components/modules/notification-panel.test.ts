import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { notificationHref } from "./notification-panel";

describe("notificationHref", () => {
  it("links each notification to the portal page for its entity", () => {
    expect(notificationHref({ relatedEntityType: "Appointment", relatedEntityId: "a1" })).toBe("/portal/appointments/a1");
    expect(notificationHref({ relatedEntityType: "Prescription", relatedEntityId: "p1" })).toBe("/portal/prescriptions/p1");
    expect(notificationHref({ relatedEntityType: "LabOrder", relatedEntityId: "l1" })).toBe("/portal/lab-reports/l1");
    expect(notificationHref({ relatedEntityType: "Invoice", relatedEntityId: "i1" })).toBe("/portal/invoices/i1");
  });

  it("sends payment notifications to the bills list (they carry no invoice id)", () => {
    expect(notificationHref({ relatedEntityType: "Payment", relatedEntityId: "pay1" })).toBe("/portal/invoices");
  });

  it("has no link for staff-only entity types", () => {
    expect(notificationHref({ relatedEntityType: "Medicine", relatedEntityId: "m1" })).toBeNull();
    expect(notificationHref({ relatedEntityType: null, relatedEntityId: null })).toBeNull();
  });
});
