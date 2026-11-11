import { useCallback, useMemo, useState } from 'react'
import type uPlot from 'uplot'
import UPlotChart from '../components/UPlotChart'
import { chartTheme, lapBandsPlugin } from '../lib/chart'
import { formatLapTime } from '../lib/data'
import {
  gapsByLap,
  neutralizedLaps,
  pitStops,
  positionsByLap,
  raceDrivers,
  stintsOf,
  totalLaps,
  type RaceDriver,
} from '../lib/race'
import { fastestLap } from '../lib/telemetry'
import type { DriverResult, Lap } from '../types/data'

interface Props {
  results: DriverResult[]
  laps: Lap[]
}

// letra no padrão da F1 (S/M/H/I/W), igual ao replay
const COMPOUND: Record<string, { label: string; letter: string; className: string }> = {
  SOFT: { label: 'Macio', letter: 'S', className: 'soft' },
  MEDIUM: { label: 'Médio', letter: 'M', className: 'medium' },
  HARD: { label: 'Duro', letter: 'H', className: 'hard' },
  INTERMEDIATE: { label: 'Intermediário', letter: 'I', className: 'inter' },
  WET: { label: 'Chuva', letter: 'W', className: 'wet' },
}

// marcações do eixo de voltas só em números inteiros
const LAP_INCRS = [1, 2, 5, 10, 20, 50]

export default function RaceView({ results, laps }: Props) {
  const drivers = useMemo(() => raceDrivers(results), [results])
  const n = useMemo(() => totalLaps(laps), [laps])
  const bands = useMemo(() => neutralizedLaps(laps), [laps])
  const stops = useMemo(() => pitStops(laps, drivers.map((d) => d.driver)), [laps, drivers])

  return (
    <div className="race">
      <Highlights results={results} laps={laps} stops={stops} drivers={drivers} />

      <section className="race-section">
        <h2>Posições volta a volta</h2>
        <PositionsChart drivers={drivers} results={results} laps={laps} n={n} bands={bands} />
      </section>

      <section className="race-section">
        <h2>Estratégia de pneus</h2>
        <Strategy drivers={drivers} laps={laps} n={n} />
      </section>

      <section className="race-section">
        <h2>Diferença para o líder</h2>
        <GapsChart drivers={drivers} laps={laps} n={n} bands={bands} />
      </section>

      <section className="race-section">
        <h2>Pit stops</h2>
        <PitTable stops={stops} drivers={drivers} />
      </section>

      {bands.size > 0 && (
        <p className="foot">
          Faixas amarelas: voltas com safety car (mais forte) ou VSC (mais fraca). Faixa vermelha: bandeira vermelha.
        </p>
      )}
    </div>
  )
}

// ---------- Destaques ----------

function Highlights({
  results,
  laps,
  stops,
  drivers,
}: Props & { stops: ReturnType<typeof pitStops>; drivers: RaceDriver[] }) {
  const gained = results
    .filter((r) => r.position != null && r.gridPosition && /^\d+$/.test(r.classifiedPosition ?? ''))
    .map((r) => ({ r, delta: r.gridPosition! - r.position! }))
    .sort((a, b) => b.delta - a.delta)[0]
  const fastestStop = stops.filter((s) => s.pitLaneTime != null).sort((a, b) => a.pitLaneTime! - b.pitLaneTime!)[0]
  const fl = fastestLap(laps)
  const color = (d: string) => drivers.find((x) => x.driver === d)?.color ?? 'var(--muted)'

  return (
    <div className="highlights">
      {gained && gained.delta > 0 && (
        <div className="stat">
          <span className="stat-label">Mais posições ganhas</span>
          <span className="stat-value">
            <span className="team-bar" style={{ background: color(gained.r.driver) }} />
            {gained.r.driver} <span className="up">+{gained.delta}</span>
          </span>
          <span className="stat-sub">
            Largou em {gained.r.gridPosition}º, terminou em {gained.r.position}º
          </span>
        </div>
      )}
      {fl && (
        <div className="stat">
          <span className="stat-label">Volta mais rápida</span>
          <span className="stat-value">
            <span className="team-bar" style={{ background: color(fl.driver) }} />
            {fl.driver} <span className="mono">{formatLapTime(fl.lapTime)}</span>
          </span>
          <span className="stat-sub">Volta {fl.lap}</span>
        </div>
      )}
      {fastestStop && (
        <div className="stat">
          <span className="stat-label">Pit stop mais rápido</span>
          <span className="stat-value">
            <span className="team-bar" style={{ background: color(fastestStop.driver) }} />
            {fastestStop.driver} <span className="mono">{fastestStop.pitLaneTime!.toFixed(1)} s</span>
          </span>
          <span className="stat-sub">Tempo no pit lane, volta {fastestStop.lap}</span>
        </div>
      )}
      <div className="stat">
        <span className="stat-label">Pit stops</span>
        <span className="stat-value">{stops.filter((s) => s.pitLaneTime != null).length}</span>
        <span className="stat-sub">
          {new Set(stops.filter((s) => s.pitLaneTime != null).map((s) => s.driver)).size} pilotos trocaram pneus
        </span>
      </div>
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
        ctx.font = `600 ${11 * devicePixelRatio}px system-ui, sans-serif`
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

function PositionsChart({
  drivers,
  results,
  laps,
  n,
  bands,
}: {
  drivers: RaceDriver[]
  results: DriverResult[]
  laps: Lap[]
  n: number
  bands: Map<number, 'sc' | 'vsc' | 'red'>
}) {
  const [focus, setFocus] = useState<{ driver: string | null; lap: number | null }>({ driver: null, lap: null })
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
        series: [
          { label: 'Volta' },
          ...drivers.map((d) => ({
            label: d.driver,
            stroke: d.color,
            width: 2,
            dash: d.dashed ? [6, 4] : undefined,
            points: { show: false },
          })),
        ],
        plugins: [lapBandsPlugin(bands), endLabelsPlugin(drivers)],
        hooks: {
          setSeries: [
            (_u, idx) => setFocus((f) => ({ ...f, driver: idx ? drivers[idx - 1].driver : null })),
          ],
          setCursor: [(u) => setFocus((f) => ({ ...f, lap: u.cursor.idx ?? null }))],
        },
      }
    },
    [drivers, n, count, bands],
  )

  const fd = focus.driver ? drivers.find((d) => d.driver === focus.driver) : null
  const fr = fd ? results.find((r) => r.driver === fd.driver) : null
  const row = fd ? positions.get(fd.driver)! : null
  return (
    <>
      <div className="readout">
        {fd && fr ? (
          <>
            <span>
              <i style={{ background: fd.color }} /> <b>{fd.driver}</b> {fd.fullName}
            </span>
            <span className="muted">
              Largou {fr.gridPosition ? `em ${fr.gridPosition}º` : 'do pit lane'} ·{' '}
              {/^\d+$/.test(fr.classifiedPosition ?? '') ? `terminou em ${fr.position}º` : `não terminou (${fr.status})`}
            </span>
            {focus.lap != null && row && row[focus.lap] != null && (
              <span>
                {focus.lap === 0 ? 'Grid' : `Volta ${focus.lap}`}: <b>{row[focus.lap]}º</b>
              </span>
            )}
          </>
        ) : (
          <span className="muted">Passe o mouse perto de uma linha para destacar o piloto.</span>
        )}
      </div>
      <div className="chart-card">
        <UPlotChart options={options} data={data} height={Math.max(360, count * 22)} />
      </div>
    </>
  )
}

