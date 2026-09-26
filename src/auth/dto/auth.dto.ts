import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Awa Dossou' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 'awa@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'MotDePasse2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'demo@habittrack.dev' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'HabitTrack2026!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'awa@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir exactement 6 chiffres.' })
  code: string;
}

export class ResendOtpDto {
  @ApiProperty({ example: 'awa@example.com' })
  @IsEmail()
  email: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mode « body » uniquement. En mode cookie, le jeton est lu dans le cookie habittrack_refresh.' })
  @IsOptional()
  @IsString()
  @Length(10, 4096)
  refresh_token?: string;
}
