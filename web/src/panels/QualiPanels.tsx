import { useCallback, useMemo, useState } from 'react'
import type uPlot from 'uplot'
import UPlotChart from '../components/UPlotChart'
import { chartTheme } from '../lib/chart'
import { formatGap, formatLapTime } from '../lib/data'
import { dimmed } from '../lib/focus'
import { raceDrivers } from '../lib/race'
import { evolutionPoints, qualifyingSegments, rankingByBestLap, sessionBestSectors, type Segment } from '../lib/session'
import type { DriverResult, Lap, SessionMeta } from '../types/data'
import type { FocusProps } from './RacePanels'
import { TyreBadge } from './ResultsPanels'

interface Props {
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
}

// ---------- Setores e volta ideal ----------

export function SectorsTable({ results, laps, focus, onToggle }: Omit<Props, 'meta'> & FocusProps) {
  const ranking = useMemo(() => rankingByBestLap(laps, results.map((r) => r.driver)), [laps, results])
  const best = sessionBestSectors(ranking)
  const bestSpeed = Math.max(...ranking.map((r) => r.topSpeed ?? 0))
  const by = new Map(results.map((r) => [r.driver, r]))
  const deleted = laps.filter((l) => l.deleted).length

  return (
    <>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="num">Pos</th>
              <th>Piloto</th>
              <th className="num">Melhor volta</th>
              <th className="num hide-sm">Dif.</th>
              <th className="num">S1</th>
              <th className="num">S2</th>
              <th className="num">S3</th>
              <th className="num">Volta ideal</th>
              <th className="num hide-sm" title="Melhor volta menos a volta ideal">
                A ganhar
              </th>
              <th className="num hide-sm">Vel. máx</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row, i) => {
              const r = by.get(row.driver)!
              return (
                <tr
                  key={row.driver}
                  className={`clickable ${focus.includes(row.driver) ? 'focused' : ''} ${dimmed(focus, row.driver) ? 'dim' : ''}`}
                  onClick={() => onToggle(row.driver)}
                >
                  <td className="num pos">{row.best ? i + 1 : '—'}</td>
                  <td>
                    <span className="driver">
                      <span className="team-bar" style={{ background: r.teamColor ?? 'var(--muted)' }} />
                      <strong>{row.driver}</strong>
                      {row.best && (
                        <span className="muted lap-meta">
                          V{row.best.lap} <TyreBadge compound={row.best.compound} />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`num mono ${i === 0 ? 'fastest' : ''}`}>{formatLapTime(row.best?.lapTime ?? null)}</td>
                  <td className="num mono muted hide-sm">{formatGap(row.gap)}</td>
                  {row.bestSectors.map((s, k) => (
                    <td key={k} className={`num mono ${s != null && s === best[k] ? 'fastest' : ''}`}>
                      {s != null ? s.toFixed(3) : '—'}
                    </td>
                  ))}
                  <td className="num mono">{formatLapTime(row.ideal)}</td>
                  <td className="num mono muted hide-sm">
                    {row.ideal != null && row.best?.lapTime != null ? (row.best.lapTime - row.ideal).toFixed(3) : '—'}
                  </td>
                  <td className={`num hide-sm ${row.topSpeed === bestSpeed ? 'fastest' : ''}`}>{row.topSpeed ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="foot">
        Setores e volta ideal usam o melhor tempo de cada setor do piloto, mesmo que em voltas diferentes. Em roxo, o
        melhor da sessão. Velocidade no speed trap (km/h).
        {deleted > 0 && ` ${deleted} volta(s) anulada(s) ficaram de fora.`}
      </p>
    </>
  )
}

// ---------- Evolução ----------

/** Faixas e rótulos dos segmentos da classificação (Q1/Q2/Q3). */
function segmentsPlugin(segments: Segment[], prefix: string, origin: number, color: string): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const ctx = u.ctx
        ctx.save()
        ctx.font = `600 ${11 * devicePixelRatio}px system-ui, sans-serif`
        segments.forEach((s, i) => {
          const x0 = u.valToPos((s.start - origin) / 60, 'x', true)
          const x1 = u.valToPos((s.end - origin) / 60, 'x', true)
          ctx.fillStyle = i % 2 === 0 ? 'rgba(127,127,127,0.07)' : 'rgba(127,127,127,0.13)'
          ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height)
          ctx.fillStyle = color
          ctx.fillText(`${prefix}${s.n}`, x0 + 6 * devicePixelRatio, u.bbox.top + 14 * devicePixelRatio)
        })
        ctx.restore()
      },
    },
  }
}

