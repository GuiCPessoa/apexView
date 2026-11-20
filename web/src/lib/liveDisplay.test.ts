import { describe, expect, it } from 'vitest'
import type { LiveDriver } from '../types/live'
import { dominanceCount, dominanceSpans, liveDriverColors, nearestIndex, segmentClass, teamCode, windLabel } from './liveDisplay'

describe('teamCode', () => {
  it('sigla de cada equipe, sem confundir Red Bull com Racing Bulls', () => {
    expect(teamCode('Red Bull Racing')).toBe('RBR')
    expect(teamCode('Racing Bulls')).toBe('RB')
    expect(teamCode('Haas F1 Team')).toBe('HAA')
    expect(teamCode('Aston Martin')).toBe('AMR')
    expect(teamCode('Equipe Nova')).toBe('EQU')
    expect(teamCode(null)).toBe('')
  })
})

describe('mini setores', () => {
  it('cores pelo status do feed', () => {
    expect([2048, 2049, 2051, 2064, 0].map(segmentClass)).toEqual(['seg-y', 'seg-p', 'seg-o', 'seg-pit', 'seg-none'])
  })
})

describe('domínio da pista', () => {
  // traçado reto de 100 pontos (x = índice)
  const outline: [number, number][] = Array.from({ length: 100 }, (_, i) => [i, 0])

  it('acha o ponto mais próximo', () => {
    expect(nearestIndex(outline, [41.4, 3])).toBe(41)
  })

  it('cada mini setor vai do fim do anterior até o seu fim', () => {
    const spans = dominanceSpans(outline, { sizes: [2, 1], owners: ['NOR', null, 'LEC'], ends: [[30, 0], [70, 0], [99, 0]] })
    expect(spans.map((s) => [s.from, s.to, s.owner])).toEqual([
      [0, 30, 'NOR'],
      [30, 70, null],
      [70, 100, 'LEC'],
    ])
  })

  it('trechos sem posição dividem o espaço; leitura fora de ordem é ignorada', () => {
    const spans = dominanceSpans(outline, {
      sizes: [4],
      owners: ['A', 'B', 'C', 'D'],
      ends: [[20, 0], null, [10, 0], null], // o 3º "volta para trás": vira desconhecido
    })
    expect(spans.map((s) => [s.from, s.to])).toEqual([
      [0, 20],
      [20, 47],
      [47, 73],
      [73, 100],
    ])
    expect(spans[0].known).toBe(true)
    expect(spans[1].known).toBe(false)
  })

  it('fim perto da linha que deu a volta no índice', () => {
    const spans = dominanceSpans(outline, { sizes: [3], owners: ['A', 'B', 'C'], ends: [[50, 0], [98, 0], [1, 0]] })
    expect(spans.map((s) => s.to)).toEqual([50, 98, 100])
  })

  it('conta quantos mini setores cada um domina', () => {
    expect(dominanceCount({ sizes: [4], owners: ['NOR', 'LEC', 'NOR', null], ends: [] })).toEqual([
      { driver: 'NOR', count: 2 },
      { driver: 'LEC', count: 1 },
    ])
  })
})

describe('cores e textos', () => {
  it('companheiro de equipe em tom claro; equipes de cor parecida ficam com a cor delas', () => {
    const d = (driver: string, team: string, teamColor: string) => ({ driver, team, teamColor }) as LiveDriver
    const c = liveDriverColors([
      d('HAD', 'Red Bull Racing', '#4781D7'),
      d('LEC', 'Ferrari', '#ED1131'),
      d('ALB', 'Williams', '#1868DB'),
      d('HAM', 'Ferrari', '#ED1131'),
      d('SAI', 'Williams', '#1868DB'),
    ])
    expect(c.get('LEC')).toBe('#ED1131')
    expect(c.get('HAM')).not.toBe('#ED1131')
    expect(c.get('ALB')).toBe('#1868DB') // parecida com a Red Bull, mas outra equipe
    expect(c.get('SAI')).not.toBe('#1868DB')
  })

  it('vento em pontos cardeais', () => {
    expect(windLabel(209)).toBe('SO')
    expect(windLabel(0)).toBe('N')
    expect(windLabel(359)).toBe('N')
    expect(windLabel(null)).toBe('')
  })
})
