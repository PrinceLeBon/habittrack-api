import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthUser = { id: number; email: string };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
