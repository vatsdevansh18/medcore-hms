import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import {
  APPOINTMENT_REMINDER_QUEUE,
  MEDICINE_EXPIRY_SCAN_QUEUE,
  PRESCRIPTION_PDF_QUEUE,
} from "../../queue/queue.constants";
import {
  EMAIL_QUEUE,
  IN_APP_QUEUE,
  NOTIFICATION_OUTBOX_QUEUE,
  SMS_QUEUE,
} from "../../notifications/notification.constants";

export const BULL_BOARD_PATH = "/api/admin/queues";

const QUEUES = [
  EMAIL_QUEUE,
  SMS_QUEUE,
  IN_APP_QUEUE,
  NOTIFICATION_OUTBOX_QUEUE,
  APPOINTMENT_REMINDER_QUEUE,
  PRESCRIPTION_PDF_QUEUE,
  MEDICINE_EXPIRY_SCAN_QUEUE,
];

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** HTTP Basic auth: Bull Board is a browser UI that can't send our bearer
 * token, so it gets its own credential (dev-only, SEC-NOTIF-005). */
function basicAuth(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep > 0 && sameSecret(decoded.slice(0, sep), username) && sameSecret(decoded.slice(sep + 1), password)) {
        next();
        return;
      }
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="MedCore queues"');
    res.status(401).send("Authentication required.");
  };
}

/**
 * Bull Board, the dev-only queue UI where dead-lettered jobs are inspected
 * (NFR-AVAIL-002, docs/03-ARCHITECTURE.md §12). Mounted only when
 * `BULL_BOARD_ENABLED=true`, which env validation refuses in production and
 * which requires a password.
 */
export function mountBullBoard(app: INestApplication): boolean {
  const config = app.get(ConfigService);
  if (!config.get<boolean>("BULL_BOARD_ENABLED", false)) return false;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: QUEUES.map((name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name), { strict: false }))),
    serverAdapter,
  });
  app.use(
    BULL_BOARD_PATH,
    basicAuth(config.get<string>("BULL_BOARD_USERNAME", "admin"), config.getOrThrow<string>("BULL_BOARD_PASSWORD")),
    serverAdapter.getRouter(),
  );
  return true;
}
