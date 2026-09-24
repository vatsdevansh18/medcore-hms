import type { NotificationType } from "./enums";

/** Socket.IO namespace for in-app notifications (docs/08-API-CONTRACT.md §4.10).
 * The client passes its access token as `auth: { token }` in the handshake;
 * the server joins it to its own `user:{id}` room and nothing else. */
export const NOTIFICATIONS_NAMESPACE = "/notifications";

export const NotificationSocketEvent = {
  /** Server -> client: a new in-app notification (payload: NotificationView). */
  NEW: "notification:new",
} as const;
export type NotificationSocketEvent = (typeof NotificationSocketEvent)[keyof typeof NotificationSocketEvent];

/** One in-app notification as returned by `GET /notifications/me` and
 * pushed over the socket. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}
