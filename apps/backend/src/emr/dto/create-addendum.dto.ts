import { IsString, MaxLength, MinLength } from "class-validator";

/** `POST /medical-records/:id/addenda` — FR-EMR-002. */
export class CreateAddendumDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  note!: string;
}
