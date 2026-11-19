import { useEffect, useMemo, useState } from 'react'
import Card from '../components/Card'
import { formatLapTime, loadTelemetry, loadTrack } from '../lib/data'
import {
  DEFAULT_SECTORS,
  MAX_DRIVERS,
  SECTOR_COUNTS,
  TIE_S,
  defaultDrivers,
  driverColors,
  miniSectors,
  type MiniSector,
} from '../lib/minisectors'
import { makeProjection } from '../lib/replay'
import { fastestLap } from '../lib/telemetry'
import type { DriverResult, DriverTelemetry, Lap, LapTelemetry, SessionMeta, Track } from '../types/data'

interface Props {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
  focus: string[]
}

const TIE_COLOR = 'var(--tie)'
const pct = (x: number) => `${Math.round(x * 100)}%`
const seconds = (x: number) => x.toFixed(3).replace('.', ',')

/** Mini setores dominantes: a volta mais rápida de cada piloto, trecho a trecho, pintada no mapa. */
export default function MiniSectorsPanel({ path, meta, results, laps, focus }: Props) {
  const available = meta.telemetry
  const defaults = useMemo(() => defaultDrivers(focus, laps, available), [focus, laps, available])
  // escolha manual vale até o foco mudar; aí volta ao padrão (ajuste no render, sem efeito)
  const focusKey = focus.join(',')
  const [picked, setPicked] = useState<{ focusKey: string; drivers: string[] } | null>(null)
  const drivers = picked && picked.focusKey === focusKey ? picked.drivers : defaults
  const setDrivers = (next: string[]) => setPicked({ focusKey, drivers: next })

  const [n, setN] = useState<number>(DEFAULT_SECTORS)
  const [active, setActive] = useState<number | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [cache, setCache] = useState<Record<string, DriverTelemetry>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (available.length === 0) return
    loadTrack(path).then(setTrack).catch(() => setTrack(null))
  }, [path, available.length])

  useEffect(() => {
    for (const d of drivers) {
      if (cache[d]) continue
      loadTelemetry(path, d)
        .then((t) => setCache((c) => ({ ...c, [t.driver]: t })))
        .catch((e: Error) => setError(e.message))
    }
  }, [path, drivers, cache])

  // volta mais rápida (válida) de cada piloto, como está na telemetria
  const chosen = useMemo(() => {
    const out: { driver: string; lap: LapTelemetry }[] = []
    for (const d of drivers) {
      const num = fastestLap(laps, d)?.lap
      const lap = cache[d]?.laps.find((l) => l.lap === num)
      if (lap) out.push({ driver: d, lap })
    }
    return out
  }, [drivers, laps, cache])
  const loading = drivers.some((d) => !cache[d])
  const missing = drivers.filter((d) => cache[d] && !chosen.some((c) => c.driver === d))

  const summary = useMemo(() => miniSectors(chosen, n), [chosen, n])
  const resultBy = useMemo(() => new Map(results.map((r) => [r.driver, r])), [results])
  const colors = useMemo(
    () => driverColors(drivers, (d) => resultBy.get(d)?.teamColor ?? '#8b8b97'),
    [drivers, resultBy],
  )

  if (available.length === 0) return null

  const ranked = [...chosen].sort((a, b) => summary.share[b.driver] - summary.share[a.driver])
  const addable = available.filter((d) => !drivers.includes(d)).sort()
  const ready = track && summary.sectors.length > 0 && !loading
  const highlighted = active != null && active < summary.sectors.length ? active : null

  return (
    <Card
      title="Mini setores"
      span={12}
      id="minisectors"
      aside={
        <>
          <span className="muted">volta mais rápida de cada um</span>
          <span className="seg" role="group" aria-label="Número de trechos">
            {SECTOR_COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === n ? 'active' : undefined}
                aria-pressed={c === n}
                onClick={() => {
                  setN(c)
                  setActive(null)
                }}
              >
                {c}
              </button>
            ))}
          </span>
        </>
      }
    >
      {error && <p className="notice error">{error}</p>}
      <div className="ms">
        <div className="ms-map" onMouseLeave={() => setActive(null)}>
          {track && summary.sectors.length > 0 ? (
            <SectorMap track={track} sectors={summary.sectors} colors={colors} active={highlighted} onActive={setActive} />
          ) : (
            <p className="muted loading">{loading ? 'Carregando telemetria…' : 'Sem dados para o mapa.'}</p>
          )}
        </div>
        <div className="ms-side">
          <div className="ms-who">
            {drivers.map((d) => (
              <span key={d} className="ms-chip">
                <i style={{ background: colors[d] }} />
                {d}
                {drivers.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Tirar ${d} da comparação`}
                    title="Tirar da comparação"
                    onClick={() => setDrivers(drivers.filter((x) => x !== d))}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {drivers.length < MAX_DRIVERS && addable.length > 0 && (
              <select
                className="ms-chip ms-add"
                value=""
                aria-label="Adicionar piloto"
                onChange={(e) => e.target.value && setDrivers([...drivers, e.target.value])}
              >
                <option value="">+ piloto</option>
                {addable.map((d) => (
                  <option key={d} value={d}>
                    {d}
                    {resultBy.get(d)?.team ? ` · ${resultBy.get(d)!.team}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {ready && (
            <div className="ms-legend">
              {ranked.map(({ driver, lap }) => (
                <div key={driver} className="ms-row">
                  <span className="ms-bar" style={{ background: colors[driver] }} />
                  <span className="ms-name">
                    {driver}
                    <small>
                      V{lap.lap} · <span className="mono">{formatLapTime(lap.lapTime)}</span>
                    </small>
                  </span>
                  <span className="ms-pct">{pct(summary.share[driver])}</span>
                  <span className="ms-meter">
                    <span style={{ width: pct(summary.share[driver]), background: colors[driver] }} />
                  </span>
                  <span className="ms-sub">
                    mais rápido em {summary.count[driver]} de {summary.sectors.length} trechos
                  </span>
                </div>
              ))}
              {summary.tieShare > 0 && (
                <div className="ms-row">
                  <span className="ms-bar" style={{ background: TIE_COLOR }} />
                  <span className="ms-name">
                    Empate<small>diferença &lt; {seconds(TIE_S).replace(/0+$/, '')} s</small>
                  </span>
                  <span className="ms-pct muted">{pct(summary.tieShare)}</span>
                </div>
              )}
            </div>
          )}
          {missing.length > 0 && (
            <p className="muted">Sem telemetria da volta mais rápida de {missing.join(' e ')}.</p>
          )}
          {chosen.length === 1 && ready && <p className="muted">Adicione outro piloto para comparar.</p>}
          <p className="ms-note">
            <span aria-hidden="true">ⓘ</span>
            <span>
              Telemetria a ~4 Hz: cada trecho tem poucas amostras. Use como tendência; diferenças muito pequenas viram{' '}
              <b>empate</b>.
            </span>
          </p>
        </div>
      </div>
      {ready && track && (
        <SectorStrip
          track={track}
          sectors={summary.sectors}
          colors={colors}
          active={highlighted}
          onActive={setActive}
        />
      )}
    </Card>
  )
}

interface SectorViewProps {
  track: Track
  sectors: MiniSector[]
  colors: Record<string, string>
  active: number | null
  onActive: (i: number | null) => void
}

function SectorMap({ track, sectors, colors, active, onActive }: SectorViewProps) {
  const proj = useMemo(() => makeProjection(track, 0.09), [track])
  const pts = useMemo(() => track.outline.map(([x, y]) => proj.project(x, y)), [track, proj])
  const paths = useMemo(() => {
    const n = pts.length
    return sectors.map((s) => {
      const out: string[] = []
      const last = Math.min(n, Math.ceil(s.to * n))
      for (let i = Math.floor(s.from * n); i <= last; i++) out.push(pts[i % n].map((v) => v.toFixed(1)).join(','))
      return out.join(' ')
    })
  }, [pts, sectors])
  const corners = useMemo(
    () =>
      track.corners.map((c) => {
        // rótulo afastado ~90 m do ponto da curva, na direção de `angle`
        const a = (c.angle * Math.PI) / 180
        return {
          label: `${c.number}${c.letter ?? ''}`,
          at: proj.project(c.x, c.y),
          tag: proj.project(c.x + 90 * Math.cos(a), c.y + 90 * Math.sin(a)),
        }
      }),
    [track, proj],
  )

  const w = proj.size * 0.022
  const color = (s: MiniSector) => (s.winner ? colors[s.winner] : TIE_COLOR)
  const [x0, y0] = pts[0]
  const [x1, y1] = pts[Math.min(3, pts.length - 1)]
  const heading = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
  const [vx, vy, vw, vh] = proj.viewBox.split(' ').map(Number)

  const sel = active != null ? sectors[active] : null
  // tooltip perto do meio do trecho, do lado com mais espaço
  let tip: { left: string; top: string; flip: boolean } | null = null
  if (sel) {
    const mid = pts[Math.floor(((sel.from + sel.to) / 2) * pts.length) % pts.length]
    const fx = (mid[0] - vx) / vw
    tip = { left: `${fx * 100}%`, top: `${((mid[1] - vy) / vh) * 100}%`, flip: fx > 0.55 }
  }

  return (
    <>
      <svg viewBox={proj.viewBox} role="img" aria-label="Mapa da pista com o piloto mais rápido em cada trecho">
        <polygon
          points={pts.map((p) => p.join(',')).join(' ')}
          fill="none"
          className="ms-casing"
          strokeWidth={w * 1.9}
        />
        {sectors.map((s, i) => (
          <polyline
            key={i}
            points={paths[i]}
            fill="none"
            stroke={color(s)}
            strokeWidth={w}
            strokeLinejoin="round"
            opacity={active != null && active !== i ? 0.35 : 1}
            onMouseEnter={() => onActive(i)}
            onClick={() => onActive(active === i ? null : i)}
          />
        ))}
        {sectors.map((s, i) => {
          const p = pts[Math.floor(s.from * pts.length) % pts.length]
          return <circle key={i} cx={p[0]} cy={p[1]} r={w * 0.16} className="ms-tick" />
        })}
        {sel && active != null && (
          <g pointerEvents="none">
            <polyline points={paths[active]} fill="none" stroke="#fff" strokeWidth={w * 1.7} strokeLinejoin="round" opacity={0.9} />
            <polyline points={paths[active]} fill="none" stroke={color(sel)} strokeWidth={w * 1.1} strokeLinejoin="round" />
          </g>
        )}
        <g transform={`translate(${x0},${y0}) rotate(${heading})`} className="ms-start" pointerEvents="none">
          <rect x={-w * 0.25} y={-w * 1.1} width={w * 0.5} height={w * 2.2} />
          <path d={`M ${w * 1.3} ${-w * 1.3} L ${w * 2.6} 0 L ${w * 1.3} ${w * 1.3} Z`} />
        </g>
        <g pointerEvents="none">
          {corners.map((c) => (
            <g key={c.label} className="ms-corner">
              <line x1={c.at[0]} y1={c.at[1]} x2={c.tag[0]} y2={c.tag[1]} strokeWidth={w * 0.12} />
              <circle cx={c.tag[0]} cy={c.tag[1]} r={proj.size * 0.018} strokeWidth={w * 0.1} />
              <text x={c.tag[0]} y={c.tag[1]} fontSize={proj.size * 0.02}>
                {c.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {sel && tip && (
        <div
          className={`ms-tip${tip.flip ? ' flip' : ''}`}
          style={{ left: tip.left, top: tip.top }}
          role="tooltip"
        >
          <SectorDetail track={track} sector={sel} total={sectors.length} colors={colors} />
        </div>
      )}
    </>
  )
}

function SectorDetail({ track, sector, total, colors }: { track: Track; sector: MiniSector; total: number; colors: Record<string, string> }) {
  const from = Math.round(sector.from * track.lapLength)
  const to = Math.round(sector.to * track.lapLength)
  const corners = track.corners
    .filter((c) => c.distance >= from && c.distance < to)
    .map((c) => `${c.number}${c.letter ?? ''}`)
  const best = sector.ranking[0]?.time ?? 0
  return (
    <>
      <h4>
        Trecho {sector.index + 1} de {total}
        {!sector.winner && <span className="muted"> · empate</span>}
      </h4>
      <div className="ms-where">
        {from.toLocaleString('pt-BR')}–{to.toLocaleString('pt-BR')} m
        {corners.length > 0 && ` · ${corners.length > 1 ? 'curvas' : 'curva'} ${corners.join(', ')}`}
      </div>
      <table>
        <tbody>
          {sector.ranking.map((r, i) => (
            <tr key={r.driver} className={i === 0 ? 'win' : undefined}>
              <td>
                <i style={{ background: colors[r.driver] }} />
                {r.driver}
              </td>
              <td className="num mono">{seconds(r.time)} s</td>
              <td className={`num mono ${i === 0 ? 'muted' : 'down'}`}>{i === 0 ? 'melhor' : `+${seconds(r.time - best)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** A volta "esticada" em linha reta: um bloco por trecho, com as curvas embaixo. */
function SectorStrip({ track, sectors, colors, active, onActive }: SectorViewProps) {
  return (
    <div className="ms-strip-wrap" onMouseLeave={() => onActive(null)}>
      <div className="ms-strip-label">
        <span>Largada</span>
        <span>volta esticada · {(track.lapLength / 1000).toFixed(2).replace('.', ',')} km</span>
        <span>Chegada</span>
      </div>
      <div className="ms-strip">
        {sectors.map((s, i) => (
          <button
            key={i}
            type="button"
            className={active === i ? 'on' : undefined}
            style={{
              background: s.winner ? colors[s.winner] : TIE_COLOR,
              opacity: active != null && active !== i ? 0.35 : 1,
            }}
            aria-label={`Trecho ${i + 1}: ${s.winner ?? 'empate'}`}
            onMouseEnter={() => onActive(i)}
            onFocus={() => onActive(i)}
            onBlur={() => onActive(null)}
            onClick={() => onActive(active === i ? null : i)}
          />
        ))}
      </div>
      <div className="ms-strip-corners" aria-hidden="true">
        {track.corners.map((c) => (
          <b key={`${c.number}${c.letter ?? ''}`} style={{ left: `${(c.distance / track.lapLength) * 100}%` }}>
            {c.number}
            {c.letter ?? ''}
          </b>
        ))}
      </div>
    </div>
  )
}
