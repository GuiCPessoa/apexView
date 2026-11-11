import { describe, expect, it } from 'vitest'
import type { DriverResult, Lap } from '../types/data'
import { gapsByLap, neutralizedLaps, pitStops, positionsByLap, raceDrivers, stintsOf } from './race'

function lap(p: Partial<Lap> & { driver: string; lap: number }): Lap {
  return {
    lapTime: 90,
    sector1: null,
    sector2: null,
    sector3: null,
    position: null,
    compound: 'MEDIUM',
    stint: 1,
    tyreLife: p.lap,
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

function result(p: Partial<DriverResult> & { driver: string }): DriverResult {
  return {
    number: null,
    fullName: null,
    team: null,
    teamColor: '#ff0000',
    position: null,
    classifiedPosition: null,
    gridPosition: null,
    status: null,
    points: null,
    q1: null,
    q2: null,
    q3: null,
    ...p,
  }
}

const results = [
  result({ driver: 'BBB', team: 'X', position: 2, gridPosition: 1, classifiedPosition: '2' }),
  result({ driver: 'AAA', team: 'X', position: 1, gridPosition: 0, classifiedPosition: '1' }),
]

describe('raceDrivers', () => {
  it('ordena pela chegada e traceja o segundo piloto da equipe', () => {
    const d = raceDrivers(results)
    expect(d.map((x) => [x.driver, x.dashed])).toEqual([
      ['AAA', false],
      ['BBB', true],
    ])
  })
})

describe('positionsByLap', () => {
  it('usa o grid na volta 0 e coloca quem larga do pit lane em último', () => {
    const laps = [
      lap({ driver: 'AAA', lap: 1, position: 2 }),
      lap({ driver: 'AAA', lap: 2, position: 1 }),
      lap({ driver: 'BBB', lap: 1, position: 1 }),
    ]
    const pos = positionsByLap(laps, results)
    expect(pos.get('AAA')).toEqual([2, 2, 1])
    expect(pos.get('BBB')).toEqual([1, 1, null]) // parou de completar voltas
  })
})

describe('gapsByLap', () => {
  it('mede a diferença para o primeiro a completar cada volta', () => {
    const laps = [
      lap({ driver: 'AAA', lap: 1, endTime: 100 }),
      lap({ driver: 'BBB', lap: 1, endTime: 101.5 }),
      lap({ driver: 'AAA', lap: 2, endTime: 192 }),
      lap({ driver: 'BBB', lap: 2, endTime: 190 }),
    ]
    const gaps = gapsByLap(laps, ['AAA', 'BBB'])
    expect(gaps.get('AAA')).toEqual([0, 0, 2])
    expect(gaps.get('BBB')).toEqual([0, 1.5, 0])
  })
})

describe('stintsOf e pitStops', () => {
  const laps = [
    lap({ driver: 'AAA', lap: 1, stint: 1, compound: 'MEDIUM', tyreLife: 3, freshTyre: false }),
    lap({ driver: 'AAA', lap: 2, stint: 1, compound: 'MEDIUM', pitIn: true, pitInTime: 200 }),
    lap({ driver: 'AAA', lap: 3, stint: 2, compound: 'HARD', tyreLife: 1, pitOut: true, pitOutTime: 222.4 }),
    lap({ driver: 'AAA', lap: 4, stint: 2, compound: 'HARD', pitIn: true, pitInTime: 400 }),
  ]

  it('agrupa voltas em stints', () => {
    expect(stintsOf(laps, 'AAA')).toEqual([
      { stint: 1, compound: 'MEDIUM', fresh: false, startLap: 1, endLap: 2, startLife: 2 },
      { stint: 2, compound: 'HARD', fresh: true, startLap: 3, endLap: 4, startLife: 0 },
    ])
  })

  it('calcula o tempo no pit lane e marca quem não voltou', () => {
    expect(pitStops(laps, ['AAA'])).toEqual([
      { driver: 'AAA', lap: 2, pitLaneTime: 22.4, from: 'MEDIUM', to: 'HARD' },
      { driver: 'AAA', lap: 4, pitLaneTime: null, from: 'HARD', to: null },
    ])
  })
})

describe('neutralizedLaps', () => {
  it('classifica SC, VSC e bandeira vermelha pela volta, ficando com o mais grave', () => {
    const laps = [
      lap({ driver: 'AAA', lap: 1, trackStatus: '1' }),
      lap({ driver: 'AAA', lap: 2, trackStatus: '14' }),
      lap({ driver: 'BBB', lap: 2, trackStatus: '1' }),
      lap({ driver: 'AAA', lap: 3, trackStatus: '671' }),
      lap({ driver: 'AAA', lap: 4, trackStatus: '45' }),
    ]
    expect([...neutralizedLaps(laps)]).toEqual([
      [2, 'sc'],
      [3, 'vsc'],
      [4, 'red'],
    ])
  })
})
