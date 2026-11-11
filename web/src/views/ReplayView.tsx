import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPositions, loadTrack, loadTrackStatus } from '../lib/data'
import {
  TRACK_STATUS_LABEL,
  buildRaceModel,
  formatClock,
  leaderLapsAt,
  positionCoverage,
  makeProjection,
  positionAt,
  statusAt,
  towerAt,
} from '../lib/replay'
import type { DriverPositions, DriverResult, Lap, SessionMeta, Track, TrackStatusChange } from '../types/data'

const SPEEDS = [1, 4, 16]
const COMPOUND: Record<string, { letter: string; className: string }> = {
  SOFT: { letter: 'S', className: 'soft' },
  MEDIUM: { letter: 'M', className: 'medium' },
  HARD: { letter: 'H', className: 'hard' },
  INTERMEDIATE: { letter: 'I', className: 'inter' },
  WET: { letter: 'W', className: 'wet' },
}

interface Props {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
}

interface ReplayData {
  track: Track
  status: TrackStatusChange[]
  positions: DriverPositions[]
}

export default function ReplayView({ path, meta, results, laps }: Props) {
  const replay = meta.replay!
  const [data, setData] = useState<ReplayData | null>(null)
  const [loaded, setLoaded] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // estado novo a cada sessão: o pai remonta este componente com key={path}
    let cancelled = false
    const positions = Promise.all(
      replay.drivers.map((d) =>
        loadPositions(path, d).then((p) => {
          if (!cancelled) setLoaded((n) => n + 1)
          return p
        }),
      ),
    )
    Promise.all([loadTrack(path), loadTrackStatus(path), positions])
      .then(([track, status, positions]) => !cancelled && setData({ track, status, positions }))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [path, replay.drivers])

  if (error) return <p className="notice error">{error}</p>
  if (!data) {
    return (
      <p className="notice">
        Carregando posições… {loaded}/{replay.drivers.length} pilotos
      </p>
    )
  }
  const coverage = positionCoverage(data.positions)
  return (
    <>
      {coverage < 0.8 && (
        <p className="notice warn">
          Os dados de posição desta corrida estão incompletos na fonte: só {Math.round(coverage * 100)}% da prova tem a
          localização dos carros. Em boa parte do replay os carros não aparecem no mapa; a torre, as voltas e a
          telemetria não são afetadas.
        </p>
      )}
      <Replay meta={meta} results={results} laps={laps} data={data} />
    </>
  )
}

