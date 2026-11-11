import { describe, expect, it } from 'vitest'
import type { Calendar, CalendarRound, Standings } from '../types/data'
import { daysUntil, lineColors, spreadLabels, titleRace } from './standings'

const round = (n: number, sprint = false): CalendarRound =>
  ({ round: n, sprint, sessions: [{ code: 'R', start: `2026-11-${10 + n}T04:00:00Z` }] }) as CalendarRound
const cal = (n: number, sprints: number[] = []) => ({ rounds: Array.from({ length: n }, (_, i) => round(i + 1, sprints.includes(i + 1))) }) as Calendar
const standings = (after: number, d: number[], c: number[]) =>
  ({
    afterRound: after,
    drivers: d.map((points, i) => ({ driver: `D${i}`, points })),
    constructors: c.map((points, i) => ({ team: `T${i}`, points })),
  }) as unknown as Standings

describe('titleRace', () => {
  it('decide quando a vantagem passa do que ainda está em jogo', () => {
    const t = titleRace(standings(20, [390, 279], [652, 510]), cal(23))
    expect(t.maxDriver).toBe(75)
    expect(t.maxTeam).toBe(129)
    expect(t.driverDecided).toBe(true)
    expect(t.teamDecided).toBe(true)
  })

  it('conta as sprints e não decide com vantagem igual ao máximo', () => {
    const t = titleRace(standings(21, [100, 33], [10, 0]), cal(23, [22]))
    expect(t.maxDriver).toBe(25 + 8 + 25)
    expect(t.driverDecided).toBe(true)
    expect(titleRace(standings(21, [100, 42], [0, 0]), cal(23, [22])).driverDecided).toBe(false)
  })

  it('temporada encerrada', () => {
    const t = titleRace(standings(23, [10, 9], [5, 4]), cal(23))
    expect(t.finished).toBe(true)
    expect(t.driverDecided).toBe(true)
  })
})

describe('daysUntil', () => {
  it('conta dias de calendário', () => {
    const now = new Date(2026, 10, 11, 22, 0)
    expect(daysUntil(new Date(2026, 10, 11, 23, 0), now)).toBe('hoje')
    expect(daysUntil(new Date(2026, 10, 12, 1, 0), now)).toBe('amanhã')
    expect(daysUntil(new Date(2026, 10, 22, 1, 0), now)).toBe('em 11 dias')
  })
})

describe('spreadLabels', () => {
  it('afasta rótulos próximos e mantém a ordem original', () => {
    expect(spreadLabels([100, 50, 104, 103], 10)).toEqual([100, 50, 120, 110])
  })
})

describe('lineColors', () => {
  it('companheiros de equipe ganham cores diferentes', () => {
    expect(
      lineColors([
        { driver: 'ANT', teamColor: '#27F4D2' },
        { driver: 'VER', teamColor: '#3671c6' },
        { driver: 'RUS', teamColor: '#27f4d2' },
      ]),
    ).toEqual({ ANT: '#27f4d2', VER: '#3671c6', RUS: '#ececf0' })
  })
})
