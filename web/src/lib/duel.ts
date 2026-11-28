// Bloco "Duelo" do Ao vivo: diferença entre os dois pilotos em foco e como ela mudou volta a volta.
// Tudo puro, para testar.

import type { LiveDriver } from '../types/live'

/**
 * Diferença para o líder em segundos, a partir do texto do feed ("+1.234"). Líder = 0.
 * Volta de atraso ("1 L") ou texto de volta ("LAP 34") não viram número: null.
 */
export function gapSeconds(d: Pick<LiveDriver, 'gap' | 'position'>): number | null {
  if (d.position === 1) return 0
  const m = /^\+?(\d+(?:\.\d+)?)$/.exec((d.gap ?? '').trim())
  return m ? Number(m[1]) : null
}

/** Quanto `b` está atrás de `a` (s); negativo se `b` está na frente. null sem os dois números. */
export function duelGap(a: Pick<LiveDriver, 'gap' | 'position'>, b: Pick<LiveDriver, 'gap' | 'position'>): number | null {
  const ga = gapSeconds(a)
  const gb = gapSeconds(b)
  return ga == null || gb == null ? null : Math.round((gb - ga) * 1000) / 1000
}

/**
 * Diferença para o líder de cada piloto em cada volta, guardada a cada snapshot (o último valor da
 * volta fica). Serve para a tendência do duelo; voltar na gravação não confunde: `series` só usa
 * as voltas até a atual dos dois.
 */
export class LapGaps {
  private by = new Map<string, Map<number, number>>()

  record(drivers: readonly Pick<LiveDriver, 'driver' | 'gap' | 'position' | 'laps'>[]): void {
    for (const d of drivers) {
      const g = gapSeconds(d)
      if (g == null || d.laps == null) continue
      let laps = this.by.get(d.driver)
      if (!laps) this.by.set(d.driver, (laps = new Map()))
      laps.set(d.laps, g)
    }
  }

  /** [volta, quanto B está atrás de A] das últimas `count` voltas que os dois completaram. */
  series(a: Pick<LiveDriver, 'driver' | 'laps'>, b: Pick<LiveDriver, 'driver' | 'laps'>, count = 12): [number, number][] {
    const la = this.by.get(a.driver)
    const lb = this.by.get(b.driver)
    if (!la || !lb || a.laps == null || b.laps == null) return []
    const upTo = Math.min(a.laps, b.laps)
    const out: [number, number][] = []
    for (const [lap, ga] of la) {
      const gb = lb.get(lap)
      if (lap <= upTo && gb != null) out.push([lap, Math.round((gb - ga) * 1000) / 1000])
    }
    out.sort((x, y) => x[0] - y[0])
    return out.slice(-count)
  }
}

/** Quem vence uma comparação (menor é melhor, ou maior com `higher`): 'a', 'b' ou null. */
export function winner(a: number | null | undefined, b: number | null | undefined, higher = false): 'a' | 'b' | null {
  if (a == null || b == null || a === b) return null
  return (higher ? a > b : a < b) ? 'a' : 'b'
}
