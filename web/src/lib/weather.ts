import type { WeatherSample } from '../types/data'

/** Última amostra até `t` (a primeira, se `t` vier antes dela). `t` null = a mais recente. */
export function weatherAt(samples: WeatherSample[], t: number | null): WeatherSample | null {
  if (samples.length === 0) return null
  if (t == null) return samples[samples.length - 1]
  let lo = 0
  let hi = samples.length - 1
  if (t < samples[0].time) return samples[0]
  // busca binária: maior índice com time <= t
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (samples[mid].time <= t) lo = mid
    else hi = mid - 1
  }
  return samples[lo]
}

/** Períodos com chuva: cada um vai da primeira amostra com chuva até a amostra seguinte sem chuva. */
export function rainSpans(samples: WeatherSample[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let start: number | null = null
  samples.forEach((s, i) => {
    if (s.rainfall && start == null) start = s.time
    if (!s.rainfall && start != null) {
      out.push({ from: start, to: s.time })
      start = null
    }
    if (i === samples.length - 1 && start != null) out.push({ from: start, to: s.time })
  })
  return out
}

/** Variação (máx - mín) de um canal entre as amostras, para "pista esfriou 6 °C". */
export function change(samples: WeatherSample[], key: 'airTemp' | 'trackTemp'): { min: number; max: number } | null {
  const values = samples.map((s) => s[key]).filter((v): v is number => v != null)
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}

const DIRECTIONS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']

/** 225 -> "SO" (de onde o vento vem, rosa dos ventos em português). */
export function windDirection(degrees: number | null): string {
  if (degrees == null) return ''
  return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]
}

/** m/s -> km/h, arredondado. */
export const windKmh = (ms: number) => Math.round(ms * 3.6)
