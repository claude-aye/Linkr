import { IsNumber, IsString, Length, Min } from 'class-validator';

export class PriceRangeDto {
  @IsNumber()
  @Min(0)
  min!: number;

  @IsNumber()
  @Min(0)
  max!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;
}
