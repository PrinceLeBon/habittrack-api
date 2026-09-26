/**
 * Données de départ (idempotent : peut être relancé sans créer de doublons).
 * Un compte de démonstration vérifié, avec trois habitudes et 60 jours d'historique.
 */
import { config } from 'dotenv';
config({ quiet: true });
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../generated/prisma/client';

export const DEMO_EMAIL = 'demo@habittrack.dev';
export const DEMO_PASSWORD = 'HabitTrack2026!';

const DAY = 86_400_000;
const utcDay = (offset: number) => new Date(`${new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const demo = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: {
        email: DEMO_EMAIL,
        name: 'Compte de démonstration',
        password: await bcrypt.hash(DEMO_PASSWORD, 10),
        isVerified: true,
      },
    });

    if ((await prisma.habit.count({ where: { userId: demo.id } })) === 0) {
      const start = utcDay(-60);
      const read = await prisma.habit.create({
        data: { name: 'Lire 20 minutes', color: 'indigo', frequency: 'DAILY', startDate: start, userId: demo.id },
      });
      const water = await prisma.habit.create({
        data: { name: 'Boire 2 L d’eau', color: 'sky', frequency: 'DAILY', startDate: start, userId: demo.id },
      });
      const sport = await prisma.habit.create({
        data: { name: 'Faire du sport', description: 'Course ou renforcement', color: 'emerald', frequency: 'WEEKLY', timesPerWeek: 3, startDate: start, userId: demo.id },
      });
      await prisma.habit.create({
        data: { name: 'Apprendre le piano', color: 'violet', frequency: 'DAILY', startDate: utcDay(-120), archived: true, userId: demo.id },
      });

      const checkins: { habitId: number; date: Date }[] = [];
      for (let offset = -60; offset <= -1; offset++) {
        // Des régularités différentes, pour des statistiques intéressantes (séries, taux, heatmap).
        if (offset > -12 || offset % 3 !== 0) checkins.push({ habitId: read.id, date: utcDay(offset) });
        if (offset % 2 === 0 || offset > -5) checkins.push({ habitId: water.id, date: utcDay(offset) });
        if ([1, 3, 5].includes(((offset % 7) + 7) % 7)) checkins.push({ habitId: sport.id, date: utcDay(offset) });
      }
      await prisma.checkin.createMany({ data: checkins, skipDuplicates: true });
    }
    console.log(`Seed terminé. Compte de démonstration : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