export function EvolutionChart({ meta, results, laps, focus }: Props & { focus: string[] }) {
  const drivers = useMemo(() => {
    const ranking = rankingByBestLap(laps, results.map((r) => r.driver))
    const order = new Map(ranking.map((r, i) => [r.driver, i]))
    // mesma regra de cor/traço da corrida, mas na ordem da melhor volta
    return raceDrivers(results).sort((a, b) => (order.get(a.driver) ?? 99) - (order.get(b.driver) ?? 99))
  }, [laps, results])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(drivers.slice(0, 6).map((d) => d.driver)))
  // pilotos em foco sempre aparecem
  const visible = useMemo(() => new Set([...picked, ...focus]), [picked, focus])
  const [hover, setHover] = useState<{ series: number | null; idx: number | null }>({ series: null, idx: null })

  const points = useMemo(() => evolutionPoints(laps), [laps])
  const segments = useMemo(() => qualifyingSegments(laps), [laps])
  const origin = useMemo(() => {
    const starts = laps.map((l) => l.startTime).filter((t): t is number => t != null)
    return starts.length ? Math.min(...starts) : 0
  }, [laps])

  // uPlot precisa de um eixo x comum: cada ponto vira uma coluna; os outros pilotos ficam null nela
  const data = useMemo(() => {
    const xs = points.map((p) => (p.time - origin) / 60)
    const series = drivers.map((d) => points.map((p) => (p.driver === d.driver ? p.lapTime : null)))
    return [xs, ...series] as uPlot.AlignedData
  }, [points, drivers, origin])

  const prefix = meta.session === 'SQ' ? 'SQ' : 'Q'
  const options = useCallback(
    (): Omit<uPlot.Options, 'width' | 'height'> => {
      const t = chartTheme()
      return {
        legend: { show: false },
        focus: { alpha: 0.25 },
        cursor: { focus: { prox: 16 }, drag: { x: true, y: true, uni: 30 }, points: { size: 9 } },
        scales: { x: { time: false } },
        axes: [
          {
            stroke: t.axis,
            grid: { stroke: t.grid, width: 1 },
            ticks: { stroke: t.grid },
            values: (_u, vals) => vals.map((v) => `${Math.round(v)} min`),
          },
          {
            stroke: t.axis,
            grid: { stroke: t.grid, width: 1 },
            ticks: { stroke: t.grid },
            size: 64,
            values: (_u, vals) => vals.map((v) => formatLapTime(v).replace(/\d$/, '')),
          },
        ],
        series: [
          { label: 'Tempo' },
          ...drivers.map((d) => ({
            label: d.driver,
            stroke: d.color,
            show: visible.has(d.driver),
            alpha: dimmed(focus, d.driver) ? 0.25 : 1,
            paths: () => null,
            points: {
              show: true,
              size: focus.includes(d.driver) ? 9 : 7,
              width: 2,
              stroke: d.color,
              fill: d.dashed ? t.surface : d.color,
            },
          })),
        ],
        plugins: segments.length ? [segmentsPlugin(segments, prefix, origin, t.axis)] : [],
        hooks: {
          setSeries: [(_u, idx) => setHover((h) => ({ ...h, series: idx ?? null }))],
          setCursor: [
            (u) =>
              setHover((h) => ({
                ...h,
                idx: h.series != null ? (u.cursor.idxs?.[h.series] ?? u.cursor.idx ?? null) : (u.cursor.idx ?? null),
              })),
          ],
        },
      }
    },
    [drivers, visible, segments, prefix, origin, focus],
  )

  const toggle = (d: string) =>
    setPicked((v) => {
      const next = new Set(v)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  const focused = hover.series != null && hover.series > 0 ? drivers[hover.series - 1] : null
  const point = focused && hover.idx != null ? points[hover.idx] : null
  const shown = point && point.driver === focused?.driver ? point : null

  if (points.length === 0) return <p className="notice">Sem voltas válidas para mostrar.</p>

  return (
    <>
      <div className="chips">
        {drivers.map((d) => (
          <button
            key={d.driver}
            className={`chip ${visible.has(d.driver) ? 'on' : ''}`}
            onClick={() => toggle(d.driver)}
            aria-pressed={visible.has(d.driver)}
            style={visible.has(d.driver) ? { borderColor: d.color } : undefined}
          >
            <i style={{ background: d.color }} />
            {d.driver}
          </button>
        ))}
        <button className="chip ghost" onClick={() => setPicked(new Set(drivers.map((d) => d.driver)))}>
          Todos
        </button>
        <button className="chip ghost" onClick={() => setPicked(new Set())}>
          Nenhum
        </button>
      </div>
      <div className="readout">
        {shown && focused ? (
          <>
            <span>
              <i style={{ background: focused.color }} /> <b>{focused.driver}</b> · volta {shown.lap}
            </span>
            <span>
              <b className="mono">{formatLapTime(shown.lapTime)}</b>
            </span>
            <span>
              <TyreBadge compound={shown.compound} />
            </span>
            <span className="muted">{Math.round((shown.time - origin) / 60)} min de sessão</span>
          </>
        ) : (
          <span className="muted">Passe o mouse num ponto para ver a volta. Arraste para dar zoom.</span>
        )}
      </div>
      <UPlotChart options={options} data={data} height={340} />
      <p className="foot">
        Cada ponto é uma volta válida até 107% da melhor volta da sessão (sem voltas de saída, entrada ou anuladas). O
        2º piloto de cada equipe aparece com ponto vazado.
      </p>
    </>
  )
}
