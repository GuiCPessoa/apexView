import { describe, expect, it } from 'vitest'
import type { DriverResult, Lap } from '../types/data'
import { buildRaceModel, formatClock, positionAt, positionCoverage, statusAt, towerAt } from './replay'

const lap = (driver: string, n: number, endTime: number, extra: Partial<Lap> = {}): Lap => ({
  driver,
  lap: n,
  lapTime: 90,
  sector1: null,
  sector2: null,
  sector3: null,
  position: null,
  compound: 'MEDIUM',
  stint: 1,
  tyreLife: n,
  freshTyre: true,
  trackStatus: '1',
  pitIn: false,
  pitOut: false,
  startTime: endTime - 90,
  endTime,
  pitInTime: null,
  pitOutTime: null,
  personalBest: false,
  deleted: null,
  speedTrap: null,
  segment: null,
  ...extra,
})

const res = (driver: string, grid: number, classified = '1'): DriverResult => ({
  driver,
  number: null,
  fullName: null,
  team: null,
  teamColor: null,
  position: null,
  classifiedPosition: classified,
  gridPosition: grid,
  status: null,
  points: null,
  q1: null,
  q2: null,
  q3: null,
})

describe('positionAt', () => {
  it('interpola entre amostras e devolve null sem dado', () => {
    const p = { driver: 'AAA', start: 100, hz: 2, x: [0, 10, null], y: [0, -10, null] }
    expect(positionAt(p, 100.25)).toEqual([5, -5])
    expect(positionAt(p, 101)).toBeNull()
    expect(positionAt(p, 99)).toBeNull()
  })
})

describe('towerAt', () => {
  const results = [res('AAA', 2), res('BBB', 1), res('CCC', 3, 'R')]
  const laps = [
    lap('AAA', 1, 100),
    lap('BBB', 1, 101.2),
    lap('CCC', 1, 103),
    lap('AAA', 2, 190),
    lap('BBB', 2, 192.5, { pitInTime: 185 }),
  ]
  const model = buildRaceModel(laps, results)

  it('antes da volta 1 segue o grid', () => {
    expect(towerAt(model, 50).map((r) => r.driver)).toEqual(['BBB', 'AAA', 'CCC'])
  })

  it('ordena por voltas completas e mostra gaps, pit e abandono', () => {
    const rows = towerAt(model, 191)
    expect(rows.map((r) => [r.driver, r.gap])).toEqual([
      ['AAA', 'Líder'],
      ['BBB', '+1.2'],
      ['CCC', 'Abandono'],
    ])
    expect(rows[1].inPit).toBe(true)
  })
})

describe('statusAt e formatClock', () => {
  it('mantém o último status até a próxima mudança', () => {
    const changes = [
      { time: 10, status: 'green' as const, code: '1', message: null },
      { time: 50, status: 'sc' as const, code: '4', message: null },
    ]
    expect(statusAt(changes, 5)).toBe('green')
    expect(statusAt(changes, 60)).toBe('sc')
  })

  it('formata o relógio de prova', () => {
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })
})

describe('positionCoverage', () => {
  it('média da fração de amostras conhecidas por piloto', () => {
    const p = (x: (number | null)[]) => ({ driver: 'X', start: 0, hz: 1, x, y: x })
    expect(positionCoverage([p([1, 2, null, null]), p([1, 1, 1, 1])])).toBe(0.75)
    expect(positionCoverage([])).toBe(0)
  })
})
