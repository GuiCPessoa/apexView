import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type uPlot from 'uplot'
import UPlotChart from '../components/UPlotChart'
import { chartTheme, lapBandsPlugin } from '../lib/chart'
import { formatLapTime, formatPoints } from '../lib/data'
import { dimmed } from '../lib/focus'
import { gapsByLap, positionsByLap, stintsOf, type PitStop, type RaceDriver } from '../lib/race'
import { COMPOUND } from '../lib/tyres'
import type { DriverResult, Lap } from '../types/data'

// marcações do eixo de voltas só em números inteiros
const LAP_INCRS = [1, 2, 5, 10, 20, 50]

/** Props comuns: pilotos em foco e o clique que liga/desliga o foco. */
export interface FocusProps {
  focus: string[]
  onToggle: (driver: string) => void
}

type Bands = Map<number, 'sc' | 'vsc' | 'red'>

/** Mantém a função mais recente num ref (para hooks do uPlot sem recriar o gráfico). */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

// ---------- Resultado compacto ----------

export function RaceResults({
  results,
  laps,
  focus,
  onToggle,
}: { results: DriverResult[]; laps: Lap[] } & FocusProps) {
  const bestLaps = useMemo(() => {
    const best = new Map<string, number>()
    for (const l of laps) {
      if (l.lapTime == null || l.deleted) continue
      const cur = best.get(l.driver)
      if (cur == null || l.lapTime < cur) best.set(l.driver, l.lapTime)
    }
    return best
  }, [laps])
  const fastest = Math.min(...bestLaps.values())
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))

  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th className="num">Pos</th>
            <th>Piloto</th>
            <th className="num" title="Posições ganhas ou perdidas desde o grid">
              Grid
            </th>
            <th className="num hide-sm">Melhor volta</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const gained = r.position != null && r.gridPosition ? r.gridPosition - r.position : null
            const finished = /^\d+$/.test(r.classifiedPosition ?? '')
            const best = bestLaps.get(r.driver) ?? null
            return (
              <tr
                key={r.driver}
                className={`clickable ${focus.includes(r.driver) ? 'focused' : ''} ${dimmed(focus, r.driver) ? 'dim' : ''}`}
                onClick={() => onToggle(r.driver)}
              >
                <td className="num pos">{finished ? r.position : (r.classifiedPosition ?? '—')}</td>
                <td>
                  <span className="driver">
                    <span className="team-bar" style={{ background: r.teamColor ?? 'var(--muted)' }} />
                    <strong>{r.driver}</strong>
                    <span className="team-name">{finished || r.status === 'Lapped' ? r.team : r.status}</span>
                  </span>
                </td>
                <td className={`num delta ${gained == null ? '' : gained > 0 ? 'up' : gained < 0 ? 'down' : ''}`}>
                  {r.gridPosition === 0 ? 'Pit' : gained == null ? '—' : gained > 0 ? `▲${gained}` : gained < 0 ? `▼${-gained}` : '='}
                </td>
                <td className={`num mono hide-sm ${best === fastest ? 'fastest' : ''}`}>{formatLapTime(best)}</td>
                <td className="num points">{r.points ? formatPoints(r.points) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Posições ----------

/** Escreve a sigla do piloto no fim da linha. */
function endLabelsPlugin(drivers: RaceDriver[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx
        ctx.save()
        ctx.font = `700 ${11 * devicePixelRatio}px 'Titillium Web', system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        const labels: { d: RaceDriver; x: number; y: number; alpha: number }[] = []
        drivers.forEach((d, i) => {
          const s = u.series[i + 1]
          if (!s.show) return
          const ys = u.data[i + 1] as (number | null)[]
          let j = ys.length - 1
          while (j >= 0 && ys[j] == null) j--
          if (j < 0) return
          labels.push({
            d,
            x: u.valToPos(j, 'x', true) + 6 * devicePixelRatio,
            y: u.valToPos(ys[j]!, 'y', true),
            alpha: s.alpha ?? 1,
          })
        })
        // afasta rótulos que terminam no mesmo lugar (só entre os que acabam na última volta, mesma coluna)
        const gap = 12 * devicePixelRatio
        const columns = new Map<number, typeof labels>()
        for (const l of labels) columns.set(Math.round(l.x), [...(columns.get(Math.round(l.x)) ?? []), l])
        for (const col of columns.values()) {
          col.sort((a, b) => a.y - b.y)
          for (let k = 1; k < col.length; k++) col[k].y = Math.max(col[k].y, col[k - 1].y + gap)
        }
        for (const l of labels) {
          ctx.globalAlpha = l.alpha
          ctx.fillStyle = l.d.color
          ctx.fillText(l.d.driver, l.x, l.y)
        }
        ctx.restore()
      },
    },
  }
}

/** Série de um piloto com destaque do foco (linha grossa) e os demais apagados. */
function seriesFor(d: RaceDriver, focus: string[], extra: Partial<uPlot.Series> = {}): uPlot.Series {
  const on = focus.includes(d.driver)
  return {
    label: d.driver,
    stroke: d.color,
    width: on ? 3 : 1.6,
    alpha: dimmed(focus, d.driver) ? 0.18 : 1,
    dash: d.dashed ? [6, 4] : undefined,
    points: { show: false },
    ...extra,
  }
}

/** Clique perto de uma linha liga/desliga o foco do piloto. */
function clickToFocus(drivers: RaceDriver[], onToggle: { current: (d: string) => void }): uPlot.Plugin {
  let hovered: number | null = null
  return {
    hooks: {
      setSeries: (_u, idx) => {
        hovered = idx ?? null
      },
      ready: (u) => {
        u.over.style.cursor = 'pointer'
        u.over.addEventListener('click', () => {
          if (hovered) onToggle.current(drivers[hovered - 1].driver)
        })
      },
    },
  }
}

export function PositionsChart({
  drivers,
  results,
  laps,
  n,
  bands,
  focus,
  onToggle,
  cursorLap,
}: {
  drivers: RaceDriver[]
  results: DriverResult[]
  laps: Lap[]
  n: number
  bands: Bands
  cursorLap: number | null
} & FocusProps) {
  const [hover, setHover] = useState<{ driver: string | null; lap: number | null }>({ driver: null, lap: null })
  const toggleRef = useLatest(onToggle)
  const positions = useMemo(() => positionsByLap(laps, results), [laps, results])
  const data = useMemo(
    () => [Array.from({ length: n + 1 }, (_, i) => i), ...drivers.map((d) => positions.get(d.driver)!)] as uPlot.AlignedData,
    [n, drivers, positions],
  )
  const count = drivers.length

  const options = useCallback(
    (): Omit<uPlot.Options, 'width' | 'height'> => {
      const t = chartTheme()
      return {
        legend: { show: false },
        padding: [8, 44, 0, 0],
        focus: { alpha: 0.18 },
        cursor: { focus: { prox: 24 }, drag: { x: false, y: false }, points: { size: 7 } },
        scales: { x: { time: false, range: [0, n] }, y: { range: [0.5, count + 0.5], dir: -1 } },
        axes: [
          {
            stroke: t.axis,
            grid: { stroke: t.grid, width: 1 },
            ticks: { stroke: t.grid },
            incrs: LAP_INCRS,
            values: (_u, vals) => vals.map((v) => (v === 0 ? 'Grid' : String(v))),
          },
          {
            stroke: t.axis,
            grid: { stroke: t.grid, width: 1 },
            ticks: { stroke: t.grid },
            size: 32,
            splits: () => Array.from({ length: count }, (_, i) => i + 1),
            values: (_u, vals) => vals.map((v) => (v === 1 || v % 5 === 0 ? String(v) : '')),
          },
        ],
        series: [{ label: 'Volta' }, ...drivers.map((d) => seriesFor(d, focus))],
        plugins: [lapBandsPlugin(bands), endLabelsPlugin(drivers), clickToFocus(drivers, toggleRef)],
        hooks: {
          setSeries: [(_u, idx) => setHover((f) => ({ ...f, driver: idx ? drivers[idx - 1].driver : null }))],
          setCursor: [(u) => setHover((f) => ({ ...f, lap: u.cursor.idx ?? null }))],
        },
      }
    },
    [drivers, n, count, bands, focus, toggleRef],
  )

  const fd = hover.driver ? drivers.find((d) => d.driver === hover.driver) : null
  const fr = fd ? results.find((r) => r.driver === fd.driver) : null
  const row = fd ? positions.get(fd.driver)! : null
  return (
    <>
      <div className="readout">
        {fd && fr ? (
          <>
            <span>
              <i style={{ background: fd.color }} /> <b>{fd.driver}</b>
            </span>
            <span className="muted">
              Largou {fr.gridPosition ? `em ${fr.gridPosition}º` : 'do pit lane'} ·{' '}
              {/^\d+$/.test(fr.classifiedPosition ?? '') ? `terminou em ${fr.position}º` : `não terminou (${fr.status})`}
            </span>
            {hover.lap != null && row && row[hover.lap] != null && (
              <span>
                {hover.lap === 0 ? 'Grid' : `Volta ${hover.lap}`}: <b>{row[hover.lap]}º</b>
              </span>
            )}
          </>
        ) : (
          <span className="muted">Passe o mouse perto de uma linha para ver o piloto; clique para pôr em foco.</span>
        )}
      </div>
      <UPlotChart options={options} data={data} height={Math.max(360, count * 21)} cursorLap={cursorLap} />
    </>
  )
}

// ---------- Estratégia ----------

export function Strategy({
  drivers,
  laps,
  n,
  focus,
  onToggle,
  cursorLap,
}: { drivers: RaceDriver[]; laps: Lap[]; n: number; cursorLap: number | null } & FocusProps) {
  const ticks = Array.from({ length: Math.floor(n / 10) + 1 }, (_, i) => i * 10).filter((t) => t > 0)
  return (
    <div className="strategy">
      <div className="strategy-rows">
        {cursorLap != null && <span className="strategy-cursor" style={{ ['--x' as string]: cursorLap / n }} />}
        {drivers.map((d) => {
          const stints = stintsOf(laps, d.driver)
          return (
            <div
              key={d.driver}
              className={`strategy-row clickable ${focus.includes(d.driver) ? 'focused' : ''} ${dimmed(focus, d.driver) ? 'dim' : ''}`}
              onClick={() => onToggle(d.driver)}
            >
              <span className="strategy-driver">
                <span className="team-bar" style={{ background: d.color }} />
                {d.driver}
              </span>
              <div className="strategy-track">
                {stints.map((s) => {
                  const c = COMPOUND[s.compound ?? ''] ?? { label: s.compound ?? '?', letter: '?', className: 'unknown' }
                  const len = s.endLap - s.startLap + 1
                  const used = s.fresh === false
                  return (
                    <span
                      key={`${s.stint}-${s.startLap}`}
                      className={`stint ${c.className} ${used ? 'used' : ''}`}
                      style={{ left: `${((s.startLap - 1) / n) * 100}%`, width: `${(len / n) * 100}%` }}
                      title={`${c.label} ${used ? `usado (${s.startLife} voltas)` : 'novo'} · voltas ${s.startLap}–${s.endLap} (${len})`}
                    >
                      {len}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="strategy-row strategy-axis">
        <span className="strategy-driver" />
        <div className="strategy-track">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(t / n) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="strategy-legend">
        {Object.entries(COMPOUND)
          .filter(([k]) => laps.some((l) => l.compound === k))
          .map(([k, c]) => (
            <span key={k}>
              <i className={`stint ${c.className}`} /> {c.label}
            </span>
          ))}
        <span>
          <i className="stint hard used" /> Jogo usado
        </span>
        <span className="muted">Número = voltas no stint</span>
      </div>
    </div>
  )
}

// ---------- Gaps ----------

export function GapsChart({
  drivers,
  laps,
  n,
  bands,
  focus,
  cursorLap,
}: {
  drivers: RaceDriver[]
  laps: Lap[]
  n: number
  bands: Bands
  focus: string[]
  cursorLap: number | null
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(drivers.filter((d) => d.finish != null && d.finish <= 10).map((d) => d.driver)),
  )
  // pilotos em foco sempre aparecem
  const visible = useMemo(() => new Set([...picked, ...focus]), [picked, focus])
  const gaps = useMemo(() => gapsByLap(laps, drivers.map((d) => d.driver)), [laps, drivers])
  const data = useMemo(
    () => [Array.from({ length: n + 1 }, (_, i) => i), ...drivers.map((d) => gaps.get(d.driver)!)] as uPlot.AlignedData,
    [n, drivers, gaps],
  )

  const options = useCallback(
    (): Omit<uPlot.Options, 'width' | 'height'> => {
      const t = chartTheme()
      return {
        legend: { show: false },
        padding: [8, 44, 0, 0],
        focus: { alpha: 0.2 },
        cursor: { focus: { prox: 24 }, drag: { x: true, y: false }, points: { size: 6 } },
        scales: {
          x: { time: false, range: [0, n] },
          y: {
            // líder (0 s) no topo
            dir: -1,
            range: (u) => {
              let max = 1
              u.series.forEach((s, i) => {
                if (i === 0 || !s.show) return
                for (const v of u.data[i] as (number | null)[]) if (v != null && v > max) max = v
              })
              return [-max * 0.03, max * 1.05]
            },
          },
        },
        axes: [
          { stroke: t.axis, grid: { stroke: t.grid, width: 1 }, ticks: { stroke: t.grid }, incrs: LAP_INCRS },
          {
            stroke: t.axis,
            grid: { stroke: t.grid, width: 1 },
            ticks: { stroke: t.grid },
            size: 44,
            values: (_u, vals) => vals.map((v) => `${v} s`),
          },
        ],
        series: [{ label: 'Volta' }, ...drivers.map((d) => seriesFor(d, focus, { show: visible.has(d.driver) }))],
        plugins: [lapBandsPlugin(bands), endLabelsPlugin(drivers)],
      }
    },
    [drivers, n, bands, visible, focus],
  )

  const toggle = (d: string) =>
    setPicked((v) => {
      const next = new Set(v)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

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
      <UPlotChart options={options} data={data} height={320} cursorLap={cursorLap} />
      <p className="foot">
        Diferença medida na linha de chegada a cada volta. Arraste no gráfico para dar zoom; duplo clique volta ao normal.
      </p>
    </>
  )
}

// ---------- Pit stops ----------

export function PitTable({
  stops,
  drivers,
  focus,
  onToggle,
}: { stops: PitStop[]; drivers: RaceDriver[] } & FocusProps) {
  const [sort, setSort] = useState<'lap' | 'time'>('lap')
  const best = Math.min(...stops.filter((s) => s.pitLaneTime != null).map((s) => s.pitLaneTime!))
  const sorted = [...stops].sort((a, b) =>
    sort === 'lap' ? a.lap - b.lap : (a.pitLaneTime ?? Infinity) - (b.pitLaneTime ?? Infinity),
  )
  const color = (d: string) => drivers.find((x) => x.driver === d)?.color ?? 'var(--muted)'
  if (stops.length === 0) return <p className="muted">Nenhum pit stop nesta sessão.</p>
  return (
    <div className="scroll-y">
      <table className="compact">
        <thead>
          <tr>
            <th>Piloto</th>
            <th className="num">
              <button className={`th-sort ${sort === 'lap' ? 'active' : ''}`} onClick={() => setSort('lap')}>
                Volta
              </button>
            </th>
            <th className="num">
              <button className={`th-sort ${sort === 'time' ? 'active' : ''}`} onClick={() => setSort('time')}>
                Pit lane
              </button>
            </th>
            <th>Pneus</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr
              key={`${s.driver}-${s.lap}`}
              className={`clickable ${focus.includes(s.driver) ? 'focused' : ''} ${dimmed(focus, s.driver) ? 'dim' : ''}`}
              onClick={() => onToggle(s.driver)}
            >
              <td>
                <span className="driver">
                  <span className="team-bar" style={{ background: color(s.driver) }} />
                  <strong>{s.driver}</strong>
                </span>
              </td>
              <td className="num">{s.lap}</td>
              <td className={`num mono ${s.pitLaneTime === best ? 'fastest' : ''}`}>
                {s.pitLaneTime != null ? `${s.pitLaneTime.toFixed(1)} s` : 'abandono'}
              </td>
              <td>
                <TyreTag compound={s.from} /> → <TyreTag compound={s.to} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TyreTag({ compound }: { compound: string | null }) {
  const c = COMPOUND[compound ?? '']
  if (!c) return <span className="muted">—</span>
  return (
    <span className={`tyre ${c.className}`} title={c.label}>
      {c.letter}
    </span>
  )
}
