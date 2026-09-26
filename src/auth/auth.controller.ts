import { Body, Controller, Get, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthService, type IssuedTokens } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto, ResendOtpDto, VerifyOtpDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'habittrack_refresh';

const transportHeader = {
  name: 'X-Token-Transport',
  required: false,
  description:
    '« cookie » (clients web) : le refresh token est placé dans un cookie HttpOnly et absent du corps. ' +
    '« body » (défaut, clients mobiles) : le refresh token est renvoyé dans le corps JSON.',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Créer un compte (un code OTP est envoyé par e-mail)' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Vérifier l’adresse e-mail avec le code reçu' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.email, dto.code);
  }

  @Post('resend-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renvoyer un code de vérification' })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.email);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader(transportHeader)
  @ApiOperation({ summary: 'Se connecter : jeton d’accès (15 min) + refresh token (7 j)' })
  async login(
    @Body() dto: LoginDto,
    @Headers('x-token-transport') transport: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto);
    return this.respondWithTokens(res, tokens, user, transport);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiHeader(transportHeader)
  @ApiOperation({ summary: 'Obtenir un nouveau jeton d’accès (rotation du refresh token)' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Headers('x-token-transport') transport: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? dto.refresh_token;
    try {
      const { user, tokens } = await this.auth.refresh(token);
      return this.respondWithTokens(res, tokens, user, transport);
    } catch (error) {
      this.clearCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Se déconnecter : révoque la session et efface le cookie' })
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? dto.refresh_token);
    this.clearCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'L’utilisateur connecté' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  private respondWithTokens(res: Response, tokens: IssuedTokens, user: unknown, transport?: string) {
    const body: Record<string, unknown> = {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      user,
    };
    if (transport === 'cookie') {
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE !== 'false',
        sameSite: 'strict',
        path: process.env.COOKIE_PATH ?? '/auth',
        expires: tokens.refreshExpiresAt,
      });
    } else {
      body.refresh_token = tokens.refreshToken;
    }
    return body;
  }

  private clearCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: process.env.COOKIE_PATH ?? '/auth' });
  }
}