// ---------- Estratégia ----------

function Strategy({ drivers, laps, n }: { drivers: RaceDriver[]; laps: Lap[]; n: number }) {
  const ticks = Array.from({ length: Math.floor(n / 10) + 1 }, (_, i) => i * 10).filter((t) => t > 0)
  return (
    <div className="strategy">
      {drivers.map((d) => {
        const stints = stintsOf(laps, d.driver)
        return (
          <div key={d.driver} className="strategy-row">
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

function GapsChart({
  drivers,
  laps,
  n,
  bands,
}: {
  drivers: RaceDriver[]
  laps: Lap[]
  n: number
  bands: Map<number, 'sc' | 'vsc' | 'red'>
}) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(drivers.filter((d) => d.finish != null && d.finish <= 10).map((d) => d.driver)),
  )
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
        series: [
          { label: 'Volta' },
          ...drivers.map((d) => ({
            label: d.driver,
            stroke: d.color,
            width: 2,
            dash: d.dashed ? [6, 4] : undefined,
            show: visible.has(d.driver),
            points: { show: false },
          })),
        ],
        plugins: [lapBandsPlugin(bands), endLabelsPlugin(drivers)],
      }
    },
    [drivers, n, bands, visible],
  )

  const toggle = (d: string) =>
    setVisible((v) => {
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
        <button className="chip ghost" onClick={() => setVisible(new Set(drivers.map((d) => d.driver)))}>
          Todos
        </button>
        <button className="chip ghost" onClick={() => setVisible(new Set())}>
          Nenhum
        </button>
      </div>
      <div className="chart-card">
        <UPlotChart options={options} data={data} height={320} />
      </div>
      <p className="foot">
        Diferença medida na linha de chegada a cada volta. Arraste no gráfico para dar zoom; duplo clique volta ao normal.
      </p>
    </>
  )
}

// ---------- Pit stops ----------

function PitTable({ stops, drivers }: { stops: ReturnType<typeof pitStops>; drivers: RaceDriver[] }) {
  const [sort, setSort] = useState<'lap' | 'time'>('lap')
  const best = Math.min(...stops.filter((s) => s.pitLaneTime != null).map((s) => s.pitLaneTime!))
  const sorted = [...stops].sort((a, b) =>
    sort === 'lap' ? a.lap - b.lap : (a.pitLaneTime ?? Infinity) - (b.pitLaneTime ?? Infinity),
  )
  const color = (d: string) => drivers.find((x) => x.driver === d)?.color ?? 'var(--muted)'
  if (stops.length === 0) return <p className="notice">Nenhum pit stop nesta sessão.</p>
  return (
    <div className="table-wrap">
      <table>
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
                Tempo no pit lane
              </button>
            </th>
            <th>Pneus</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={`${s.driver}-${s.lap}`}>
              <td>
                <span className="driver">
                  <span className="team-bar" style={{ background: color(s.driver) }} />
                  <strong>{s.driver}</strong>
                </span>
              </td>
              <td className="num">{s.lap}</td>
              <td className={`num mono ${s.pitLaneTime === best ? 'fastest' : ''}`}>
                {s.pitLaneTime != null ? `${s.pitLaneTime.toFixed(1)} s` : 'abandonou nos boxes'}
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

function TyreTag({ compound }: { compound: string | null }) {
  const c = COMPOUND[compound ?? '']
  if (!c) return <span className="muted">—</span>
  return <span className={`tyre ${c.className}`} title={c.label}>
      {c.letter}
    </span>
}
