import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { cssVar } from '../lib/chart'
import type { Channels, Comparison } from '../lib/telemetry'
import type { Corner } from '../types/data'

interface Props {
  comparison: Comparison
  colorA: string
  colorB: string
  corners: Corner[]
  onHover: (index: number | null) => void
}

interface ChartSpec {
  key: string
  label: string
  height: number
  /** Canais de A e de B (B só quando há comparação). */
  series: (c: Comparison) => (number | null)[][]
  names: string[]
  range?: [number, number]
  step?: boolean
  delta?: boolean
  showCorners?: boolean
}

/** Canal de A e, se houver comparação, o de B (degraus de B um pouco abaixo para não esconder A). */
function both(c: Comparison, pick: (x: Channels) => number[], scaleB = 1): number[][] {
  if (!c.b) return [pick(c.a)]
  const b = pick(c.b)
  return [pick(c.a), scaleB === 1 ? b : b.map((v) => v * scaleB)]
}

const CHARTS: ChartSpec[] = [
  {
    key: 'delta',
    label: 'Diferença (s) · acima de 0 = B atrás',
    height: 110,
    series: (c) => [c.delta ?? []],
    names: ['Δ'],
    delta: true,
  },
  {
    key: 'speed',
    label: 'Velocidade (km/h)',
    height: 220,
    series: (c) => both(c, (x) => x.speed),
    names: ['A', 'B'],
    showCorners: true,
  },
  {
    key: 'throttle',
    label: 'Acelerador (%)',
    height: 100,
    series: (c) => both(c, (x) => x.throttle),
    names: ['A', 'B'],
    range: [-5, 105],
  },
  {
    key: 'brake',
    label: 'Freio',
    height: 64,
    series: (c) => both(c, (x) => x.brake, 0.85),
    names: ['A', 'B'],
    range: [-0.1, 1.1],
    step: true,
  },
  {
    key: 'gear',
    label: 'Marcha',
    height: 100,
    series: (c) => both(c, (x) => x.gear),
    names: ['A', 'B'],
    range: [0, 9],
    step: true,
  },
  {
    key: 'drs',
    label: 'DRS',
    height: 64,
    series: (c) => both(c, (x) => x.drs, 0.85),
    names: ['A', 'B'],
    range: [-0.1, 1.1],
    step: true,
  },
]

const SYNC_KEY = 'apexview-telemetry'

/** Linhas verticais com o número das curvas (distâncias do track.json). */
function cornersPlugin(corners: Corner[], color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx
        const { top, height } = u.bbox
        ctx.save()
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.setLineDash([3 * devicePixelRatio, 4 * devicePixelRatio])
        ctx.lineWidth = devicePixelRatio
        ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        for (const c of corners) {
          const x = u.valToPos(c.distance, 'x', true)
          if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue
          ctx.beginPath()
          ctx.moveTo(x, top)
          ctx.lineTo(x, top + height)
          ctx.stroke()
          ctx.fillText(`${c.number}${c.letter ?? ''}`, x, top + 12 * devicePixelRatio)
        }
        ctx.restore()
      },
    },
  }
}

export default function TelemetryCharts({ comparison, colorA, colorB, corners, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef(onHover)
  useEffect(() => {
    hoverRef.current = onHover
  }, [onHover])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const axisColor = cssVar('--muted', '#888')
    const gridColor = cssVar('--border', '#333')
    const zeroColor = cssVar('--text', '#ddd')
    const width = container.clientWidth

    const plots: uPlot[] = []
    let syncing = false

    // sem B não há diferença a mostrar
    const charts = comparison.b ? CHARTS : CHARTS.filter((s) => !s.delta)

    for (const spec of charts) {
      const wrap = document.createElement('div')
      wrap.className = 'tchart'
      const title = document.createElement('div')
      title.className = 'tchart-title'
      title.textContent = spec.label
      wrap.appendChild(title)
      container.appendChild(wrap)

      const data = [comparison.d, ...spec.series(comparison)] as uPlot.AlignedData
      const colors = (spec.delta ? [colorB] : [colorA, colorB]).slice(0, data.length - 1)
      const isLast = spec === charts[charts.length - 1]

      const opts: uPlot.Options = {
        width,
        height: spec.height,
        legend: { show: false },
        cursor: {
          sync: { key: SYNC_KEY, setSeries: false },
          drag: { x: true, y: false, setScale: true },
          points: { size: 6 },
        },
        scales: {
          x: { time: false },
          y: spec.range ? { range: spec.range } : spec.delta ? { range: (_u, min, max) => {
            const m = Math.max(Math.abs(min), Math.abs(max), 0.1) * 1.1
            return [-m, m]
          } } : {},
        },
        axes: [
          {
            stroke: axisColor,
            grid: { stroke: gridColor, width: 1 },
            ticks: { stroke: gridColor },
            size: isLast ? 30 : 8,
            values: isLast ? (_u, vals) => vals.map((v) => `${(v / 1000).toFixed(1)} km`) : () => [],
          },
          {
            stroke: axisColor,
            grid: { stroke: gridColor, width: 1 },
            ticks: { stroke: gridColor },
            size: 48,
            ...(spec.step && spec.key !== 'gear' ? { values: () => [] } : {}),
          },
        ],
        series: [
          { label: 'Distância' },
          ...colors.map((stroke, i) => ({
            label: spec.names[i],
            stroke,
            width: 1.6,
            points: { show: false },
            ...(spec.step ? { paths: uPlot.paths.stepped!({ align: 1 }) } : {}),
            ...(spec.delta ? { fill: `${stroke}22` } : {}),
          })),
        ],
        plugins: spec.showCorners ? [cornersPlugin(corners, axisColor)] : [],
        hooks: {
          setCursor: [(u) => hoverRef.current(u.cursor.idx ?? null)],
          // zoom (arrastar) e reset (duplo clique) valem para todos os gráficos
          setScale: [
            (u, key) => {
              if (key !== 'x' || syncing) return
              syncing = true
              const { min, max } = u.scales.x
              for (const p of plots) if (p !== u) p.setScale('x', { min: min!, max: max! })
              syncing = false
            },
          ],
          ...(spec.delta
            ? {
                draw: [
                  (u: uPlot) => {
                    const y = u.valToPos(0, 'y', true)
                    u.ctx.save()
                    u.ctx.strokeStyle = zeroColor
                    u.ctx.globalAlpha = 0.4
                    u.ctx.beginPath()
                    u.ctx.moveTo(u.bbox.left, y)
                    u.ctx.lineTo(u.bbox.left + u.bbox.width, y)
                    u.ctx.stroke()
                    u.ctx.restore()
                  },
                ],
              }
            : {}),
        },
      }
      plots.push(new uPlot(opts, data, wrap))
    }

    const container2 = container
    const observer = new ResizeObserver(() => {
      const w = container2.clientWidth
      for (let i = 0; i < plots.length; i++) plots[i].setSize({ width: w, height: charts[i].height })
    })
    observer.observe(container)
    const onLeave = () => hoverRef.current(null)
    container.addEventListener('mouseleave', onLeave)

    return () => {
      observer.disconnect()
      container.removeEventListener('mouseleave', onLeave)
      for (const p of plots) p.destroy()
      container.innerHTML = ''
    }
  }, [comparison, colorA, colorB, corners])

  return <div ref={containerRef} className="tcharts" />
}
