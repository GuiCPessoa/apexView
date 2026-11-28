/**
 * Crescimento suave do gráfico da volta ao vivo.
 *
 * O servidor manda a telemetria da volta 1 vez por segundo; desenhada assim, a linha da volta
 * atual crescia aos saltos (~70 m de uma vez). Aqui a ponta da linha anda da distância em que está
 * até a nova no tempo até o próximo envio, como os carros no mapa (ver carMotion.ts).
 */

export interface Reveal {
  from: number
  to: number
  t0: number
  dur: number
}

/** Duração do crescimento: o intervalo entre envios, dentro destes limites (ms). */
export const MIN_REVEAL_MS = 150
export const MAX_REVEAL_MS = 1500

/** Distância da ponta da linha em `now`. */
export function revealHead(r: Reveal, now: number): number {
  const k = r.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - r.t0) / r.dur))
  return r.from + (r.to - r.from) * k
}

export const revealDone = (r: Reveal, now: number) => r.dur <= 0 || now >= r.t0 + r.dur

/**
 * Próximo crescimento de uma linha. Só anima quando é a mesma volta crescendo (`same`); volta
 * nova, troca de piloto ou primeira vez aparecem direto. Parte de onde a ponta está desenhada
 * agora, para não voltar atrás se o envio anterior ainda não terminou de crescer.
 */
export function nextReveal(prev: Reveal | undefined, same: boolean, end: number, now: number, gapMs: number | null): Reveal {
  if (!prev || !same || gapMs == null) return { from: end, to: end, t0: now, dur: 0 }
  const from = Math.min(revealHead(prev, now), end)
  return { from, to: end, t0: now, dur: Math.min(MAX_REVEAL_MS, Math.max(MIN_REVEAL_MS, gapMs)) }
}

/**
 * Corta a linha na distância `head`, com o último ponto interpolado nela (em degrau, no `step`).
 * Devolve as mesmas listas quando a ponta já passou do fim.
 */
export function clipTrace(d: number[], values: number[], head: number, step = false): { d: number[]; values: number[] } {
  if (d.length === 0 || head >= d[d.length - 1]) return { d, values }
  let i = 0
  while (i < d.length && d[i] <= head) i++
  if (i === 0) return { d: [], values: [] }
  const outD = d.slice(0, i)
  const outV = values.slice(0, i)
  if (outD[i - 1] < head) {
    const span = d[i] - d[i - 1]
    const k = span > 0 ? (head - d[i - 1]) / span : 0
    outD.push(head)
    outV.push(step ? values[i - 1] : values[i - 1] + (values[i] - values[i - 1]) * k)
  }
  return { d: outD, values: outV }
}
