import { describe, expect, it } from 'vitest'
import type { WeatherSample } from '../types/data'
import { change, rainSpans, weatherAt, windDirection, windKmh } from './weather'

const sample = (time: number, rainfall = false, trackTemp = 40): WeatherSample => ({
  time,
  airTemp: 22,
  trackTemp,
  humidity: 50,
  pressure: 1012,
  rainfall,
  windSpeed: 2,
  windDirection: 180,
})

const SAMPLES = [sample(0), sample(60, true, 35), sample(120, true, 31), sample(180, false, 30), sample(240, true, 29)]

describe('weatherAt', () => {
  it('pega a última amostra até o instante', () => {
    expect(weatherAt(SAMPLES, 130)?.time).toBe(120)
    expect(weatherAt(SAMPLES, 120)?.time).toBe(120)
    expect(weatherAt(SAMPLES, 10_000)?.time).toBe(240)
  })

  it('antes da primeira amostra usa a primeira; sem instante, a mais recente', () => {
    expect(weatherAt(SAMPLES, -50)?.time).toBe(0)
    expect(weatherAt(SAMPLES, null)?.time).toBe(240)
    expect(weatherAt([], 10)).toBeNull()
  })
})

describe('rainSpans', () => {
  it('junta amostras seguidas com chuva', () => {
    expect(rainSpans(SAMPLES)).toEqual([
      { from: 60, to: 180 },
      { from: 240, to: 240 },
    ])
  })
})

describe('change', () => {
  it('mínimo e máximo do canal', () => {
    expect(change(SAMPLES, 'trackTemp')).toEqual({ min: 29, max: 40 })
  })
})

describe('vento', () => {
  it('direção na rosa dos ventos e velocidade em km/h', () => {
    expect(windDirection(0)).toBe('N')
    expect(windDirection(225)).toBe('SO')
    expect(windDirection(359)).toBe('N')
    expect(windDirection(null)).toBe('')
    expect(windKmh(2.5)).toBe(9)
  })
})
