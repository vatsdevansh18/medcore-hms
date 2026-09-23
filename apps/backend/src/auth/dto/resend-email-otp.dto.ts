import { IsEmail } from "class-validator";

export class ResendEmailOtpDto {
  @IsEmail()
  email!: string;
}
