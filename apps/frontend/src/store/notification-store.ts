import { create } from "zustand";
import type { NotificationView } from "@medcore/types";

interface NotificationState {
  /** Notifications pushed over the socket since the list was last fetched. */
  live: NotificationView[];
  /** Unread count from `GET /notifications/me` meta, adjusted live. */
  unreadCount: number;
  connected: boolean;
  panelOpen: boolean;
  push: (notification: NotificationView) => void;
  setUnreadCount: (count: number) => void;
  markedRead: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  live: [],
  unreadCount: 0,
  connected: false,
  panelOpen: false,
  push: (notification) =>
    set((state) =>
      state.live.some((n) => n.id === notification.id)
        ? state
        : { live: [notification, ...state.live].slice(0, 50), unreadCount: state.unreadCount + 1 },
    ),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  markedRead: (id) =>
    set((state) => ({
      live: state.live.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    })),
  setConnected: (connected) => set({ connected }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  reset: () => set({ live: [], unreadCount: 0, connected: false, panelOpen: false }),
}));
