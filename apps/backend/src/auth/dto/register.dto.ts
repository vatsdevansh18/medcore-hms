import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Patient self-registration only — staff accounts (Doctor, Nurse, etc.) are
 * provisioned by a Hospital Admin in Phase 4, not self-registered, matching
 * the "self-registration only" note against PATIENT in docs/07-RBAC-MATRIX.md
 * §3.2. `hospitalId` identifies which hospital's patient portal this
 * registration is through — a hospital is a real-world prerequisite created
 * by a Super Admin (already seeded for demo purposes in Phase 2).
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  // OWASP-minimum: 8+ chars, at least one letter and one number.
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes — reject longer up front.
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: "password must contain at least one letter and one number",
  })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsUUID()
  hospitalId!: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}
