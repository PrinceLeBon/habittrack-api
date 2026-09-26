import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CheckinsQuery, CreateHabitDto, ListHabitsQuery, UpdateHabitDto } from './dto/habit.dto';
import { HabitsService } from './habits.service';

@ApiTags('habits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class HabitsController {
  constructor(private readonly habits: HabitsService) {}

  @Get('habits')
  @ApiOperation({ summary: 'Lister ses habitudes (filtre archived facultatif)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListHabitsQuery) {
    return this.habits.findAll(user.id, query.archived);
  }

  @Get('habits/:id')
  @ApiOperation({ summary: 'Une habitude' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.habits.findOne(user.id, id);
  }

  @Post('habits')
  @ApiOperation({ summary: 'Créer une habitude (idempotent si clientId est fourni)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHabitDto) {
    return this.habits.create(user.id, dto);
  }

  @Patch('habits/:id')
  @ApiOperation({ summary: 'Modifier une habitude (y compris archiver : { "archived": true })' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHabitDto) {
    return this.habits.update(user.id, id, dto);
  }

  @Delete('habits/:id')
  @ApiOperation({ summary: 'Supprimer une habitude et ses validations (renvoie l’habitude supprimée)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.habits.remove(user.id, id);
  }

  @Get('checkins')
  @ApiOperation({ summary: 'Les jours validés sur une période (366 jours au plus)' })
  checkins(@CurrentUser() user: AuthUser, @Query() query: CheckinsQuery) {
    return this.habits.checkins(user.id, query.from, query.to);
  }

  @Put('habits/:id/checkins/:date')
  @ApiOperation({ summary: 'Valider un jour (idempotent)' })
  check(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('date') date: string) {
    return this.habits.check(user.id, id, date);
  }

  @Delete('habits/:id/checkins/:date')
  @HttpCode(204)
  @ApiOperation({ summary: 'Dé-valider un jour (idempotent)' })
  async uncheck(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('date') date: string) {
    await this.habits.uncheck(user.id, id, date);
  }
}
