"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bell, X } from "lucide-react";
import type { NotificationView } from "@medcore/types";
import { useMarkNotificationRead, useNotifications } from "@/services/portal";
import { useNotificationStore } from "@/store/notification-store";
import { useAuthStore } from "@/store/auth-store";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";

/** Where a notification leads. `Payment` notifications carry no invoice id,
 * so they open the bills list. */
export function notificationHref(n: Pick<NotificationView, "relatedEntityType" | "relatedEntityId">): string | null {
  const id = n.relatedEntityId;
  switch (n.relatedEntityType) {
    case "Appointment":
      return id ? ROUTES.appointment(id) : ROUTES.appointments;
    case "Prescription":
      return id ? ROUTES.prescription(id) : ROUTES.prescriptions;
    case "LabOrder":
      return id ? ROUTES.labReport(id) : ROUTES.labReports;
    case "Invoice":
      return id ? ROUTES.invoice(id) : ROUTES.invoices;
    case "Payment":
      return ROUTES.invoices;
    default:
      return null;
  }
}

export function NotificationBell() {
  const unread = useNotificationStore((s) => s.unreadCount);
  const setOpen = useNotificationStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="relative rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

/** Slide-over list of recent in-app notifications (§2.9). */
export function NotificationPanel() {
  const open = useNotificationStore((s) => s.panelOpen);
  const setOpen = useNotificationStore((s) => s.setPanelOpen);
  const live = useNotificationStore((s) => s.live);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const markedRead = useNotificationStore((s) => s.markedRead);
  const timeZone = useAuthStore((s) => s.user?.hospital?.timezone);
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkNotificationRead();

  const unreadFromServer = list.data?.meta.unreadCount;
  useEffect(() => {
    if (typeof unreadFromServer === "number") setUnreadCount(unreadFromServer);
  }, [unreadFromServer, setUnreadCount]);

  // Socket pushes first, then the fetched page, without duplicates.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...(list.data?.data ?? [])].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [live, list.data]);

  function openItem(n: NotificationView) {
    if (!n.readAt) {
      markedRead(n.id);
      markRead.mutate(n.id);
    }
    const href = notificationHref(n);
    setOpen(false);
    if (href) router.push(href);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="text-lg font-semibold">Notifications</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-md p-1 text-subtle hover:bg-surface-muted">
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">Your recent MedCore updates.</DialogPrimitive.Description>
          <div className="flex-1 overflow-y-auto p-3">
            {list.isPending && live.length === 0 ? (
              <ListSkeleton rows={4} />
            ) : list.isError && live.length === 0 ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState title="Nothing new" description="Updates about your visits, reports and bills appear here." />
            ) : (
              <ul className="flex flex-col gap-1">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left hover:bg-surface-muted",
                        !n.readAt && "bg-primary-surface",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {!n.readAt && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{n.body}</span>
                      <span className="mt-1 block text-xs text-subtle">{formatDateTime(n.createdAt, timeZone)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
