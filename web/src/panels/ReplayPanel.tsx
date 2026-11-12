import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Card from '../components/Card'
import RaceControlFeed from '../components/RaceControlFeed'
import WeatherPanel from '../components/WeatherPanel'
import { loadPositions, loadRaceControl, loadTrack, loadTrackStatus, loadWeather } from '../lib/data'
import { dimmed } from '../lib/focus'
import {
  TRACK_STATUS_LABEL,
  buildRaceModel,
  formatClock,
  leaderLapsAt,
  makeProjection,
  positionAt,
  positionCoverage,
  statusAt,
  towerAt,
} from '../lib/replay'
import type {
  DriverPositions,
  DriverResult,
  Lap,
  RaceControlMessage,
  SessionMeta,
  Track,
  TrackStatusChange,
  WeatherSample,
} from '../types/data'
import { COMPOUND } from '../lib/tyres'
import type { FocusProps } from './RacePanels'

const SPEEDS = [1, 4, 16]

interface Props extends FocusProps {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
  /** Voltas completas do líder no replay (null antes de começar), para o cursor dos gráficos. */
  onLap: (lap: number | null) => void
}

interface ReplayData {
  track: Track
  status: TrackStatusChange[]
  positions: DriverPositions[]
  /** null = sessão exportada antes de existir o arquivo */
  weather: WeatherSample[] | null
  raceControl: RaceControlMessage[] | null
}

/** Mapa com replay (8 colunas) e torre de posições (4 colunas), como dois cartões da grade. */
export default function ReplayPanel({ path, ...props }: Props) {
  const replay = props.meta.replay!
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
    Promise.all([loadTrack(path), loadTrackStatus(path), positions, loadWeather(path), loadRaceControl(path)])
      .then(
        ([track, status, positions, weather, raceControl]) =>
          !cancelled && setData({ track, status, positions, weather, raceControl }),
      )
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [path, replay.drivers])

  if (error || !data) {
    return (
      <Card title="Mapa e replay" span={12} id="replay">
        {error ? (
          <p className="notice error">{error}</p>
        ) : (
          <p className="muted loading">
            Carregando posições… {loaded}/{replay.drivers.length} pilotos
          </p>
        )}
      </Card>
    )
  }
  return <Replay {...props} data={data} />
}

