import { describe, expect, it } from 'vitest'
import { dimmed, telemetryPair, toggleFocus } from './focus'

describe('toggleFocus', () => {
  it('adiciona, remove e mantém no máximo dois', () => {
    expect(toggleFocus([], 'VER')).toEqual(['VER'])
    expect(toggleFocus(['VER'], 'NOR')).toEqual(['VER', 'NOR'])
    expect(toggleFocus(['VER', 'NOR'], 'LEC')).toEqual(['NOR', 'LEC'])
    expect(toggleFocus(['VER', 'NOR'], 'VER')).toEqual(['NOR'])
  })
})

describe('dimmed', () => {
  it('sem foco ninguém fica apagado', () => {
    expect(dimmed([], 'VER')).toBe(false)
    expect(dimmed(['NOR'], 'VER')).toBe(true)
    expect(dimmed(['NOR'], 'NOR')).toBe(false)
  })
})

describe('telemetryPair', () => {
  const available = ['VER', 'NOR', 'LEC']
  it('usa o foco e completa com o padrão sem repetir', () => {
    expect(telemetryPair([], ['NOR', 'VER'], available)).toEqual(['NOR', 'VER'])
    expect(telemetryPair(['LEC'], ['NOR', 'VER'], available)).toEqual(['LEC', 'NOR'])
    expect(telemetryPair(['VER'], ['NOR', 'VER'], available)).toEqual(['VER', 'NOR'])
    expect(telemetryPair(['LEC', 'VER'], ['NOR', 'VER'], available)).toEqual(['LEC', 'VER'])
  })

  it('ignora piloto em foco sem telemetria', () => {
    expect(telemetryPair(['HAM'], ['NOR', 'VER'], available)).toEqual(['NOR', 'VER'])
  })
})
