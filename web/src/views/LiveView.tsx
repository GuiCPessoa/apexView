import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Card from '../components/Card'
import { formatLapTime, loadTrack } from '../lib/data'
import { dimmed, toggleFocus } from '../lib/focus'
import { LIVE_URL, formatLiveGap, sourceKey, tracePath, useLiveFeed, type LiveStatus } from '../lib/live'
import { similarColors } from '../lib/telemetry'
import { TRACK_STATUS_LABEL, formatClock, makeProjection } from '../lib/replay'
import { COMPOUND } from '../lib/tyres'
import type { DataIndex, Track } from '../types/data'
import type { LiveCatalog, LiveDriver, LiveScheduled, LiveSnapshot, LiveTimed } from '../types/live'

const DELAYS = [0, 5, 10, 15, 20, 30, 45, 60]
const SPEEDS = [1, 4, 16, 32]

const START_HELP = `cd live && source .venv/bin/activate
python server.py`

const SESSION_NAME: Record<string, string> = {
  Race: 'Corrida',
  Qualifying: 'Classificação',
  Sprint: 'Sprint',
  'Sprint Qualifying': 'Quali sprint',
  'Sprint Shootout': 'Quali sprint',
  'Practice 1': 'Treino 1',
  'Practice 2': 'Treino 2',
  'Practice 3': 'Treino 3',
}

