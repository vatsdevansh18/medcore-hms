import { Global, Module } from "@nestjs/common";
import { EMAIL_SENDER, SMS_SENDER } from "./messaging.types";
import { ResendEmailSender } from "./resend-email.sender";
import { TwilioSmsSender } from "./twilio-sms.sender";

/** Global so both the notification workers and auth's OTP delivery share
 * one configured client per provider. */
@Global()
@Module({
  providers: [
    { provide: EMAIL_SENDER, useClass: ResendEmailSender },
    { provide: SMS_SENDER, useClass: TwilioSmsSender },
  ],
  exports: [EMAIL_SENDER, SMS_SENDER],
})
export class MessagingModule {}
