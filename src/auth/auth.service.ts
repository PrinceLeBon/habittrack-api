import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const OTP_TTL_MS = 15 * 60 * 1000;
const refreshTtlDays = () => Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

type UserRecord = { id: number; email: string; name: string; isVerified: boolean; createdAt: Date };

export function publicUser(user: UserRecord) {
  return { id: user.id, email: user.email, name: user.name, isVerified: user.isVerified, createdAt: user.createdAt };
}

export type IssuedTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const password = await bcrypt.hash(dto.password, 10);
    const code = this.generateOtp();
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email: dto.email.toLowerCase(),
          password,
          otpCode: code,
          otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      this.mail.sendOtp(user.email, user.name, code);
      return publicUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Un compte existe déjà avec cette adresse.');
      }
      throw error;
    }
  }

  async verifyOtp(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.isVerified) return publicUser(user);
    if (!user.otpCode || user.otpCode !== code) throw new BadRequestException('Code incorrect.');
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) throw new BadRequestException('Code expiré.');
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, otpCode: null, otpExpiresAt: null },
    });
    return publicUser(updated);
  }

  async resendOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Réponse identique que le compte existe ou non : on ne révèle pas quels e-mails sont inscrits.
    if (user && !user.isVerified) {
      const code = this.generateOtp();
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: code, otpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
      });
      this.mail.sendOtp(user.email, user.name, code);
    }
    return { message: 'Si ce compte existe et n’est pas vérifié, un nouveau code a été envoyé.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Même message pour un e-mail inconnu et un mauvais mot de passe.
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('E-mail ou mot de passe incorrect.');
    }
    if (!user.isVerified && process.env.AUTH_REQUIRE_VERIFIED !== 'false') {
      throw new ForbiddenException('Adresse e-mail non vérifiée. Saisissez le code reçu par e-mail.');
    }
    const tokens = await this.issueTokens(user.id, user.email, randomUUID());
    return { user: publicUser(user), tokens };
  }

  /**
   * Rotation : chaque refresh token n'est utilisable qu'une fois.
   * Réutiliser un jeton déjà remplacé révoque toute sa famille (détection de vol).
   */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Jeton de rafraîchissement manquant.');
    let payload: { sub: number; email: string; jti: string; fam: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException('Jeton de rafraîchissement invalide ou expiré.');
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!stored || stored.tokenHash !== hash(refreshToken)) {
      throw new UnauthorizedException('Jeton de rafraîchissement inconnu.');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Jeton de rafraîchissement expiré.');
    if (await this.prisma.revokedFamily.findUnique({ where: { family: stored.family } })) {
      throw new UnauthorizedException('Session révoquée.');
    }

    // Consommation ATOMIQUE : un seul appel peut marquer ce jeton comme utilisé.
    // Si deux requêtes présentent le même jeton en même temps, la seconde est traitée comme une réutilisation.
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (consumed.count === 0) {
      await this.revokeFamily(stored.family, 'reuse-detected');
      throw new UnauthorizedException('Jeton de rafraîchissement déjà utilisé : session révoquée.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');

    const tokens = await this.issueTokens(user.id, user.email, stored.family);
    const newId = (this.jwt.decode(tokens.refreshToken) as { jti: string }).jti;
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedBy: newId } });
    return { user: publicUser(user), tokens };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    try {
      const payload = this.jwt.verify<{ fam: string }>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
      await this.revokeFamily(payload.fam, 'logout');
    } catch {
      // Jeton invalide ou expiré : rien à révoquer.
    }
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    return publicUser(user);
  }

  private async issueTokens(userId: number, email: string, family: string): Promise<IssuedTokens> {
    const jti = randomUUID();
    const refreshExpiresAt = new Date(Date.now() + refreshTtlDays() * 24 * 3600 * 1000);
    const accessToken = this.jwt.sign(
      { sub: userId, email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: (process.env.ACCESS_TOKEN_TTL ?? '15m') as never },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId, email, jti, fam: family },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${refreshTtlDays()}d` as never },
    );
    await this.prisma.refreshToken.create({
      data: { id: jti, tokenHash: hash(refreshToken), family, expiresAt: refreshExpiresAt, userId },
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  private async revokeFamily(family: string, reason: string) {
    await this.prisma.$transaction([
      this.prisma.revokedFamily.upsert({ where: { family }, update: {}, create: { family, reason } }),
      this.prisma.refreshToken.updateMany({ where: { family, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }
}
