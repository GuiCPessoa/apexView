import { describe, expect, it } from 'vitest'
import type { RaceControlMessage } from '../types/data'
import { DEFAULT_RC_KINDS, countByKind, countUntil, flagClass, rcKind, visibleMessages } from './raceControl'

const msg = (time: number, message: string, extra: Partial<RaceControlMessage> = {}): RaceControlMessage => ({
  time,
  lap: 1,
  category: 'Other',
  flag: null,
  scope: null,
  sector: null,
  driver: null,
  status: null,
  message,
  ...extra,
})

const FEED = [
  msg(10, 'GREEN LIGHT - PIT EXIT OPEN', { category: 'Flag', flag: 'GREEN', scope: 'Track' }),
  msg(20, 'WAVED BLUE FLAG FOR CAR 77 (BOT) TIMED AT 15:17:33', { category: 'Flag', flag: 'BLUE', driver: 'BOT' }),
  msg(30, 'FIA STEWARDS: INCIDENT INVOLVING CAR 63 (RUS) UNDER INVESTIGATION - SPEEDING IN THE PIT LANE', { driver: 'RUS' }),
  msg(40, 'CAR 87 (BEA) TIME 1:18.683 DELETED - TRACK LIMITS AT TURN 10 LAP 25 15:37:02', { driver: 'BEA' }),
  msg(50, 'SAFETY CAR DEPLOYED', { category: 'SafetyCar', status: 'DEPLOYED' }),
  msg(60, 'DRS ENABLED', { category: 'Drs', status: 'ENABLED' }),
  msg(70, 'DOUBLE YELLOW IN TRACK SECTOR 7', { category: 'Flag', flag: 'DOUBLE YELLOW', scope: 'Sector', sector: 7 }),
  msg(80, 'RISK OF RAIN FOR F1 RACE IS 30%'),
]

describe('rcKind', () => {
  it('classifica as mensagens do feed', () => {
    expect(FEED.map(rcKind)).toEqual(['flag', 'blue', 'stewards', 'track', 'sc', 'drs', 'flag', 'other'])
  })

  it('VSC no texto conta como safety car', () => {
    expect(rcKind(msg(0, 'VSC ENDING'))).toBe('sc')
  })
})

describe('countUntil', () => {
  it('conta as mensagens que já saíram até o instante', () => {
    expect(countUntil(FEED, 5)).toBe(0)
    expect(countUntil(FEED, 10)).toBe(1)
    expect(countUntil(FEED, 45)).toBe(4)
    expect(countUntil(FEED, 1000)).toBe(FEED.length)
    expect(countUntil([], 10)).toBe(0)
  })
})

describe('visibleMessages', () => {
  it('mostra até o instante do replay, da mais recente para a mais antiga, sem bandeiras azuis', () => {
    const shown = visibleMessages(FEED, countUntil(FEED, 45), DEFAULT_RC_KINDS)
    expect(shown.map((m) => m.time)).toEqual([40, 30, 10])
  })

  it('sem limite mostra todas as mensagens dos tipos escolhidos', () => {
    expect(visibleMessages(FEED, null, new Set(['blue', 'sc'])).map((m) => m.time)).toEqual([50, 20])
  })
})

describe('countByKind', () => {
  it('conta só até o instante', () => {
    const counts = countByKind(FEED, countUntil(FEED, 30))
    expect(counts.flag).toBe(1)
    expect(counts.blue).toBe(1)
    expect(counts.stewards).toBe(1)
    expect(counts.sc).toBe(0)
  })
})

describe('flagClass', () => {
  it('vira classe CSS', () => {
    expect(flagClass('DOUBLE YELLOW')).toBe('rc-double-yellow')
  })
})
