import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { lapCursorPlugin } from '../lib/chart'

interface Props {
  /** Monta as opções com a largura atual (sem width/height). */
  options: (width: number) => Omit<uPlot.Options, 'width' | 'height'>
  data: uPlot.AlignedData
  height: number
  onReady?: (plot: uPlot) => void
  /** Volta atual do replay: desenha uma linha vertical sem recriar o gráfico. */
  cursorLap?: number | null
}

/** uPlot em React: recria o gráfico quando opções/dados mudam e acompanha a largura do container. */
export default function UPlotChart({ options, data, height, onReady, cursorLap }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const lapRef = useRef<number | null>(cursorLap ?? null)
  const readyRef = useRef(onReady)
  useEffect(() => {
    readyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.clientWidth
    const opts = options(width)
    const plot = new uPlot(
      { ...opts, plugins: [...(opts.plugins ?? []), lapCursorPlugin(lapRef)], width, height },
      data,
      el,
    )
    plotRef.current = plot
    readyRef.current?.(plot)
    const observer = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }))
    observer.observe(el)
    return () => {
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [options, data, height])

  useEffect(() => {
    lapRef.current = cursorLap ?? null
    plotRef.current?.redraw(false)
  }, [cursorLap])

  return <div ref={ref} className="uplot-host" />
}
