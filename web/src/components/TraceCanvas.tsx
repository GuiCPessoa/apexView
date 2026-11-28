import { useEffect, useRef } from 'react'
import { cssVar } from '../lib/chart'
import { tracePoints } from '../lib/live'
import { clipTrace, nextReveal, revealDone, revealHead, type Reveal } from '../lib/traceReveal'

export interface TraceSeries {
  key: string
  color: string
  d: number[]
  values: number[]
  /** volta anterior: tracejada e mais fraca */
  previous: boolean
  /** volta da linha: a mesma volta crescendo anima; volta nova aparece direto */
  lap?: number | null
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
 * Antes eram caminhos SVG de ~70 KB reescritos 4 vezes por segundo; agora redesenha quando a
 * telemetria muda (1 vez por segundo) ou a caixa muda de tamanho e, entre um envio e outro, faz a
 * ponta da volta atual crescer quadro a quadro até o fim novo (traceReveal.ts), em vez do salto.
 */
export default function TraceCanvas({ label, height, min, max, step, ticks, xMax, series }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const props = useRef({ height, min, max, step, ticks, xMax, series })
  const drawRef = useRef<(now?: number) => void>(() => undefined)
  // crescimento da ponta de cada linha (por `key`) e o último envio, para medir o intervalo
  const reveals = useRef(new Map<string, Reveal>())
  const lastSeries = useRef<{ at: number; laps: Map<string, number | null | undefined> } | null>(null)
  const frame = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const grid = cssVar('--border', '#25252c')
    const draw = (now = performance.now()) => {
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
        const r = reveals.current.get(s.key)
        const line = r ? clipTrace(s.d, s.values, revealHead(r, now), p.step) : s
        const pts = tracePoints(line.d, line.values, p.xMax, p.min, p.max, w, h, p.step)
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
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    draw()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
      drawRef.current = () => undefined
    }
  }, [])

  useEffect(() => {
    props.current = { height, min, max, step, ticks, xMax, series }
    const now = performance.now()
    const last = lastSeries.current
    const gap = last ? now - last.at : null
    const next = new Map<string, Reveal>()
    for (const s of series) {
      // só a volta atual cresce; a anterior já está completa
      if (s.previous) continue
      const end = s.d.length ? s.d[s.d.length - 1] : 0
      const same = last != null && last.laps.has(s.key) && last.laps.get(s.key) === s.lap
      next.set(s.key, nextReveal(reveals.current.get(s.key), same, end, now, gap))
    }
    reveals.current = next
    lastSeries.current = { at: now, laps: new Map(series.map((s) => [s.key, s.lap])) }

    cancelAnimationFrame(frame.current)
    const tick = (t: number) => {
      drawRef.current(t)
      if ([...reveals.current.values()].some((r) => !revealDone(r, t))) frame.current = requestAnimationFrame(tick)
    }
    tick(now)
  }, [height, min, max, step, ticks, xMax, series])

  return <canvas ref={canvasRef} className="trace-canvas" style={{ height }} role="img" aria-label={label} />
}
