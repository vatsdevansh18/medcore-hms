import { IsUUID } from "class-validator";

export class CreateLabOrderItemDto {
  @IsUUID()
  labTestId!: string;
}
