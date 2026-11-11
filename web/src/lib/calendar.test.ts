import { describe, expect, it } from 'vitest'
import type { CalendarRound, SessionCode } from '../types/data'
import { countdown, isDone, nextSession, sessionDate, sessionsByDay, timelineScale, weekendRange } from './calendar'

const round = (n: number, sessions: [SessionCode, string][]): CalendarRound =>
  ({ round: n, eventName: `GP ${n}`, sessions: sessions.map(([code, start]) => ({ code, start })) }) as CalendarRound

// horários locais (o teste não depende do fuso da máquina)
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

const r20 = round(20, [['FP1', local(2026, 11, 6, 12)], ['Q', local(2026, 11, 7, 15)], ['R', local(2026, 11, 8, 14)]])
const r21 = round(21, [['FP1', local(2026, 11, 19, 21, 30)], ['FP2', local(2026, 11, 20, 1)], ['R', local(2026, 11, 22, 1)]])
const r22 = round(22, [['R', local(2026, 11, 29, 13)]])

describe('calendário', () => {
  it('rodada disputada ~2 h depois da largada', () => {
    expect(isDone(r20, new Date(2026, 10, 8, 15))).toBe(false)
    expect(isDone(r20, new Date(2026, 10, 8, 16, 1))).toBe(true)
    expect(isDone(round(1, [['R', '']]), new Date())).toBe(false)
  })

  it('próxima sessão pula rodadas disputadas e sessões já começadas', () => {
    const next = nextSession([r20, r21, r22], new Date(2026, 10, 19, 22))
    expect(next?.round.round).toBe(21)
    expect(next?.session.code).toBe('FP2')
    expect(nextSession([r20], new Date(2026, 11, 1))).toBeNull()
  })

  it('datas do fim de semana', () => {
    expect(weekendRange(r20)).toBe('06–08 nov')
    expect(weekendRange(round(19, [['FP1', local(2026, 10, 30)], ['R', local(2026, 11, 1)]]))).toBe('30 out – 01 nov')
    expect(weekendRange(round(1, []))).toBe('a definir')
  })

  it('só a data vira meio-dia UTC', () => {
    expect(sessionDate('2026-03-15')?.toISOString()).toBe('2026-03-15T12:00:00.000Z')
    expect(sessionDate(null)).toBeNull()
  })

  it('agrupa por dia local', () => {
    const days = sessionsByDay(r21.sessions)
    expect(days.map((d) => d.sessions.map((s) => s.code))).toEqual([['FP1'], ['FP2'], ['R']])
    expect(days[0].day).toContain('19/11')
  })

  it('contagem regressiva', () => {
    expect(countdown(new Date(2026, 10, 19, 21, 30), new Date(2026, 10, 11, 14))).toEqual({ days: 8, hours: 7, minutes: 30 })
    expect(countdown(new Date(0), new Date(1000))).toEqual({ days: 0, hours: 0, minutes: 0 })
  })

  it('linha do tempo cobre os meses inteiros', () => {
    const scale = timelineScale([r20, r22])!
    expect(scale.months.map((m) => m.label)).toEqual(['nov'])
    expect(scale.pct(new Date(2026, 10, 1).getTime())).toBe(0)
    expect(scale.pct(new Date(2027, 0, 1).getTime())).toBe(100)
  })
})
