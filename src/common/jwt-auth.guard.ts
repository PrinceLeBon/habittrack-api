import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Vérifie l'en-tête `Authorization: Bearer <access_token>` et place l'utilisateur dans `request.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers.authorization;
    const [type, token] = header?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Jeton d’accès manquant.');
    }
    try {
      const payload = this.jwt.verify<{ sub: number; email: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Jeton d’accès invalide ou expiré.');
    }
  }
}
