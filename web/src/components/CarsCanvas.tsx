import { useEffect, useRef } from 'react'
import { cssVar } from '../lib/chart'
import { CarMotion, fitViewBox, pickCar, type Fit } from '../lib/carMotion'

export interface CanvasCar {
  id: string
  x: number // coordenadas do mapa (viewBox)
  y: number
  r: number
  color: string
  focused: boolean
  dim: boolean
  label: string | null
}

interface Props {
  viewBox: { x: number; y: number; w: number; h: number }
  cars: CanvasCar[] // na ordem de desenho (o último fica por cima)
  labelSize: number // em unidades do mapa
  onPick: (id: string) => void
  /** Distância (unidades do mapa) acima da qual o carro pula em vez de deslizar. */
  snapDistance: number
}

/**
 * Quadros por segundo da animação. Medido: a animação a 60 qps era o maior custo da aba Ao vivo
 * (sem ela, GPU de ~9,5% para ~1,3%); a 4 snapshots por segundo, 30 qps já desliza liso.
 */
export const CAR_FPS = 30

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Carros do mapa ao vivo num canvas por cima da pista (que é um SVG estático): só esta camada
 * é redesenhada enquanto os carros andam, e só enquanto andam.
 */
export default function CarsCanvas({ viewBox, cars, labelSize, onPick, snapDistance }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motion = useRef(new CarMotion())
  const state = useRef({ cars, viewBox, labelSize, hover: null as string | null, fit: null as Fit | null, dpr: 1 })
  const frame = useRef(0)
  const drawRef = useRef<() => void>(() => undefined)
  const pickRef = useRef(onPick)

  useEffect(() => {
    pickRef.current = onPick
  }, [onPick])

  // desenho e laço de animação (só roda enquanto algum carro se move)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const surface = cssVar('--surface', '#131317')
    const text = cssVar('--text', '#ececf0')
    const font = getComputedStyle(canvas).fontFamily || 'sans-serif'

    let lastDraw = -Infinity
    const frameMs = 1000 / CAR_FPS
    const tick = (now: number) => {
      // limita a taxa de quadros: só desenha quando passou um quadro inteiro (com folga de 2 ms)
      if (now - lastDraw < frameMs - 2) {
        frame.current = requestAnimationFrame(tick)
        return
      }
      lastDraw = now
      draw()
    }
    const draw = () => {
      frame.current = 0
      const s = state.current
      const fit = s.fit
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!fit) return
      const now = performance.now()
      ctx.setTransform(fit.scale * s.dpr, 0, 0, fit.scale * s.dpr, fit.ox * s.dpr, fit.oy * s.dpr)
      ctx.font = `800 ${s.labelSize}px ${font}`
      ctx.lineJoin = 'round'
      for (const car of s.cars) {
        const p = motion.current.position(car.id, now)
        if (!p) continue
        const r = car.focused ? car.r * 1.5 : car.r
        ctx.globalAlpha = car.dim ? (s.hover === car.id ? 0.8 : 0.4) : 1
        ctx.beginPath()
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2)
        ctx.fillStyle = car.color
        ctx.fill()
        ctx.lineWidth = car.r * 0.3
        ctx.strokeStyle = car.focused ? '#fff' : surface
        ctx.stroke()
        if (car.label) {
          ctx.lineWidth = s.labelSize * 0.16
          ctx.strokeStyle = surface
          ctx.strokeText(car.label, p[0] + car.r * 2, p[1] - car.r * 1.4)
          ctx.fillStyle = text
          ctx.fillText(car.label, p[0] + car.r * 2, p[1] - car.r * 1.4)
        }
      }
      ctx.globalAlpha = 1
      if (motion.current.moving(now)) frame.current = requestAnimationFrame(tick)
    }
    drawRef.current = () => {
      if (!frame.current) frame.current = requestAnimationFrame(tick)
    }

    // tamanho do canvas acompanha a caixa (e a densidade de pixels da tela)
    const resize = () => {
      const s = state.current
      s.dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * s.dpr)
      canvas.height = Math.round(canvas.clientHeight * s.dpr)
      s.fit = fitViewBox(s.viewBox, canvas.clientWidth, canvas.clientHeight)
      drawRef.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
      frame.current = 0
      drawRef.current = () => undefined
    }
  }, [])

  // posições novas a cada snapshot
  useEffect(() => {
    const s = state.current
    s.cars = cars
    s.labelSize = labelSize
    if (s.viewBox !== viewBox) {
      s.viewBox = viewBox
      const canvas = canvasRef.current
      if (canvas) s.fit = fitViewBox(viewBox, canvas.clientWidth, canvas.clientHeight)
    }
    motion.current.update(cars, performance.now(), snapDistance, reducedMotion())
    drawRef.current()
  }, [cars, viewBox, labelSize, snapDistance])

  const toMap = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const fit = state.current.fit
    if (!fit) return null
    const rect = e.currentTarget.getBoundingClientRect()
    return [(e.clientX - rect.left - fit.ox) / fit.scale, (e.clientY - rect.top - fit.oy) / fit.scale]
  }
  const hit = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toMap(e)
    const fit = state.current.fit
    if (!p || !fit) return null
    // alvo mínimo de ~12 px na tela, para dar para acertar no celular
    return pickCar(state.current.cars, (id) => motion.current.position(id, performance.now()), p[0], p[1], 12 / fit.scale)
  }

  return (
    <canvas
      ref={canvasRef}
      className="cars-layer"
      aria-hidden="true"
      onPointerMove={(e) => {
        const car = hit(e)
        e.currentTarget.style.cursor = car ? 'pointer' : ''
        const id = car?.id ?? null
        if (id !== state.current.hover) {
          state.current.hover = id
          drawRef.current()
        }
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.cursor = ''
        if (state.current.hover) {
          state.current.hover = null
          drawRef.current()
        }
      }}
      onClick={(e) => {
        const car = hit(e as unknown as React.PointerEvent<HTMLCanvasElement>)
        if (car) pickRef.current(car.id)
      }}
    />
  )
}