/** Modo ao vivo: dados do backend local (live/server.py), com atraso ajustável para casar com a TV. */
export default function LiveView({ index }: { index: DataIndex | null }) {
  const [delay, setDelay] = useState(0)
  const [focus, setFocus] = useState<string[]>([])
  const [gapMode, setGapMode] = useState<'gap' | 'interval'>('gap')
  const [choosing, setChoosing] = useState(false)
  const { status, snapshot, send, requestTraces, catalog, requestCatalog } = useLiveFeed(delay)
  const onToggle = useCallback((d: string) => setFocus((f) => toggleFocus(f, d)), [])
  const track = useExportedTrack(index, snapshot)

  if (!snapshot) return <Offline status={status} />

  const s = snapshot
  const hasSession = s.session.name != null
  const isRace = s.session.type === 'Race'
  const replay = s.source.mode === 'replay'
  const idle = s.source.mode === 'idle'
  const canChoose = s.source.canChoose ?? false
  const showChooser = canChoose && (choosing || idle)
  const choose = (path: string) => {
    send({ cmd: 'select', path })
    setChoosing(false)
  }

  return (
    <section className="live">
      {s.source.error && <p className="notice error">{s.source.error}</p>}
      {s.source.loading && <DownloadNotice loading={s.source.loading} />}
      {status !== 'open' && <p className="notice warn">Conexão com o backend perdida; reconectando…</p>}

      <div className="hero">
        <div className="hero-title">
          <span className="kicker">
            {replay ? (
              <span className="live-badge sim">Simulação</span>
            ) : (
              <span className="live-badge">Ao vivo</span>
            )}{' '}
            {hasSession ? (SESSION_NAME[s.session.name ?? ''] ?? s.session.name) : ''}
          </span>
          <h1>{s.session.meeting ?? (idle ? 'Escolha uma sessão' : 'Sem sessão no momento')}</h1>
          <p>
            {hasSession
              ? [s.session.circuit, s.session.country, statusLabel(s.session.status)].filter(Boolean).join(' · ')
              : idle
                ? 'Nenhuma gravação ainda. Escolha abaixo uma sessão do arquivo da F1 para simular.'
                : 'O feed está conectado, mas nenhuma sessão está acontecendo agora.'}
          </p>
          {s.source.mode !== 'live' && s.source.nextLive && <NextLive next={s.source.nextLive} />}
        </div>
        <div className="hero-stats">
          {isRace && s.lap.current != null && (
            <div className="stat">
              <span className="stat-label">Volta</span>
              <span className="stat-value">{`${s.lap.current}/${s.lap.total ?? '—'}`}</span>
              <span className="stat-sub">{s.clock?.remaining != null ? `${formatClock(s.clock.remaining)} restantes` : ''}</span>
            </div>
          )}
          {!isRace && s.clock?.remaining != null && (
            <div className="stat">
              <span className="stat-label">Tempo restante</span>
              <span className="stat-value">{formatClock(s.clock.remaining)}</span>
              <span className="stat-sub">{s.clock.running ? 'relógio correndo' : 'relógio parado'}</span>
            </div>
          )}
          {s.trackStatus && (
            <div className="stat">
              <span className="stat-label">Pista</span>
              <span className="stat-value">
                <span className={`flag flag-${s.trackStatus}`}>{TRACK_STATUS_LABEL[s.trackStatus]}</span>
              </span>
              <span className="stat-sub">{s.weather?.rainfall ? 'chovendo' : 'sem chuva'}</span>
            </div>
          )}
          <div className="stat">
            <label className="stat-label" htmlFor="live-delay">
              Atraso
            </label>
            <select id="live-delay" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
              {DELAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Sem atraso' : `${d} s`}
                </option>
              ))}
            </select>
            <span className="stat-sub">para sincronizar com a TV</span>
          </div>
        </div>
      </div>

      {replay && <ReplayBar s={s} send={send} onChoose={canChoose ? () => setChoosing((c) => !c) : undefined} choosing={showChooser} />}

      {showChooser && (
        <div className="dash">
          <SessionChooser
            s={s}
            catalog={catalog}
            requestCatalog={requestCatalog}
            onSelect={choose}
            onClose={idle ? undefined : () => setChoosing(false)}
          />
        </div>
      )}

      {hasSession && (
        <div className="dash" key={sourceKey(s)}>
          <LiveMap s={s} track={track} focus={focus} onToggle={onToggle} />
          <Card
            title="Torre"
            span={4}
            aside={
              <div className="seg" role="group" aria-label="Diferença">
                <button className={gapMode === 'gap' ? 'active' : undefined} onClick={() => setGapMode('gap')}>
                  Líder
                </button>
                <button className={gapMode === 'interval' ? 'active' : undefined} onClick={() => setGapMode('interval')}>
                  Intervalo
                </button>
              </div>
            }
          >
            <ol className="tower live-tower" aria-label="Posições">
              {s.drivers.map((d) => (
                <TowerRow key={d.driver} d={d} gapMode={gapMode} focus={focus} onToggle={onToggle} />
              ))}
            </ol>
          </Card>
          <CarsCard s={s} focus={focus} lapLength={track?.lapLength ?? null} requestTraces={requestTraces} />
          <Card title="Direção de prova" span={4} className="rc-card">
            <Weather s={s} />
            <ol className="rc-list">
              {s.raceControl.length === 0 && <li className="muted">Nenhuma mensagem ainda.</li>}
              {s.raceControl.map((m, i) => (
                <li key={`${m.utc}-${i}`}>
                  <span className="rc-meta">
                    {m.utc ? new Date(`${m.utc}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                    {m.lap ? ` · V${m.lap}` : ''}
                  </span>
                  {m.flag && <span className={`rc-flag rc-${m.flag.toLowerCase().replace(/\s+/g, '-')}`}>{m.flag}</span>}
                  <span>{m.message}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
      <p className="foot">
        Feed oficial de live timing da F1 (não documentado; uso pessoal). Backend em {LIVE_URL}.
      </p>
    </section>
  )
}

function statusLabel(status: string | null): string | null {
  const map: Record<string, string> = {
    Inactive: 'aguardando início',
    Started: 'em andamento',
    Aborted: 'interrompida',
    Finished: 'encerrada',
    Finalised: 'resultado final',
    Ends: 'encerrada',
  }
  return status ? (map[status] ?? status) : null
}

function Offline({ status }: { status: LiveStatus }) {
  return (
    <section className="live">
      <div className="hero">
        <div className="hero-title">
          <span className="kicker">Ao vivo</span>
          <h1>Backend desligado</h1>
          <p>{status === 'connecting' ? 'Conectando…' : `Sem resposta de ${LIVE_URL}. Tentando de novo a cada 2 s.`}</p>
        </div>
      </div>
      <div className="dash">
        <Card title="Como ligar" span={12}>
          <p>Num terminal, dentro da pasta do projeto:</p>
          <pre className="code">{START_HELP}</pre>
          <p className="muted">
            O modo ao vivo usa o mesmo login F1 TV do pipeline. Se o token tiver vencido, refaça o login do FastF1 (veja o
            INICIO.md).
          </p>
        </Card>
      </div>
    </section>
  )
}

// ---------- Controles da simulação ----------

function ReplayBar({
  s,
  send,
  onChoose,
  choosing,
}: {
  s: LiveSnapshot
  send: (cmd: Record<string, unknown>) => void
  onChoose?: () => void
  choosing: boolean
}) {
  const [seek, setSeek] = useState<number | null>(null)
  const elapsed = s.source.elapsed ?? 0
  const duration = s.source.duration ?? 0
  const value = seek ?? elapsed
  const commit = () => {
    if (seek != null) send({ cmd: 'seek', value: seek })
    setSeek(null)
  }
  return (
    <div className="replay-bar">
      {onChoose ? (
        <button className={`chip choose-btn ${choosing ? 'on' : ''}`} onClick={onChoose} aria-expanded={choosing}>
          Trocar sessão
        </button>
      ) : (
        <span className="muted">Simulação de {s.source.recording}</span>
      )}
      <button
        className="icon-btn play"
        onClick={() => send({ cmd: 'pause', value: !s.source.paused })}
        aria-label={s.source.paused ? 'Continuar' : 'Pausar'}
      >
        {s.source.paused ? '▶' : '❚❚'}
      </button>
      <div className="timeline" style={{ ['--pct' as string]: `${duration ? (value / duration) * 100 : 0}%` }}>
        <input
          type="range"
          min={0}
          max={duration}
          step={10}
          value={value}
          onChange={(e) => setSeek(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          aria-label="Ponto da gravação"
        />
      </div>
      <span className="clock">
        {formatClock(value)} <span className="muted">/ {formatClock(duration)}</span>
      </span>
      <div className="speeds" role="group" aria-label="Velocidade">
        {SPEEDS.map((v) => (
          <button key={v} className={v === s.source.speed ? 'active' : undefined} onClick={() => send({ cmd: 'speed', value: v })}>
            {v}×
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Escolha da sessão ----------

const dateTime = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('pt-BR', opts)

/** No modo automático: quando o ao vivo liga sozinho. */
function NextLive({ next }: { next: LiveScheduled }) {
  const when = dateTime(next.start, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <p className="next-live">
      <span className="live-badge">Ao vivo automático</span> {next.label}, {when}
    </p>
  )
}

function DownloadNotice({ loading }: { loading: NonNullable<LiveSnapshot['source']['loading']> }) {
  return (
    <div className="notice download">
      <span>
        Baixando <b>{loading.label}</b> do arquivo da F1…
      </span>
      <progress max={loading.total} value={loading.done} />
      <span className="muted mono">
        {loading.done}/{loading.total}
      </span>
    </div>
  )
}

/** Lista as sessões de um ano (as já baixadas e as do arquivo da F1) para simular. */
function SessionChooser({
  s,
  catalog,
  requestCatalog,
  onSelect,
  onClose,
}: {
  s: LiveSnapshot
  catalog: LiveCatalog | null
  requestCatalog: (year: number | null) => void
  onSelect: (path: string) => void
  onClose?: () => void
}) {
  const selected = s.source.selected ?? null
  const [year, setYear] = useState(() => (selected ? Number(selected.slice(0, 4)) : new Date().getFullYear()))
  // pede de novo quando a sessão muda (uma recém-baixada passa a constar como gravada)
  useEffect(() => {
    requestCatalog(year)
  }, [year, selected, requestCatalog])
  const data = catalog?.year === year ? catalog : null
  const years = catalog?.years ?? [year]
  const busy = s.source.loading != null

  return (
    <Card
      title="Escolher sessão"
      span={12}
      className="chooser"
      aside={
        <div className="chooser-aside">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Temporada">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          )}
        </div>
      }
    >
      {data?.error && <p className="notice warn">{data.error}</p>}
      {!data ? (
        <p className="muted loading">Carregando as sessões de {year}…</p>
      ) : data.meetings.length === 0 ? (
        <p className="muted">Nenhuma sessão de {year} disponível.</p>
      ) : (
        <ol className="chooser-list">
          {[...data.meetings].reverse().map((m, i) => (
            <li key={`${m.name}-${i}`}>
              <div className="chooser-gp">
                <span className="muted mono">{m.number ? `R${m.number}` : ''}</span>
                <strong>{m.name}</strong>
                <span className="muted">{m.location}</span>
              </div>
              <div className="chooser-sessions">
                {m.sessions.map((x) => {
                  const current = x.path === selected
                  const when = x.start ? dateTime(x.start, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
                  return (
                    <button
                      key={x.path}
                      className={`chip ${current ? 'on current' : ''} ${x.recorded ? 'recorded' : 'ghost'}`}
                      disabled={busy || current}
                      onClick={() => onSelect(x.path)}
                      title={`${when}${x.recorded ? ' · já baixada' : ' · baixa do arquivo da F1'}`}
                    >
                      {!x.recorded && <span aria-hidden="true">↓</span>}
                      {SESSION_NAME[x.name ?? ''] ?? x.name}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="foot">
        Sessões com ↓ ainda não foram baixadas: ao escolher, o servidor baixa do arquivo da F1 (cerca de 1 min) e guarda em
        live/recordings/. No fim de semana de GP, o ao vivo entra sozinho no horário da sessão.
      </p>
    </Card>
  )
}

// ---------- Mapa ----------

/** Traçado exportado do mesmo GP (melhor e com rotação oficial), se existir em data/. */
function useExportedTrack(index: DataIndex | null, s: LiveSnapshot | null): Track | null {
  const start = s?.session.start ?? null
  const meeting = s?.session.meeting ?? null
  const path = useMemo(() => {
    const year = start ? Number(start.slice(0, 4)) : null
    return index?.sessions.find((x) => x.year === year && x.eventName === meeting)?.path ?? null
  }, [index, start, meeting])
  const [track, setTrack] = useState<{ path: string; track: Track } | null>(null)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    loadTrack(path)
      .then((t) => !cancelled && setTrack({ path, track: t }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [path])
  return track && track.path === path ? track.track : null
}

function LiveMap({
  s,
  track,
  focus,
  onToggle,
}: {
  s: LiveSnapshot
  track: Track | null
  focus: string[]
  onToggle: (d: string) => void
}) {
  // sem traçado: acumula as posições dos carros para desenhar a pista aos poucos
  const trail = useRef<Map<string, [number, number]>>(new Map())
  const outline = track?.outline ?? s.outline ?? null
  if (!outline) {
    for (const d of s.drivers) {
      if (d.x == null || d.y == null || trail.current.size > 6000) continue
      trail.current.set(`${Math.round(d.x / 15)},${Math.round(d.y / 15)}`, [d.x, d.y])
    }
  }
  const points = outline ?? [...trail.current.values()]
  const proj = useMemo(
    () => (points.length > 2 ? makeProjection({ rotation: track?.rotation ?? 0, outline: points } as Track) : null),
    // a projeção só muda quando o traçado muda (no modo "rastro", a cada ~50 pontos novos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outline, track?.rotation, outline ? 0 : Math.floor(points.length / 50)],
  )

  const r = proj ? proj.size * 0.012 : 0
  const cars = s.drivers
    .filter((d) => d.x != null && d.y != null && !d.retired)
    .sort((a, b) => Number(focus.includes(a.driver)) - Number(focus.includes(b.driver)))

  return (
    <Card
      title="Mapa"
      span={8}
      aside={
        s.trackStatus && <span className={`flag flag-${s.trackStatus}`}>{TRACK_STATUS_LABEL[s.trackStatus]}</span>
      }
    >
      {!proj ? (
        <p className="muted loading">Esperando as posições dos carros…</p>
      ) : (
        <svg viewBox={proj.viewBox} className="track-map" role="img" aria-label={`Traçado de ${s.session.circuit ?? ''}`}>
          {outline ? (
            <>
              <polygon
                points={outline.map(([x, y]) => proj.project(x, y).join(',')).join(' ')}
                className="track-outer"
                strokeWidth={proj.size * 0.024}
              />
              <polygon
                points={outline.map(([x, y]) => proj.project(x, y).join(',')).join(' ')}
                className="track-inner"
                strokeWidth={proj.size * 0.006}
              />
            </>
          ) : (
            points.map(([x, y], i) => {
              const [px, py] = proj.project(x, y)
              return <circle key={i} cx={px} cy={py} r={proj.size * 0.004} className="trail-dot" />
            })
          )}
          {cars.map((d) => {
            const [x, y] = proj.project(d.x!, d.y!)
            const on = focus.includes(d.driver)
            return (
              <g
                key={d.driver}
                className={`car live-car ${dimmed(focus, d.driver) ? 'dim' : ''}`}
                style={{ transform: `translate(${x}px, ${y}px)` }}
                onClick={() => onToggle(d.driver)}
              >
                <circle r={on ? r * 1.5 : r} fill={d.teamColor ?? '#888'} className={`car-dot ${on ? 'on' : ''}`} strokeWidth={r * 0.3} />
                {(on || (d.position != null && d.position <= 3)) && (
                  <text x={r * 2} y={-r * 1.4} className="car-label" fontSize={proj.size * 0.028}>
                    {d.driver}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {!outline && proj && <p className="foot">O traçado aparece depois que um carro completa uma volta limpa.</p>}
    </Card>
  )
}

// ---------- Torre ----------

function TowerRow({
  d,
  gapMode,
  focus,
  onToggle,
}: {
  d: LiveDriver
  gapMode: 'gap' | 'interval'
  focus: string[]
  onToggle: (d: string) => void
}) {
  const c = d.compound ? COMPOUND[d.compound] : null
  const out = d.retired || d.stopped
  const gap = d.position === 1 ? (formatLiveGap(d.gap) || 'Líder') : formatLiveGap(gapMode === 'gap' ? d.gap : d.interval)
  return (
    <li
      className={`${focus.includes(d.driver) ? 'focused' : ''} ${out || d.knockedOut ? 'out' : ''} ${dimmed(focus, d.driver) ? 'dim' : ''}`}
      onClick={() => onToggle(d.driver)}
    >
      <span className="t-pos">{d.position ?? ''}</span>
      <span className="team-bar" style={{ background: d.teamColor ?? 'var(--muted)' }} />
      <span className="t-driver">{d.driver}</span>
      {d.inPit && <span className="pit-tag">PIT</span>}
      {d.pitOut && !d.inPit && <span className="pit-tag out-tag">SAÍDA</span>}
      <span className="t-spacer" />
      <Timed t={d.lastLap} className="t-last" />
      {c && !out && (
        <span className="tyre-age" title={`${c.label}${d.tyreAge != null ? `, ${d.tyreAge} voltas` : ''}`}>
          <span className={`tyre ${c.className}`}>{c.letter}</span>
          <span className="muted">{d.tyreAge ?? ''}</span>
        </span>
      )}
      <span className="t-gap">{out ? (d.retired ? 'Abandono' : 'Parado') : gap}</span>
    </li>
  )
}

function Timed({ t, className }: { t: LiveTimed | null; className?: string }) {
  if (!t) return <span className={`mono muted ${className ?? ''}`}>—</span>
  return <span className={`mono ${t.best === 'overall' ? 'fastest' : t.best === 'personal' ? 'personal' : ''} ${className ?? ''}`}>{formatLapTime(t.time)}</span>
}

// ---------- Carros em foco ----------

function CarsCard({
  s,
  focus,
  lapLength,
  requestTraces,
}: {
  s: LiveSnapshot
  focus: string[]
  lapLength: number | null
  requestTraces: (drivers: string[]) => void
}) {
  const shown = focus.length
    ? focus.map((f) => s.drivers.find((d) => d.driver === f)).filter((d): d is LiveDriver => d != null)
    : s.drivers.slice(0, 2)
  const key = shown.map((d) => d.driver).join(',')
  useEffect(() => {
    requestTraces(key ? key.split(',') : [])
  }, [key, requestTraces])
  return (
    <Card title="Telemetria ao vivo" span={8} aside={<span className="muted">{focus.length ? 'pilotos em foco' : 'os dois primeiros; clique para escolher'}</span>}>
      <div className="cars">
        {shown.map((d) => (
          <div key={d.driver} className="car-panel" style={{ borderColor: d.teamColor ?? 'var(--border)' }}>
            <div className="car-head">
              <span className="team-bar" style={{ background: d.teamColor ?? 'var(--muted)' }} />
              <strong>{d.driver}</strong>
              <span className="muted">{d.team}</span>
              <span className="t-spacer" />
              <span className="car-pos">P{d.position ?? '—'}</span>
            </div>
            <div className="gauges">
              <div className="speed">
                <span className="big">{d.speed ?? '—'}</span>
                <span className="muted">km/h</span>
              </div>
              <div className="gear">
                <span className="big">{d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</span>
                <span className="muted">marcha</span>
              </div>
              <div className="bars">
                <Bar label="RPM" value={d.rpm} max={13000} className="rpm" text={d.rpm != null ? d.rpm.toLocaleString('pt-BR') : '—'} />
                <Bar label="Acelerador" value={d.throttle} max={100} className="throttle" text={d.throttle != null ? `${d.throttle}%` : '—'} />
                <Bar label="Freio" value={d.brake} max={100} className="brake" text={d.brake ? 'sim' : 'não'} />
              </div>
              <span className={`drs ${d.drs ? 'on' : ''}`}>DRS</span>
            </div>
            <div className="lap-times">
              <div>
                <span className="muted">Última</span>
                <Timed t={d.lastLap} />
              </div>
              <div>
                <span className="muted">Melhor</span>
                <Timed t={d.bestLap} />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <span className="muted">S{i + 1}</span>
                  <Timed t={d.sectors[i] ?? null} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <LapTraces s={s} drivers={shown} lapLength={lapLength} />
    </Card>
  )
}

// ---------- Gráficos da volta ao vivo ----------

const TRACE_W = 1000
const TRACE_CHARTS = [
  { key: 'speed', label: 'Velocidade (km/h)', h: 120, min: 0, max: 360, step: false, ticks: [100, 200, 300] },
  { key: 'throttle', label: 'Acelerador (%)', h: 56, min: 0, max: 100, step: false, ticks: [50] },
  { key: 'brake', label: 'Freio', h: 28, min: 0, max: 1, step: true, ticks: [] },
] as const

/** Volta atual (linha cheia) e a anterior (tracejada) dos pilotos mostrados, por distância. */
function LapTraces({ s, drivers, lapLength }: { s: LiveSnapshot; drivers: LiveDriver[]; lapLength: number | null }) {
  const traces = s.traces ?? {}
  const series = drivers.map((d, i) => {
    const raw = d.teamColor ?? '#888'
    const color = i === 1 && drivers[0] && similarColors(raw, drivers[0].teamColor ?? '#888') ? '#ececf0' : raw
    return { d, color, ...(traces[d.driver] ?? { current: null, previous: null }) }
  })
  const ends = series.flatMap((x) => [x.previous?.d.at(-1) ?? 0, x.current?.d.at(-1) ?? 0])
  const xMax = Math.max(lapLength ?? 0, ...ends, 1000)
  const hasData = series.some((x) => x.current || x.previous)

  if (!hasData) {
    return <p className="muted traces-empty">Os gráficos da volta aparecem depois que o piloto cruza a linha de chegada.</p>
  }
  return (
    <div className="lap-traces">
      <div className="traces-legend">
        {series.map((x) => (
          <span key={x.d.driver}>
            <i style={{ background: x.color }} />
            {x.d.driver} {x.current ? `volta ${x.current.lap}` : ''}
          </span>
        ))}
        <span className="muted">tracejado: volta anterior</span>
      </div>
      {TRACE_CHARTS.map((c) => (
        <div key={c.key} className="trace-chart">
          <span className="trace-label">{c.label}</span>
          <svg viewBox={`0 0 ${TRACE_W} ${c.h}`} preserveAspectRatio="none" style={{ height: c.h }} role="img" aria-label={c.label}>
            {c.ticks.map((v) => {
              const y = c.h - ((v - c.min) / (c.max - c.min)) * c.h
              return <line key={v} x1={0} x2={TRACE_W} y1={y} y2={y} className="trace-grid" />
            })}
            {series.map((x) =>
              x.previous ? (
                <path
                  key={`${x.d.driver}-prev`}
                  d={tracePath(x.previous.d, x.previous[c.key], xMax, c.min, c.max, TRACE_W, c.h, c.step)}
                  stroke={x.color}
                  className="trace-line prev"
                />
              ) : null,
            )}
            {series.map((x) =>
              x.current ? (
                <path
                  key={`${x.d.driver}-cur`}
                  d={tracePath(x.current.d, x.current[c.key], xMax, c.min, c.max, TRACE_W, c.h, c.step)}
                  stroke={x.color}
                  className="trace-line"
                />
              ) : null,
            )}
          </svg>
        </div>
      ))}
      <div className="trace-axis">
        {Array.from({ length: Math.floor(xMax / 1000) }, (_, i) => (i + 1) * 1000).map((m) => (
          <span key={m} style={{ left: `${(m / xMax) * 100}%` }}>
            {(m / 1000).toFixed(0)} km
          </span>
        ))}
      </div>
    </div>
  )
}

function Bar({ label, value, max, className, text }: { label: string; value: number | null; max: number; className: string; text: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={`bar ${className}`}>
      <span className="bar-label">
        {label} <b>{text}</b>
      </span>
      <span className="bar-track">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

function Weather({ s }: { s: LiveSnapshot }) {
  const w = s.weather
  if (!w) return null
  const items = [
    ['Ar', w.airTemp != null ? `${w.airTemp.toFixed(1)} °C` : '—'],
    ['Pista', w.trackTemp != null ? `${w.trackTemp.toFixed(1)} °C` : '—'],
    ['Umidade', w.humidity != null ? `${Math.round(w.humidity)}%` : '—'],
    ['Vento', w.windSpeed != null ? `${w.windSpeed.toFixed(1)} m/s` : '—'],
    ['Chuva', w.rainfall ? 'sim' : 'não'],
  ]
  return (
    <div className="weather">
      {items.map(([k, v]) => (
        <div key={k}>
          <span className="muted">{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}
