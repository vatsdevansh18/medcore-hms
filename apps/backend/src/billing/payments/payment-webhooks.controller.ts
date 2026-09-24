import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { PaymentProvider } from "@medcore/types";
import { Public } from "../../auth/decorators/public.decorator";
import { PaymentsService } from "./payments.service";
import type { RawBodyRequest } from "../../common/bootstrap/configure-app";

/**
 * Provider → server webhooks (docs/07-RBAC-MATRIX.md §3.8: "system-only
 * endpoint, signature-authenticated, no user role applies"). `@Public()`
 * only skips JWT auth; the provider signature over the raw body is the
 * authentication, and it's checked before anything else happens (SEC-PAY-002).
 * Handled synchronously, not queued, so the signature check gates the HTTP
 * response itself (docs/03-ARCHITECTURE.md §12 `webhook-processing`).
 */
@Controller("payments/webhook")
export class PaymentWebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post("stripe")
  @HttpCode(HttpStatus.OK)
  stripe(@Req() req: Request & RawBodyRequest, @Headers() headers: Record<string, unknown>) {
    return this.paymentsService.handleWebhook(PaymentProvider.STRIPE, req.rawBody, headers);
  }

  @Public()
  @Post("razorpay")
  @HttpCode(HttpStatus.OK)
  razorpay(@Req() req: Request & RawBodyRequest, @Headers() headers: Record<string, unknown>) {
    return this.paymentsService.handleWebhook(PaymentProvider.RAZORPAY, req.rawBody, headers);
  }
}