function Replay({ meta, results, laps, data, focus, onToggle, onLap }: Omit<Props, 'path'> & { data: ReplayData }) {
  const { start, end } = meta.replay!
  const [t, setT] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)

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
  const coverage = useMemo(() => positionCoverage(data.positions), [data.positions])

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
  // faixas de bandeira na linha do tempo
  const flagBands = useMemo(() => {
    const out: { from: number; to: number; status: string }[] = []
    data.status.forEach((s, i) => {
      if (s.status === 'green' || s.status === 'unknown') return
      const to = data.status[i + 1]?.time ?? end
      if (to > start && s.time < end) out.push({ from: Math.max(s.time, start), to: Math.min(to, end), status: s.status })
    })
    return out
  }, [data.status, start, end])

  const tower = towerAt(model, t)
  const out = new Set(tower.filter((r) => r.out).map((r) => r.driver))
  const leaderLaps = leaderLapsAt(model, t)
  const finished = leaderLaps >= model.totalLaps
  const status = finished ? 'chequered' : statusAt(data.status, t)
  const currentLap = Math.min(leaderLaps + 1, model.totalLaps)

  // cursor dos gráficos: voltas completas do líder, só depois que o replay sai da largada
  const cursor = t > start ? leaderLaps : null
  useEffect(() => onLap(cursor), [cursor, onLap])

  const jumpLap = (delta: number) => {
    const target = Math.max(0, Math.min(model.totalLaps, leaderLaps + delta))
    setT(target === 0 ? start : model.firstEnd[target] + 0.01)
  }

  // relógio da prova (0:00 = largada) nos horários do feed e do gráfico de clima
  const raceClock = useCallback((v: number) => (v < start ? `-${formatClock(start - v)}` : formatClock(v - start)), [start])
  const messageTime = useCallback((m: RaceControlMessage) => raceClock(m.time), [raceClock])
  const [feedSynced, setFeedSynced] = useState(true)
  const pickMessage = useCallback(
    (m: RaceControlMessage) => {
      setPlaying(false)
      setT(Math.max(start, Math.min(end, m.time)))
    },
    [start, end],
  )

  const r = proj.size * 0.011
  // pilotos em foco por cima dos outros
  const cars = data.positions
    .filter((p) => !out.has(p.driver))
    .map((p) => ({ driver: p.driver, pos: positionAt(p, t) }))
    .filter((c): c is { driver: string; pos: [number, number] } => c.pos != null)
    .sort((a, b) => Number(focus.includes(a.driver)) - Number(focus.includes(b.driver)))
  const pct = ((t - start) / (end - start)) * 100

  return (
    <>
      <Card
        title="Mapa e replay"
        span={8}
        id="replay"
        className="replay-card"
        aside={
          <>
            <span className={`flag flag-${status}`}>{TRACK_STATUS_LABEL[status]}</span>
            <span className="lap-count">
              Volta <strong>{currentLap}</strong>/{model.totalLaps}
            </span>
          </>
        }
      >
        {coverage < 0.8 && (
          <p className="notice warn">
            A fonte só tem a localização dos carros em {Math.round(coverage * 100)}% desta prova: em boa parte do replay os
            carros não aparecem no mapa. A torre, as voltas e a telemetria não são afetadas.
          </p>
        )}
        <svg viewBox={proj.viewBox} className="track-map" role="img" aria-label={`Traçado de ${meta.location}`}>
          <polygon points={outline} className="track-outer" strokeWidth={proj.size * 0.024} />
          <polygon points={outline} className="track-inner" strokeWidth={proj.size * 0.006} />
          <line {...finishLine} className="finish-line" strokeWidth={proj.size * 0.005} />
          {corners.map((c) => (
            <text key={c.label} x={c.x} y={c.y} className="corner-label" fontSize={proj.size * 0.022}>
              {c.label}
            </text>
          ))}
          {cars.map(({ driver, pos }) => {
            const [x, y] = proj.project(pos[0], pos[1])
            const on = focus.includes(driver)
            return (
              <g key={driver} onClick={() => onToggle(driver)} className={`car ${dimmed(focus, driver) ? 'dim' : ''}`}>
                <circle cx={x} cy={y} r={on ? r * 1.5 : r} fill={colors.get(driver)} className={`car-dot ${on ? 'on' : ''}`} strokeWidth={r * 0.3} />
                {on && (
                  <text x={x + r * 2} y={y - r * 1.6} className="car-label" fontSize={proj.size * 0.03}>
                    {driver}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

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
          <div className="timeline" style={{ ['--pct' as string]: `${pct}%` }}>
            {flagBands.map((b) => (
              <span
                key={b.from}
                className={`timeline-band flag-${b.status}`}
                style={{ left: `${((b.from - start) / (end - start)) * 100}%`, width: `${((b.to - b.from) / (end - start)) * 100}%` }}
                title={TRACK_STATUS_LABEL[b.status as keyof typeof TRACK_STATUS_LABEL]}
              />
            ))}
            <input
              type="range"
              min={start}
              max={end}
              step={1}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              aria-label="Tempo de prova"
            />
          </div>
          <span className="clock">
            {formatClock(t - start)} <span className="muted">/ {formatClock(end - start)}</span>
          </span>
          <div className="speeds" role="group" aria-label="Velocidade">
            {SPEEDS.map((s) => (
              <button key={s} className={s === speed ? 'active' : undefined} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
        <p className="foot">
          Espaço reproduz ou pausa. Clique num carro para pôr o piloto em foco. Traçado da volta{' '}
          {data.track.referenceLap.lap} de {data.track.referenceLap.driver}.
        </p>
      </Card>

      <Card title="Torre" span={4} className="tower-card" aside={<span className="muted">acompanha o replay</span>}>
        <ol className="tower" aria-label="Posições">
          {tower.map((row) => {
            const c = row.compound ? COMPOUND[row.compound] : null
            return (
              <li
                key={row.driver}
                className={`${focus.includes(row.driver) ? 'focused' : ''} ${row.out ? 'out' : ''} ${dimmed(focus, row.driver) ? 'dim' : ''}`}
                onClick={() => onToggle(row.driver)}
              >
                <span className="t-pos">{row.out ? '' : row.position}</span>
                <span className="team-bar" style={{ background: row.teamColor ?? 'var(--muted)' }} />
                <span className="t-driver">{row.driver}</span>
                {row.inPit && <span className="pit-tag">PIT</span>}
                {row.finished && !row.out && (
                  <span className="fin-tag" aria-label="Terminou">
                    🏁
                  </span>
                )}
                <span className="t-spacer" />
                {c && !row.out && <span className={`tyre ${c.className}`}>{c.letter}</span>}
                <span className="t-gap">{row.gap}</span>
              </li>
            )
          })}
        </ol>
      </Card>

      {data.raceControl && (
        <Card
          title="Direção de prova"
          span={8}
          className="rc-card"
          aside={
            <div className="seg" role="group" aria-label="Mensagens mostradas">
              <button className={feedSynced ? 'active' : undefined} onClick={() => setFeedSynced(true)}>
                Até o replay
              </button>
              <button className={feedSynced ? undefined : 'active'} onClick={() => setFeedSynced(false)}>
                Prova inteira
              </button>
            </div>
          }
        >
          <RaceControlFeed
            messages={data.raceControl}
            now={feedSynced ? t : null}
            formatTime={messageTime}
            onPick={pickMessage}
            focus={focus}
            onToggle={onToggle}
            teamColors={colors}
          />
          <p className="foot">Clique numa mensagem para levar o replay até ela. Horários no relógio da prova (0:00 = largada).</p>
        </Card>
      )}
      {data.weather && (
        <Card title="Clima" span={4} className="weather-card" aside={<span className="muted">acompanha o replay</span>}>
          <WeatherPanel samples={data.weather} now={t} formatX={raceClock} />
        </Card>
      )}
    </>
  )
}
