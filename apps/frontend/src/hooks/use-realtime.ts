"use client";

import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { NOTIFICATIONS_NAMESPACE, NotificationSocketEvent, type NotificationView } from "@medcore/types";
import { API_ORIGIN } from "@/constants";
import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";
import { useNotificationStore } from "@/store/notification-store";

/** Which cached queries a notification makes stale, so an open screen
 * shows the new state without a manual refresh. */
const INVALIDATES: Record<string, string[]> = {
  APPOINTMENT_CONFIRMED: ["appointments"],
  APPOINTMENT_REMINDER: ["appointments"],
  PRESCRIPTION_READY: ["prescriptions", "records"],
  LAB_RESULT_APPROVED: ["lab-orders"],
  INVOICE_GENERATED: ["invoices"],
  PAYMENT_RECEIVED: ["invoices"],
};

/**
 * In-app notifications over Socket.IO (FR-NOTIF-003, D-032). The handshake
 * sends the current access token; the server disconnects the socket when
 * that token expires, so every reconnect reads the latest token, and a
 * rejected handshake triggers one refresh before retrying.
 */
export function useRealtime(): void {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    const store = useNotificationStore.getState();

    const socket: Socket = io(`${API_ORIGIN}${NOTIFICATIONS_NAMESPACE}`, {
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
      transports: ["websocket"],
      reconnectionDelayMax: 10_000,
    });

    let refreshing = false;
    socket.on("connect", () => store.setConnected(true));
    socket.on("disconnect", (reason) => {
      store.setConnected(false);
      // "io server disconnect" means the server ended it (token expired);
      // socket.io won't reconnect on its own in that case.
      if (reason === "io server disconnect") {
        void refreshAccessToken().then((token) => {
          if (token) socket.connect();
        });
      }
    });
    socket.on("connect_error", () => {
      if (refreshing) return;
      refreshing = true;
      void refreshAccessToken().finally(() => {
        refreshing = false;
      });
    });
    socket.on(NotificationSocketEvent.NEW, (notification: NotificationView) => {
      store.push(notification);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      for (const root of INVALIDATES[notification.type] ?? []) {
        void queryClient.invalidateQueries({ queryKey: [root] });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      store.setConnected(false);
    };
  }, [status, queryClient]);
}
