/**
 * Movimento suave dos carros no mapa ao vivo: cada snapshot traz a posição nova, e o carro
 * desliza da posição em que está até ela no tempo até o próximo snapshot (~250 ms).
 *
 * Substitui a transição CSS em cada carro do SVG, que fazia o navegador repintar o mapa inteiro
 * (pista incluída) a cada quadro. Coordenadas no sistema do mapa (as do viewBox).
 */

export interface CarPosition {
  id: string
  x: number
  y: number
}

interface Motion {
  fx: number
  fy: number
  tx: number
  ty: number
  t0: number
  dur: number
}

/** Duração do deslize: o intervalo entre snapshots, dentro destes limites (ms). */
export const MIN_GLIDE_MS = 100
export const MAX_GLIDE_MS = 500
const DEFAULT_GLIDE_MS = 250

export class CarMotion {
  private motions = new Map<string, Motion>()
  private last: number | null = null

  /**
   * Novas posições. Cada carro parte de onde está agora; carro novo, salto maior que
   * `snapDistance` (pulo na gravação, saída do box) ou `instant` aparecem direto no lugar.
   */
  update(cars: CarPosition[], now: number, snapDistance: number, instant = false): void {
    const gap = this.last == null ? DEFAULT_GLIDE_MS : Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, now - this.last))
    this.last = now
    const next = new Map<string, Motion>()
    for (const car of cars) {
      const cur = this.position(car.id, now)
      const jump = cur == null || Math.hypot(car.x - cur[0], car.y - cur[1]) > snapDistance
      next.set(
        car.id,
        instant || jump
          ? { fx: car.x, fy: car.y, tx: car.x, ty: car.y, t0: now, dur: 0 }
          : { fx: cur[0], fy: cur[1], tx: car.x, ty: car.y, t0: now, dur: gap },
      )
    }
    this.motions = next
  }

  /** Onde o carro está desenhado em `now` (null se não está no mapa). */
  position(id: string, now: number): [number, number] | null {
    const m = this.motions.get(id)
    if (!m) return null
    const k = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.t0) / m.dur))
    return [m.fx + (m.tx - m.fx) * k, m.fy + (m.ty - m.fy) * k]
  }

  /** Algum carro ainda em movimento (para saber se vale pedir outro quadro). */
  moving(now: number): boolean {
    for (const m of this.motions.values()) if (m.dur > 0 && now - m.t0 < m.dur) return true
    return false
  }
}

/** Encaixe "meet" do SVG (preserveAspectRatio padrão): escala e deslocamento do viewBox na caixa. */
export interface Fit {
  scale: number
  ox: number
  oy: number
}

export function fitViewBox(vb: { x: number; y: number; w: number; h: number }, width: number, height: number): Fit {
  const scale = Math.min(width / vb.w, height / vb.h)
  return { scale, ox: (width - vb.w * scale) / 2 - vb.x * scale, oy: (height - vb.h * scale) / 2 - vb.y * scale }
}

/** Carro sob o ponteiro (coordenadas do mapa): o desenhado por último ganha (fica por cima). */
export function pickCar<T extends { id: string; r: number }>(
  cars: T[],
  at: (id: string) => [number, number] | null,
  x: number,
  y: number,
  minRadius: number,
): T | null {
  for (let i = cars.length - 1; i >= 0; i--) {
    const p = at(cars[i].id)
    if (p && Math.hypot(p[0] - x, p[1] - y) <= Math.max(cars[i].r * 1.6, minRadius)) return cars[i]
  }
  return null
}
