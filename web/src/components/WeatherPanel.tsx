import { useCallback, useMemo } from 'react'
import type uPlot from 'uplot'
import { chartTheme } from '../lib/chart'
import { rainSpans, weatherAt, windDirection, windKmh } from '../lib/weather'
import type { WeatherSample } from '../types/data'
import UPlotChart from './UPlotChart'

const AIR = '#60a5fa'
const TRACK = '#fb923c'

interface Props {
  samples: WeatherSample[]
  /** Instante mostrado (replay). null = a amostra mais recente (ao vivo). */
  now: number | null
  /** Rótulo do eixo do tempo (relógio da prova no replay, hora local no ao vivo). */
  formatX: (t: number) => string
}

/** Condições no instante mostrado e a evolução das temperaturas, com os períodos de chuva. */
export default function WeatherPanel({ samples, now, formatX }: Props) {
  const current = weatherAt(samples, now)
  if (!current) return <p className="muted">Sem dados de clima nesta sessão.</p>

  const items: [string, string][] = [
    ['Ar', current.airTemp != null ? `${current.airTemp.toFixed(1)} °C` : '—'],
    ['Pista', current.trackTemp != null ? `${current.trackTemp.toFixed(1)} °C` : '—'],
    ['Umidade', current.humidity != null ? `${Math.round(current.humidity)}%` : '—'],
    ['Pressão', current.pressure != null ? `${Math.round(current.pressure)} mbar` : '—'],
    [
      'Vento',
      current.windSpeed != null ? `${windKmh(current.windSpeed)} km/h ${windDirection(current.windDirection)}`.trim() : '—',
    ],
    ['Chuva', current.rainfall ? 'sim' : 'não'],
  ]

  return (
    <>
      <div className={`weather weather-6 ${current.rainfall ? 'raining' : ''}`}>
        {items.map(([k, v]) => (
          <div key={k}>
            <span className="muted">{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      {samples.length > 1 && <TempChart samples={samples} now={now} formatX={formatX} />}
    </>
  )
}

function TempChart({ samples, now, formatX }: { samples: WeatherSample[]; now: number | null; formatX: (t: number) => string }) {
  const data = useMemo(
    () =>
      [samples.map((s) => s.time), samples.map((s) => s.airTemp), samples.map((s) => s.trackTemp)] as uPlot.AlignedData,
    [samples],
  )
  const rain = useMemo(() => rainSpans(samples), [samples])

  const options = useCallback((): Omit<uPlot.Options, 'width' | 'height'> => {
    const t = chartTheme()
    return {
      legend: { show: false },
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 5 } },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: t.axis,
          grid: { stroke: t.grid, width: 1 },
          ticks: { stroke: t.grid },
          values: (_u, vals) => vals.map(formatX),
          space: 70,
        },
        { stroke: t.axis, grid: { stroke: t.grid, width: 1 }, ticks: { stroke: t.grid }, size: 40, values: (_u, vals) => vals.map((v) => `${v}°`) },
      ],
      series: [
        { label: 'Tempo' },
        { label: 'Ar', stroke: AIR, width: 2, spanGaps: true },
        { label: 'Pista', stroke: TRACK, width: 2, spanGaps: true },
      ],
      plugins: [
        {
          hooks: {
            drawClear: (u) => {
              const ctx = u.ctx
              ctx.save()
              ctx.fillStyle = 'rgba(96, 165, 250, 0.16)'
              for (const r of rain) {
                const x0 = u.valToPos(r.from, 'x', true)
                const x1 = u.valToPos(r.to, 'x', true)
                ctx.fillRect(x0, u.bbox.top, Math.max(x1 - x0, devicePixelRatio), u.bbox.height)
              }
              ctx.restore()
            },
          },
        },
      ],
    }
  }, [rain, formatX])

  return (
    <>
      <UPlotChart options={options} data={data} height={150} cursorLap={now} />
      <p className="traces-legend weather-legend">
        <span>
          <i style={{ background: AIR }} /> Ar
        </span>
        <span>
          <i style={{ background: TRACK }} /> Pista
        </span>
        {rain.length > 0 && (
          <span>
            <i className="rain-swatch" /> Chuva
          </span>
        )}
      </p>
    </>
  )
}
