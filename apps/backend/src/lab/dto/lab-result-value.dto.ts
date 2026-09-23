import { IsNumber, IsString, MaxLength } from "class-validator";

export class LabResultValueDto {
  @IsString()
  @MaxLength(100)
  parameter!: string;

  @IsNumber()
  value!: number;

  @IsString()
  @MaxLength(30)
  unit!: string;
}
