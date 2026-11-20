import { useEffect, useRef } from 'react'
import { cssVar } from '../lib/chart'
import { tracePoints } from '../lib/live'

export interface TraceSeries {
  key: string
  color: string
  d: number[]
  values: number[]
  /** volta anterior: tracejada e mais fraca */
  previous: boolean
}

interface Props {
  label: string
  height: number
  min: number
  max: number
  step: boolean
  ticks: readonly number[]
  xMax: number
  series: TraceSeries[] // na ordem de desenho
}

/**
 * Um canal da volta (velocidade, acelerador ou freio) desenhado num canvas.
 * Antes eram caminhos SVG de ~70 KB reescritos 4 vezes por segundo; agora só redesenha
 * quando a telemetria muda (1 vez por segundo) ou a caixa muda de tamanho.
 */
export default function TraceCanvas({ label, height, min, max, step, ticks, xMax, series }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const props = useRef({ height, min, max, step, ticks, xMax, series })
  const drawRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const grid = cssVar('--border', '#25252c')
    const draw = () => {
      const p = props.current
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = p.height
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.lineWidth = 1
      ctx.strokeStyle = grid
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      for (const v of p.ticks) {
        const y = Math.round(h - ((v - p.min) / (p.max - p.min)) * h) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      ctx.lineJoin = 'round'
      for (const s of p.series) {
        const pts = tracePoints(s.d, s.values, p.xMax, p.min, p.max, w, h, p.step)
        if (pts.length < 4) continue
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.previous ? 1.2 : 1.8
        ctx.globalAlpha = s.previous ? 0.45 : 1
        ctx.setLineDash(s.previous ? [4, 4] : [])
        ctx.beginPath()
        ctx.moveTo(pts[0], pts[1])
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.setLineDash([])
    }
    drawRef.current = draw
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    draw()
    return () => {
      observer.disconnect()
      drawRef.current = () => undefined
    }
  }, [])

  useEffect(() => {
    props.current = { height, min, max, step, ticks, xMax, series }
    drawRef.current()
  }, [height, min, max, step, ticks, xMax, series])

  return <canvas ref={canvasRef} className="trace-canvas" style={{ height }} role="img" aria-label={label} />
}
