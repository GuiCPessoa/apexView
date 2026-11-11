import { describe, expect, it } from 'vitest'
import type { DriverResult, Lap } from '../types/data'
import { evolutionPoints, qualifyingSegments, rankingByBestLap, reachedSegment, sessionBestSectors } from './session'

function lap(p: Partial<Lap> & { driver: string; lap: number }): Lap {
  return {
    lapTime: null,
    sector1: null,
    sector2: null,
    sector3: null,
    position: null,
    compound: 'SOFT',
    stint: 1,
    tyreLife: 1,
    freshTyre: true,
    trackStatus: '1',
    pitIn: false,
    pitOut: false,
    startTime: null,
    endTime: null,
    pitInTime: null,
    pitOutTime: null,
    personalBest: false,
    deleted: null,
    speedTrap: null,
    segment: null,
    ...p,
  }
}

describe('rankingByBestLap', () => {
  const laps = [
    lap({ driver: 'AAA', lap: 1, lapTime: 80.5, sector1: 26.0, sector2: 27.5, sector3: 27.0, speedTrap: 340 }),
    lap({ driver: 'AAA', lap: 2, lapTime: 80.4, sector1: 26.2, sector2: 27.0, sector3: 27.2, speedTrap: 345 }),
    lap({ driver: 'BBB', lap: 1, lapTime: 80.1, sector1: 25.9, sector2: 27.1, sector3: 27.1, deleted: true }),
    lap({ driver: 'BBB', lap: 2, lapTime: 80.9, sector1: 26.1, sector2: 27.4, sector3: 27.4 }),
    lap({ driver: 'CCC', lap: 1 }), // sem tempo
  ]
  const rows = rankingByBestLap(laps, ['CCC', 'BBB', 'AAA'])

  it('ordena pela melhor volta válida e ignora voltas anuladas', () => {
    expect(rows.map((r) => [r.driver, r.best?.lapTime ?? null])).toEqual([
      ['AAA', 80.4],
      ['BBB', 80.9],
      ['CCC', null],
    ])
    expect(rows[1].gap).toBeCloseTo(0.5)
    expect(rows[1].interval).toBeCloseTo(0.5)
  })

  it('calcula melhores setores, volta ideal e velocidade máxima', () => {
    expect(rows[0].bestSectors).toEqual([26.0, 27.0, 27.0])
    expect(rows[0].ideal).toBe(80)
    expect(rows[0].topSpeed).toBe(345)
    expect(sessionBestSectors(rows)).toEqual([26.0, 27.0, 27.0])
  })
})

describe('qualifyingSegments', () => {
  it('usa a saída do pit lane como início, não o startTime da volta de saída', () => {
    const laps = [
      lap({ driver: 'AAA', lap: 1, segment: 1, startTime: 0, pitOutTime: 10, endTime: 100 }),
      lap({ driver: 'AAA', lap: 2, segment: 1, startTime: 100, endTime: 180 }),
      // volta de saída do Q2: startTime "herdado" do fim da volta anterior
      lap({ driver: 'AAA', lap: 3, segment: 2, startTime: 180, pitOutTime: 1500, endTime: 1600 }),
      lap({ driver: 'AAA', lap: 4, segment: 2, startTime: 1600, endTime: 1680 }),
    ]
    expect(qualifyingSegments(laps)).toEqual([
      { n: 1, start: 10, end: 180 },
      { n: 2, start: 1500, end: 1680 },
    ])
  })
})

describe('reachedSegment', () => {
  const r = (q1: number | null, q2: number | null, q3: number | null) =>
    ({ q1, q2, q3 }) as unknown as DriverResult
  it('identifica até onde o piloto chegou', () => {
    expect(reachedSegment(r(80, 79.8, 79.5))).toBe(3)
    expect(reachedSegment(r(80, 79.8, null))).toBe(2)
    expect(reachedSegment(r(80, null, null))).toBe(1)
  })
})

describe('evolutionPoints', () => {
  it('exclui voltas lentas, de box e anuladas', () => {
    const laps = [
      lap({ driver: 'AAA', lap: 1, lapTime: 100, endTime: 50 }),
      lap({ driver: 'AAA', lap: 2, lapTime: 104, endTime: 150 }),
      lap({ driver: 'AAA', lap: 3, lapTime: 120, endTime: 270 }), // acima de 107%
      lap({ driver: 'AAA', lap: 4, lapTime: 101, endTime: 380, pitIn: true }),
      lap({ driver: 'AAA', lap: 5, lapTime: 99, endTime: 480, deleted: true }),
    ]
    expect(evolutionPoints(laps).map((p) => p.lap)).toEqual([1, 2])
  })
})