function Replay({ meta, results, laps, data }: Omit<Props, 'path'> & { data: ReplayData }) {
  const { start, end } = meta.replay!
  const [t, setT] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [selected, setSelected] = useState<string | null>(null)

  // Animação: avança o tempo de sessão a cada quadro
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000
      last.current = now
      setT((cur) => {
        const next = cur + dt * speed
        if (next >= end) {
          setPlaying(false)
          return end
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      last.current = null
    }
  }, [playing, speed, end])

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && t >= end) setT(start)
      return !p
    })
  }, [t, end, start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, select, button')) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  const proj = useMemo(() => makeProjection(data.track), [data.track])
  const model = useMemo(() => buildRaceModel(laps, results), [laps, results])
  const colors = useMemo(() => new Map(results.map((r) => [r.driver, r.teamColor ?? '#888'])), [results])

  const outline = useMemo(
    () => data.track.outline.map(([x, y]) => proj.project(x, y).map((v) => v.toFixed(1)).join(',')).join(' '),
    [data.track, proj],
  )
  const finishLine = useMemo(() => {
    const [a, b] = data.track.outline
    const [x0, y0] = proj.project(a[0], a[1])
    const [x1, y1] = proj.project(b[0], b[1])
    const len = Math.hypot(x1 - x0, y1 - y0) || 1
    const nx = (-(y1 - y0) / len) * proj.size * 0.018
    const ny = ((x1 - x0) / len) * proj.size * 0.018
    return { x1: x0 - nx, y1: y0 - ny, x2: x0 + nx, y2: y0 + ny }
  }, [data.track, proj])
  const corners = useMemo(
    () =>
      data.track.corners.map((c) => {
        // rótulo afastado ~50 m do ponto da curva, na direção de `angle`
        const a = (c.angle * Math.PI) / 180
        const [x, y] = proj.project(c.x + 50 * Math.cos(a), c.y + 50 * Math.sin(a))
        return { label: `${c.number}${c.letter ?? ''}`, x, y }
      }),
    [data.track, proj],
  )

  const tower = towerAt(model, t)
  const out = new Set(tower.filter((r) => r.out).map((r) => r.driver))
  const leaderLaps = leaderLapsAt(model, t)
  const finished = leaderLaps >= model.totalLaps
  const status = finished ? 'chequered' : statusAt(data.status, t)
  const currentLap = Math.min(leaderLaps + 1, model.totalLaps)

  const jumpLap = (delta: number) => {
    const target = Math.max(0, Math.min(model.totalLaps, leaderLaps + delta))
    setT(target === 0 ? start : model.firstEnd[target] + 0.01)
  }

  const r = proj.size * 0.011
  // desenha o selecionado por último, por cima dos outros
  const cars = data.positions
    .filter((p) => !out.has(p.driver))
    .map((p) => ({ driver: p.driver, pos: positionAt(p, t) }))
    .filter((c): c is { driver: string; pos: [number, number] } => c.pos != null)
    .sort((a, b) => Number(a.driver === selected) - Number(b.driver === selected))

  return (
    <div className="replay">
      <div className="replay-grid">
        <div className="map-card">
          <div className="map-hud">
            <span>
              Volta <strong>{currentLap}</strong> / {model.totalLaps}
            </span>
            <span className={`flag flag-${status}`}>{TRACK_STATUS_LABEL[status]}</span>
          </div>
          <svg viewBox={proj.viewBox} className="track-map" role="img" aria-label={`Traçado de ${meta.location}`}>
            <polygon points={outline} className="track-outer" strokeWidth={proj.size * 0.02} />
            <polygon points={outline} className="track-inner" strokeWidth={proj.size * 0.011} />
            <line {...finishLine} className="finish-line" strokeWidth={proj.size * 0.005} />
            {corners.map((c) => (
              <text key={c.label} x={c.x} y={c.y} className="corner-label" fontSize={proj.size * 0.022}>
                {c.label}
              </text>
            ))}
            {cars.map(({ driver, pos }) => {
              const [x, y] = proj.project(pos[0], pos[1])
              const isSel = driver === selected
              return (
                <g key={driver} onClick={() => setSelected(isSel ? null : driver)} className="car">
                  <circle cx={x} cy={y} r={isSel ? r * 1.5 : r} fill={colors.get(driver)} className="car-dot" strokeWidth={r * 0.3} />
                  {isSel && (
                    <text x={x + r * 2} y={y - r * 1.6} className="car-label" fontSize={proj.size * 0.028}>
                      {driver}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        <ol className="tower" aria-label="Posições">
          {tower.map((row) => {
            const c = row.compound ? COMPOUND[row.compound] : null
            return (
              <li
                key={row.driver}
                className={`${row.driver === selected ? 'selected' : ''} ${row.out ? 'out' : ''}`}
                onClick={() => setSelected(row.driver === selected ? null : row.driver)}
              >
                <span className="t-pos">{row.out ? '' : row.position}</span>
                <span className="team-bar" style={{ background: row.teamColor ?? 'var(--muted)' }} />
                <span className="t-driver">{row.driver}</span>
                {row.inPit && <span className="pit-tag">PIT</span>}
                {row.finished && !row.out && <span className="fin-tag" aria-label="Terminou">🏁</span>}
                <span className="t-spacer" />
                {c && !row.out && <span className={`tyre ${c.className}`}>{c.letter}</span>}
                <span className="t-gap">{row.gap}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="replay-controls">
        <button className="icon-btn" onClick={() => jumpLap(-1)} aria-label="Volta anterior" title="Volta anterior">
          ⏮
        </button>
        <button className="icon-btn play" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'} title="Espaço">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" onClick={() => jumpLap(1)} aria-label="Próxima volta" title="Próxima volta">
          ⏭
        </button>
        <input
          type="range"
          min={start}
          max={end}
          step={1}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          aria-label="Tempo de prova"
        />
        <span className="clock">{formatClock(t - start)}</span>
        <div className="speeds" role="group" aria-label="Velocidade">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'active' : undefined} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <p className="foot">
        Clique num piloto (na torre ou no mapa) para destacá-lo. Espaço: reproduzir/pausar. Traçado da volta mais rápida (
        {data.track.referenceLap.driver}, volta {data.track.referenceLap.lap}).
      </p>
    </div>
  )
}
