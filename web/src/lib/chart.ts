import type uPlot from 'uplot'

export function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Cores do tema atual para eixos e grade. */
export function chartTheme() {
  return {
    axis: cssVar('--muted', '#888'),
    grid: cssVar('--border', '#333'),
    text: cssVar('--text', '#ddd'),
    surface: cssVar('--surface', '#17171c'),
  }
}

/** Faixas verticais por volta (safety car, VSC, bandeira vermelha). */
export function lapBandsPlugin(bands: Map<number, 'sc' | 'vsc' | 'red'>): uPlot.Plugin {
  const fill = { sc: 'rgba(245, 196, 0, 0.16)', vsc: 'rgba(245, 196, 0, 0.09)', red: 'rgba(225, 6, 0, 0.16)' }
  return {
    hooks: {
      drawClear: (u) => {
        const ctx = u.ctx
        ctx.save()
        for (const [lap, kind] of bands) {
          // a volta n vai de n-1 a n no eixo x (fim da volta)
          const x0 = u.valToPos(lap - 1, 'x', true)
          const x1 = u.valToPos(lap, 'x', true)
          ctx.fillStyle = fill[kind]
          ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height)
        }
        ctx.restore()
      },
    },
  }
}
