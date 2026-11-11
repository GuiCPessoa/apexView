import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface Props {
  /** Monta as opções com a largura atual (sem width/height). */
  options: (width: number) => Omit<uPlot.Options, 'width' | 'height'>
  data: uPlot.AlignedData
  height: number
  onReady?: (plot: uPlot) => void
}

/** uPlot em React: recria o gráfico quando opções/dados mudam e acompanha a largura do container. */
export default function UPlotChart({ options, data, height, onReady }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const readyRef = useRef(onReady)
  useEffect(() => {
    readyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.clientWidth
    const plot = new uPlot({ ...options(width), width, height }, data, el)
    readyRef.current?.(plot)
    const observer = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }))
    observer.observe(el)
    return () => {
      observer.disconnect()
      plot.destroy()
    }
  }, [options, data, height])

  return <div ref={ref} className="uplot-host" />
}
