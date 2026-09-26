import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateHabitDto, UpdateHabitDto } from './dto/habit.dto';

const DAY = 86_400_000;
const toDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

type HabitRecord = Prisma.HabitGetPayload<object>;

export function toHabitResponse(habit: HabitRecord) {
  return {
    id: habit.id,
    clientId: habit.clientId,
    name: habit.name,
    description: habit.description,
    frequency: habit.frequency,
    timesPerWeek: habit.timesPerWeek,
    color: habit.color,
    startDate: toIsoDate(habit.startDate),
    archived: habit.archived,
    userId: habit.userId,
    createdAt: habit.createdAt.toISOString(),
    updatedAt: habit.updatedAt.toISOString(),
  };
}

/** Une habitude hebdomadaire exige timesPerWeek ; une habitude quotidienne n'en a pas. */
function checkFrequency(frequency: string, timesPerWeek: number | null | undefined) {
  if (frequency === 'WEEKLY' && (timesPerWeek === null || timesPerWeek === undefined)) {
    throw new BadRequestException(['timesPerWeek est obligatoire pour une habitude hebdomadaire']);
  }
  if (frequency === 'DAILY' && timesPerWeek !== null && timesPerWeek !== undefined) {
    throw new BadRequestException(['timesPerWeek doit être absent pour une habitude quotidienne']);
  }
}

@Injectable()
export class HabitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, archived?: boolean) {
    const habits = await this.prisma.habit.findMany({
      where: { userId, ...(archived !== undefined && { archived }) },
      orderBy: { createdAt: 'asc' },
    });
    return habits.map(toHabitResponse);
  }

  async findOne(userId: number, id: number) {
    return toHabitResponse(await this.findOwned(userId, id));
  }

  /** Création idempotente : rejouer la même création avec le même clientId renvoie l'habitude existante. */
  async create(userId: number, dto: CreateHabitDto) {
    if (dto.clientId) {
      const existing = await this.prisma.habit.findUnique({ where: { clientId: dto.clientId } });
      if (existing) {
        if (existing.userId !== userId) throw new ForbiddenException('Cet identifiant client est déjà utilisé.');
        return toHabitResponse(existing);
      }
    }
    const frequency = dto.frequency ?? 'DAILY';
    checkFrequency(frequency, dto.timesPerWeek);
    try {
      const habit = await this.prisma.habit.create({
        data: { ...dto, frequency, startDate: toDate(dto.startDate), userId },
      });
      return toHabitResponse(habit);
    } catch (error) {
      if (dto.clientId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.habit.findUnique({ where: { clientId: dto.clientId } });
        if (existing && existing.userId === userId) return toHabitResponse(existing);
      }
      throw error;
    }
  }

  async update(userId: number, id: number, dto: UpdateHabitDto) {
    const current = await this.findOwned(userId, id);
    const { clientId: _ignored, startDate, ...changes } = dto;
    checkFrequency(changes.frequency ?? current.frequency, changes.timesPerWeek !== undefined ? changes.timesPerWeek : current.timesPerWeek);
    const habit = await this.prisma.habit.update({
      where: { id },
      data: { ...changes, ...(startDate !== undefined && { startDate: toDate(startDate) }) },
    });
    return toHabitResponse(habit);
  }

  async remove(userId: number, id: number) {
    await this.findOwned(userId, id);
    return toHabitResponse(await this.prisma.habit.delete({ where: { id } }));
  }

  /** Les jours validés de toutes les habitudes de l'utilisateur, sur une période (366 jours au plus). */
  async checkins(userId: number, from: string, to: string) {
    const start = toDate(from);
    const end = toDate(to);
    if (end < start) throw new BadRequestException(['to doit être postérieur ou égal à from']);
    if ((end.getTime() - start.getTime()) / DAY > 366) throw new BadRequestException(['La période est limitée à 366 jours']);
    const checkins = await this.prisma.checkin.findMany({
      where: { date: { gte: start, lte: end }, habit: { userId } },
      orderBy: [{ date: 'asc' }, { habitId: 'asc' }],
    });
    return checkins.map((c) => ({ habitId: c.habitId, date: toIsoDate(c.date) }));
  }

  /** Valider un jour : idempotent (valider deux fois le même jour ne crée qu'un enregistrement). */
  async check(userId: number, habitId: number, date: string) {
    const habit = await this.findOwned(userId, habitId);
    this.assertValidDay(date, habit.startDate);
    await this.prisma.checkin.upsert({
      where: { habitId_date: { habitId, date: toDate(date) } },
      update: {},
      create: { habitId, date: toDate(date) },
    });
    return { habitId, date };
  }

  /** Dé-valider un jour : idempotent (dé-valider un jour non validé ne fait rien). */
  async uncheck(userId: number, habitId: number, date: string) {
    await this.findOwned(userId, habitId);
    this.assertIsoDate(date);
    await this.prisma.checkin.deleteMany({ where: { habitId, date: toDate(date) } });
  }

  private assertIsoDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(toDate(date).getTime()) || toIsoDate(toDate(date)) !== date) {
      throw new BadRequestException(['La date doit être au format AAAA-MM-JJ']);
    }
  }

  private assertValidDay(date: string, startDate: Date) {
    this.assertIsoDate(date);
    // Tolérance d'un jour : « aujourd'hui » chez l'utilisateur peut être « demain » en UTC.
    const tomorrowUtc = toIsoDate(new Date(Date.now() + DAY));
    if (date > tomorrowUtc) throw new BadRequestException(['Impossible de valider un jour futur']);
    if (date < toIsoDate(startDate)) throw new BadRequestException(['Ce jour est antérieur au début de l’habitude']);
  }

  /** 404 si l'habitude n'existe pas, puis 403 si elle appartient à un autre utilisateur. */
  private async findOwned(userId: number, id: number) {
    const habit = await this.prisma.habit.findUnique({ where: { id } });
    if (!habit) throw new NotFoundException(`Habitude ${id} introuvable.`);
    if (habit.userId !== userId) throw new ForbiddenException('Cette habitude ne vous appartient pas.');
    return habit;
  }
}
