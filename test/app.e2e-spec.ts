import { config } from 'dotenv';
config({ quiet: true });
process.env.RATE_LIMIT_DISABLED = 'true';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

describe('HabitTrack API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const alice = { name: 'Alice', email: `alice-${suffix}@test.dev`, password: 'MotDePasse2026' };
  const bob = { name: 'Bob', email: `bob-${suffix}@test.dev`, password: 'MotDePasse2026' };

  const http = () => request(app.getHttpServer());

  async function registerAndVerify(user: typeof alice) {
    await http().post('/auth/register').send(user).expect(201);
    const { otpCode } = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    await http().post('/auth/verify-otp').send({ email: user.email, code: otpCode }).expect(200);
    const res = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    return res.body as { access_token: string; refresh_token: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [alice.email, bob.email] } } });
    await app.close();
  });

  describe('authentification', () => {
    let tokens: { access_token: string; refresh_token: string };

    it('refuse la connexion tant que l’e-mail n’est pas vérifié', async () => {
      await http().post('/auth/register').send(alice).expect(201);
      const res = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, path: '/auth/login' });
    });

    it('renvoie 409 si l’e-mail est déjà utilisé', async () => {
      await http().post('/auth/register').send(alice).expect(409);
    });

    it('renvoie le détail des erreurs de validation', async () => {
      const res = await http().post('/auth/register').send({ name: 'X', email: 'pas-un-email', password: 'court' }).expect(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.length).toBeGreaterThanOrEqual(3);
    });

    it('vérifie le code puis connecte (mode body)', async () => {
      const { otpCode } = await prisma.user.findUniqueOrThrow({ where: { email: alice.email } });
      await http().post('/auth/verify-otp').send({ email: alice.email, code: '000000' === otpCode ? '111111' : '000000' }).expect(400);
      await http().post('/auth/verify-otp').send({ email: alice.email, code: otpCode }).expect(200);
      const res = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(200);
      expect(res.body).toMatchObject({ token_type: 'Bearer', user: { email: alice.email, name: 'Alice' } });
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
      expect(res.body.user.password).toBeUndefined();
      tokens = res.body;
    });

    it('GET /auth/me exige un jeton valide', async () => {
      await http().get('/auth/me').expect(401);
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${tokens.access_token}`).expect(200);
      expect(res.body.email).toBe(alice.email);
    });

    it('fait tourner le refresh token et détecte sa réutilisation', async () => {
      const first = await http().post('/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(200);
      expect(first.body.refresh_token).not.toBe(tokens.refresh_token);
      // Réutiliser l'ancien jeton : refusé, et toute la famille est révoquée.
      await http().post('/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(401);
      await http().post('/auth/refresh').send({ refresh_token: first.body.refresh_token }).expect(401);
    });

    it('deux renouvellements simultanés avec le même jeton révoquent toute la session', async () => {
      const login = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(200);
      const token = login.body.refresh_token as string;
      const results = await Promise.all([
        http().post('/auth/refresh').send({ refresh_token: token }),
        http().post('/auth/refresh').send({ refresh_token: token }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      const winner = results.find((r) => r.status === 200)!.body.refresh_token as string;
      // même le jeton émis à la requête « gagnante » est refusé : la session est compromise
      await http().post('/auth/refresh').send({ refresh_token: winner }).expect(401);
    });

    it('mode cookie : refresh token dans un cookie HttpOnly, absent du corps', async () => {
      const login = await http()
        .post('/auth/login')
        .set('X-Token-Transport', 'cookie')
        .send({ email: alice.email, password: alice.password })
        .expect(200);
      expect(login.body.refresh_token).toBeUndefined();
      const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('habittrack_refresh='));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/auth/);
      expect(cookie).toMatch(/SameSite=Strict/i);

      const refreshed = await http().post('/auth/refresh').set('X-Token-Transport', 'cookie').set('Cookie', cookie!.split(';')[0]).expect(200);
      expect(refreshed.body.access_token).toBeDefined();
      expect(refreshed.body.user.email).toBe(alice.email);
      const newCookie = ([] as string[]).concat(refreshed.headers['set-cookie'] ?? []).find((c) => c.startsWith('habittrack_refresh='));

      await http().post('/auth/logout').set('Cookie', newCookie!.split(';')[0]).expect(204);
      await http().post('/auth/refresh').set('Cookie', newCookie!.split(';')[0]).expect(401);
    });
  });

  describe('habitudes et validations', () => {
    let aliceToken: string;
    let bobToken: string;
    let habitId: number;
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    beforeAll(async () => {
      aliceToken = (await http().post('/auth/login').send({ email: alice.email, password: alice.password })).body.access_token;
      bobToken = (await registerAndVerify(bob)).access_token;
    });

    it('exige un jeton', async () => {
      await http().get('/habits').expect(401);
    });

    it('crée une habitude quotidienne et une hebdomadaire', async () => {
      const daily = await http().post('/habits').set(auth(aliceToken))
        .send({ name: 'Lire 20 minutes', color: 'indigo', startDate: daysAgo(30) }).expect(201);
      expect(daily.body).toMatchObject({ name: 'Lire 20 minutes', frequency: 'DAILY', timesPerWeek: null, color: 'indigo', startDate: daysAgo(30), archived: false });
      habitId = daily.body.id;
      const weekly = await http().post('/habits').set(auth(aliceToken))
        .send({ name: 'Sport', color: 'emerald', frequency: 'WEEKLY', timesPerWeek: 3, startDate: daysAgo(30) }).expect(201);
      expect(weekly.body).toMatchObject({ frequency: 'WEEKLY', timesPerWeek: 3 });
    });

    it('valide les règles : fréquence, couleur, longueur du nom, champs inconnus', async () => {
      const base = { name: 'Valide', color: 'indigo', startDate: today };
      await http().post('/habits').set(auth(aliceToken)).send({ ...base, frequency: 'WEEKLY' }).expect(400);
      await http().post('/habits').set(auth(aliceToken)).send({ ...base, timesPerWeek: 2 }).expect(400);
      await http().post('/habits').set(auth(aliceToken)).send({ ...base, color: 'noir' }).expect(400);
      await http().post('/habits').set(auth(aliceToken)).send({ ...base, name: 'ab' }).expect(400);
      await http().post('/habits').set(auth(aliceToken)).send({ ...base, streak: 3 }).expect(400);
    });

    it('rend la création idempotente avec clientId', async () => {
      const body = { name: 'Hors ligne', color: 'rose', startDate: today, clientId: '0f8fad5b-d9cb-469f-a165-70867728950e' };
      const a = await http().post('/habits').set(auth(aliceToken)).send(body).expect(201);
      const b = await http().post('/habits').set(auth(aliceToken)).send(body).expect(201);
      expect(b.body.id).toBe(a.body.id);
      await http().post('/habits').set(auth(bobToken)).send(body).expect(403);
    });

    it('valide et dé-valide des jours, de façon idempotente', async () => {
      await http().put(`/habits/${habitId}/checkins/${daysAgo(1)}`).set(auth(aliceToken)).expect(200);
      await http().put(`/habits/${habitId}/checkins/${daysAgo(1)}`).set(auth(aliceToken)).expect(200);
      await http().put(`/habits/${habitId}/checkins/${today}`).set(auth(aliceToken)).expect(200);
      const list = await http().get(`/checkins?from=${daysAgo(7)}&to=${today}`).set(auth(aliceToken)).expect(200);
      expect(list.body).toEqual([{ habitId, date: daysAgo(1) }, { habitId, date: today }]);
      await http().delete(`/habits/${habitId}/checkins/${daysAgo(1)}`).set(auth(aliceToken)).expect(204);
      await http().delete(`/habits/${habitId}/checkins/${daysAgo(1)}`).set(auth(aliceToken)).expect(204);
      const after = await http().get(`/checkins?from=${daysAgo(7)}&to=${today}`).set(auth(aliceToken)).expect(200);
      expect(after.body).toEqual([{ habitId, date: today }]);
    });

    it('refuse un jour futur, antérieur au début, ou mal formé', async () => {
      await http().put(`/habits/${habitId}/checkins/2099-01-01`).set(auth(aliceToken)).expect(400);
      await http().put(`/habits/${habitId}/checkins/${daysAgo(60)}`).set(auth(aliceToken)).expect(400);
      await http().put(`/habits/${habitId}/checkins/2026-02-30`).set(auth(aliceToken)).expect(400);
      await http().get(`/checkins?from=${today}&to=${daysAgo(3)}`).set(auth(aliceToken)).expect(400);
      await http().get('/checkins?from=2020-01-01&to=2026-01-01').set(auth(aliceToken)).expect(400);
    });

    it('archive, filtre, et protège les habitudes des autres', async () => {
      await http().patch(`/habits/${habitId}`).set(auth(aliceToken)).send({ archived: true }).expect(200);
      const archived = await http().get('/habits?archived=true').set(auth(aliceToken)).expect(200);
      expect(archived.body.map((h: { id: number }) => h.id)).toEqual([habitId]);
      await http().get(`/habits/${habitId}`).set(auth(bobToken)).expect(403);
      await http().put(`/habits/${habitId}/checkins/${today}`).set(auth(bobToken)).expect(403);
      await http().get('/habits/99999999').set(auth(aliceToken)).expect(404);
      const bobCheckins = await http().get(`/checkins?from=${daysAgo(7)}&to=${today}`).set(auth(bobToken)).expect(200);
      expect(bobCheckins.body).toEqual([]);
    });

    it('supprime une habitude et ses validations', async () => {
      await http().delete(`/habits/${habitId}`).set(auth(aliceToken)).expect(200);
      const list = await http().get(`/checkins?from=${daysAgo(7)}&to=${today}`).set(auth(aliceToken)).expect(200);
      expect(list.body).toEqual([]);
    });
  });
});
