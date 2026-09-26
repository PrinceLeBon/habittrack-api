import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';

export const FREQUENCIES = ['DAILY', 'WEEKLY'] as const;
export const COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'] as const;

export class CreateHabitDto {
  @ApiProperty({ example: 'Lire 20 minutes', minLength: 3, maxLength: 60 })
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: 'Avant de dormir', maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ enum: FREQUENCIES, default: 'DAILY' })
  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: (typeof FREQUENCIES)[number];

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 7, description: 'Obligatoire si frequency = WEEKLY' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(7)
  timesPerWeek?: number | null;

  @ApiProperty({ enum: COLORS, example: 'indigo' })
  @IsIn(COLORS)
  color: (typeof COLORS)[number];

  @ApiProperty({ example: '2026-09-01', description: 'AAAA-MM-JJ' })
  @IsDateString({ strict: true })
  startDate: string;

  @ApiPropertyOptional({ description: 'Identifiant généré par le client (UUID), pour le mode hors ligne' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class UpdateHabitDto extends PartialType(CreateHabitDto) {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ListHabitsQuery {
  @ApiPropertyOptional({ description: 'Filtrer sur les habitudes archivées (par défaut : toutes)' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  archived?: boolean;
}

export class CheckinsQuery {
  @ApiProperty({ example: '2026-09-01' })
  @IsDateString({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString({ strict: true })
  to: string;
}
