import { describe, expect, it } from 'vitest'
import { LapGaps, duelGap, gapSeconds, winner } from './duel'

const d = (driver: string, position: number, gap: string | null, laps: number) => ({ driver, position, gap, laps })

describe('gapSeconds', () => {
  it('lê o texto do feed', () => {
    expect(gapSeconds({ position: 1, gap: 'LAP 34' })).toBe(0)
    expect(gapSeconds({ position: 2, gap: '+1.234' })).toBe(1.234)
    expect(gapSeconds({ position: 3, gap: '12.5' })).toBe(12.5)
    expect(gapSeconds({ position: 18, gap: '1 L' })).toBeNull()
    expect(gapSeconds({ position: 5, gap: null })).toBeNull()
  })
})

describe('duelGap', () => {
  it('quanto B está atrás de A, negativo se B está na frente', () => {
    expect(duelGap({ position: 1, gap: null }, { position: 2, gap: '+0.640' })).toBe(0.64)
    expect(duelGap({ position: 4, gap: '+8.100' }, { position: 2, gap: '+3.000' })).toBe(-5.1)
    expect(duelGap({ position: 4, gap: '+8.100' }, { position: 19, gap: '1 L' })).toBeNull()
  })
})

describe('LapGaps', () => {
  it('guarda o último valor de cada volta e só usa as voltas dos dois até a atual', () => {
    const h = new LapGaps()
    h.record([d('VER', 1, null, 10), d('NOR', 2, '+2.000', 10)])
    h.record([d('VER', 1, null, 10), d('NOR', 2, '+1.800', 10)]) // fim da volta 10
    h.record([d('VER', 1, null, 11), d('NOR', 2, '+1.500', 11)])
    h.record([d('VER', 1, null, 12), d('NOR', 2, '+1.100', 12)])
    expect(h.series({ driver: 'VER', laps: 12 }, { driver: 'NOR', laps: 12 })).toEqual([
      [10, 1.8],
      [11, 1.5],
      [12, 1.1],
    ])
    // voltou na gravação para a volta 11: a volta 12 (futura) não entra
    expect(h.series({ driver: 'VER', laps: 11 }, { driver: 'NOR', laps: 11 })).toEqual([
      [10, 1.8],
      [11, 1.5],
    ])
    expect(h.series({ driver: 'VER', laps: 12 }, { driver: 'NOR', laps: 12 }, 2)).toEqual([
      [11, 1.5],
      [12, 1.1],
    ])
    expect(h.series({ driver: 'VER', laps: 12 }, { driver: 'HAM', laps: 12 })).toEqual([])
  })
})

describe('winner', () => {
  it('menor vence; com higher, maior vence', () => {
    expect(winner(28.1, 28.3)).toBe('a')
    expect(winner(28.3, 28.1)).toBe('b')
    expect(winner(330, 334, true)).toBe('b')
    expect(winner(1, 1)).toBeNull()
    expect(winner(null, 1)).toBeNull()
  })
})
