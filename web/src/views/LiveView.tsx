import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Card from '../components/Card'
import CarsCanvas, { type CanvasCar } from '../components/CarsCanvas'
import RaceControlFeed from '../components/RaceControlFeed'
import TraceCanvas from '../components/TraceCanvas'
import { loadTrack } from '../lib/data'
import { LapGaps, duelGap } from '../lib/duel'
import { dimmed, telemetryPair, toggleFocus } from '../lib/focus'
import {
  DELAY_OPTIONS,
  LIVE_URL,
  accountKind,
  formatExpiry,
  formatRemaining,
  loginUrl,
  sourceKey,
  useLiveFeed,
  type LiveStatus,
} from '../lib/live'
import { similarColors } from '../lib/telemetry'
import { TRACK_STATUS_LABEL, formatClock, makeProjection } from '../lib/replay'
import { liveDriverColors } from '../lib/liveDisplay'
import { Box, DominanceMap, DriverCard, DuelBox, LiveTower, WeatherBox } from '../panels/LivePanels'
import type { DataIndex, RaceControlMessage, Track, WeatherSample } from '../types/data'
import type { LiveAccount, LiveCatalog, LiveDriver, LiveScheduled, LiveSnapshot } from '../types/live'


// horários do feed (epoch UTC em s) na hora local
const localTime = (epoch: number, seconds: boolean) =>
  new Date(epoch * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
const messageTime = (m: RaceControlMessage) => localTime(m.time, true)
const SPEEDS = [1, 4, 16, 32]

const START_HELP = `cd live && source .venv/bin/activate
python server.py`

// mesmo texto de feed.TOKEN_MISSING: com a faixa "Conecte sua conta" na tela, o aviso de erro sobra
const TOKEN_MISSING_PREFIX = 'Conta F1 TV desconectada'

/** Relógio de parede (epoch em s), atualizado a cada `everyMs`: vencimento da conta. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** Página de login no backend; volta para este site (local ou publicado) ao terminar. */
const LOGIN_URL = loginUrl(LIVE_URL, typeof window !== 'undefined' ? window.location.origin : undefined)

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
  const [choosing, setChoosing] = useState(false)
  const { status, snapshot, send, requestTraces, catalog, requestCatalog } = useLiveFeed(delay)
  const now = useNow(30_000)
  const onToggle = useCallback((d: string) => setFocus((f) => toggleFocus(f, d)), [])
  const track = useExportedTrack(index, snapshot)
  // cores por piloto com identidade estável (o snapshot muda 4×/s; as cores, quase nunca):
  // assim o feed da direção de prova não redesenha a cada snapshot
  const colorKey = (snapshot?.drivers ?? []).map((d) => `${d.driver}:${d.teamColor ?? ''}:${d.team ?? ''}`).join(',')
  const teamColors = useMemo(
    () => new Map(colorKey ? colorKey.split(',').map((p) => p.split(':') as [string, string]).map(([d, c]) => [d, c || null]) : []),
    [colorKey],
  )
  // cor de cada piloto nos mapas (companheiro de equipe em tom claro); muda quase nunca
  const colors = useMemo(
    () =>
      liveDriverColors(
        colorKey ? colorKey.split(',').map((p) => { const [driver, teamColor, team] = p.split(':'); return { driver, teamColor: teamColor || null, team: team || null } }) : [],
      ),
    [colorKey],
  )

  // diferença de cada piloto para o líder em cada volta, para a tendência do duelo (zera ao trocar de sessão)
  const sessionKey = snapshot ? sourceKey(snapshot) : ''
  const lapGaps = useMemo(() => (sessionKey ? new LapGaps() : null), [sessionKey])
  useEffect(() => {
    if (snapshot && lapGaps) lapGaps.record(snapshot.drivers)
  }, [snapshot, lapGaps])

  if (!snapshot) return <Offline status={status} />

  const s = snapshot
  const hasSession = s.session.name != null
  const isRace = s.session.type === 'Race'
  const replay = s.source.mode === 'replay'
  const idle = s.source.mode === 'idle'
  const canChoose = s.source.canChoose ?? false
  const account = s.source.account
  const accountOff = account != null && accountKind(account, now) === 'off'
  const showChooser = canChoose && (choosing || idle)
  const choose = (path: string) => {
    send({ cmd: 'select', path })
    setChoosing(false)
  }

  // colunas laterais: os pilotos em foco, completados pelos dois primeiros da torre
  const [pairA, pairB] = telemetryPair(
    focus,
    [s.drivers[0]?.driver ?? null, s.drivers[1]?.driver ?? null],
    s.drivers.map((d) => d.driver),
  )
  const driverA = s.drivers.find((d) => d.driver === pairA) ?? null
  const driverB = s.drivers.find((d) => d.driver === pairB) ?? null
  const colorA = (driverA && colors.get(driverA.driver)) ?? '#8b8b97'
  const colorBRaw = (driverB && colors.get(driverB.driver)) ?? '#8b8b97'
  const colorB = driverA && driverB && similarColors(colorA, colorBRaw) ? '#ececf0' : colorBRaw

  const sessionBox = (
    <section className={`lv-box lv-ses ${hasSession ? '' : 'lv-solo'}`}>
      <span className="lv-kicker">
        {replay ? <span className="live-badge sim">Simulação</span> : <span className="live-badge">Ao vivo</span>}
        {hasSession ? (SESSION_NAME[s.session.name ?? ''] ?? s.session.name) : ''}
      </span>
      <h1>{s.session.meeting ?? (idle ? 'Escolha uma sessão' : 'Sem sessão no momento')}</h1>
      <p className="lv-sub">
        {hasSession
          ? [s.session.circuit, s.session.country, statusLabel(s.session.status)].filter(Boolean).join(' · ')
          : idle
            ? 'Nenhuma gravação ainda. Escolha abaixo uma sessão do arquivo da F1 para simular.'
            : 'O feed está conectado, mas nenhuma sessão está acontecendo agora.'}
      </p>
      {s.source.mode !== 'live' && s.source.nextLive && <NextLive next={s.source.nextLive} />}
      <div className="lv-ses-row">
        {isRace && s.lap.current != null ? (
          <div>
            <span className="lbl">Volta</span>
            <div className="lv-lap">
              {s.lap.current}
              <small>/{s.lap.total ?? '—'}</small>
            </div>
          </div>
        ) : (
          s.clock?.remaining != null && (
            <div>
              <span className="lbl">{s.clock.running ? 'Tempo restante' : 'Relógio parado'}</span>
              <div className="lv-lap">{formatClock(s.clock.remaining)}</div>
            </div>
          )
        )}
        <div className="lv-ses-meta">
          {s.trackStatus && <span className={`flag flag-${s.trackStatus}`}>{TRACK_STATUS_LABEL[s.trackStatus]}</span>}
          <label className="lv-delay">
            Atraso
            <select value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="Atraso para sincronizar com a TV">
              {DELAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'nenhum' : `${d} s`}
                </option>
              ))}
            </select>
          </label>
          {account && <AccountLine account={account} now={now} />}
        </div>
      </div>
    </section>
  )

  return (
    <section className="live">
      {s.source.error && !(accountOff && s.source.error.startsWith(TOKEN_MISSING_PREFIX)) && (
        <p className="notice error">{s.source.error}</p>
      )}
      {s.source.loading && <DownloadNotice loading={s.source.loading} />}
      {status !== 'open' && <p className="notice warn">Conexão com o backend perdida; reconectando…</p>}

{!hasSession && sessionBox}
      {accountOff && <AccountBanner />}

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
        <div key={sourceKey(s)} className="lv-grid">
          {sessionBox}
          <DriverCard d={driverA} slot="A" color={colorA} />
          <DriverCard d={driverB} slot="B" color={colorB} />
          <Box title="Torre de tempos" className="lv-tower-box" aside="clique para pôr em foco">
            <LiveTower drivers={s.drivers} focus={focus} pair={[pairA, pairB]} onToggle={onToggle} />
          </Box>
          <LiveMap s={s} track={track} focus={focus} onToggle={onToggle} colors={colors} />
          <DuelBox
            a={driverA}
            b={driverB}
            colors={[colorA, colorB]}
            gap={driverA && driverB ? duelGap(driverA, driverB) : null}
            series={driverA && driverB && lapGaps ? lapGaps.series(driverA, driverB) : []}
            isRace={isRace}
          />
          <WeatherBox w={s.weather} history={s.weatherHistory ?? NO_WEATHER} />
          <Box title="Telemetria da volta" className="lv-tel">
            <TracesRequest drivers={[driverA, driverB]} requestTraces={requestTraces} />
            <LapTraces
              traces={s.traces ?? NO_TRACES}
              drivers={[driverA, driverB].filter((d): d is LiveDriver => d != null)}
              colors={[colorA, colorB]}
              lapLength={track?.lapLength ?? null}
            />
          </Box>
          <Box title="Direção de prova" className="lv-rc" aside="sessão inteira">
            <RaceControlFeed
              messages={s.raceControl ?? []}
              count={null}
              formatTime={messageTime}
              focus={focus}
              onToggle={onToggle}
              teamColors={teamColors}
            />
          </Box>
        </div>
      )}
      <p className="foot">
        Feed oficial de live timing da F1 (não documentado; uso pessoal). Backend em {LIVE_URL}.
      </p>
    </section>
  )
}

/** Pede ao servidor a telemetria da volta dos pilotos das colunas. */
function TracesRequest({ drivers, requestTraces }: { drivers: (LiveDriver | null)[]; requestTraces: (d: string[]) => void }) {
  const key = drivers
    .filter((d): d is LiveDriver => d != null)
    .map((d) => d.driver)
    .join(',')
  useEffect(() => {
    requestTraces(key ? key.split(',') : [])
  }, [key, requestTraces])
  return null
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
            Com o backend ligado, entre com a sua conta F1 TV pelo botão que aparece nesta aba. Não precisa de mais nada no
            terminal.
          </p>
        </Card>
      </div>
    </section>
  )
}

// ---------- Conta F1 TV ----------

function LoginLink({ children, className }: { children: ReactNode; className?: string }) {
  if (!LOGIN_URL) return null
  return (
    <a className={className} href={LOGIN_URL} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** Estado da conta no bloco da sessão: conectada, vencendo (renovar) ou desconectada (entrar). */
function AccountLine({ account, now }: { account: LiveAccount; now: number }) {
  const kind = accountKind(account, now)
  const expires = account.expires ?? 0
  return (
    <span className={`lv-acct acct-${kind}`} title="Conta F1 TV do backend">
      <i className="acct-dot" aria-hidden="true" />
      F1 TV{' '}
      {kind === 'ok' ? (
        <span className="muted" title={`Conectada até ${formatExpiry(expires)}`}>
          até {formatExpiry(expires).split(' às')[0]}
        </span>
      ) : (
        <>
          {kind === 'expiring' ? `vence em ${formatRemaining(expires - now)}` : 'desconectada'}{' '}
          <LoginLink className="acct-link">{kind === 'expiring' ? 'Renovar ↗' : 'Entrar ↗'}</LoginLink>
        </>
      )}
    </span>
  )
}

function AccountBanner() {
  return (
    <div className="account-banner" role="status">
      <div>
        <b>Conecte sua conta F1 TV</b>
        <span>O ao vivo e o download de novas sessões precisam dela. As gravações que você já tem continuam funcionando.</span>
      </div>
      <LoginLink className="btn">
        Entrar com a F1 TV <span aria-hidden="true">↗</span>
      </LoginLink>
    </div>
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
  // pulo enviado e ainda não aplicado pelo servidor: a barra fica no ponto escolhido até ele chegar
  const [pending, setPending] = useState<{ value: number; generation: number } | null>(null)
  const generation = s.source.generation ?? 0
  const waiting = pending != null && pending.generation === generation
  const elapsed = s.source.elapsed ?? 0
  const duration = s.source.duration ?? 0
  const value = seek ?? (waiting ? pending.value : elapsed)
  const commit = () => {
    if (seek != null) {
      send({ cmd: 'seek', value: seek })
      setPending({ value: seek, generation })
    }
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
      <span className="clock" aria-busy={waiting}>
        {formatClock(value)} <span className="muted">/ {formatClock(duration)}</span>
        {waiting && <span className="muted"> · indo…</span>}
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
  colors,
}: {
  s: LiveSnapshot
  track: Track | null
  focus: string[]
  onToggle: (d: string) => void
  colors: Map<string, string>
}) {
  const [mode, setMode] = useState<'cars' | 'dominance'>('cars')
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
  const cars = useMemo<CanvasCar[]>(() => {
    if (!proj) return []
    return s.drivers
      .filter((d) => d.x != null && d.y != null && !d.retired)
      .sort((a, b) => Number(focus.includes(a.driver)) - Number(focus.includes(b.driver)))
      .map((d) => {
        const [x, y] = proj.project(d.x!, d.y!)
        const on = focus.includes(d.driver)
        return {
          id: d.driver,
          x,
          y,
          r,
          color: d.teamColor ?? '#888',
          focused: on,
          dim: dimmed(focus, d.driver),
          label: on || (d.position != null && d.position <= 3) ? d.driver : null,
        }
      })
  }, [s.drivers, focus, proj, r])
  const viewBox = useMemo(() => {
    if (!proj) return null
    const [x, y, w, h] = proj.viewBox.split(' ').map(Number)
    return { x, y, w, h }
  }, [proj])
  // pista (ou rastro) desenhada uma vez: não muda a cada snapshot
  const trackLayer = useMemo(() => {
    if (!proj) return null
    if (outline) {
      const pts = outline.map(([x, y]) => proj.project(x, y).join(',')).join(' ')
      return (
        <>
          <polygon points={pts} className="track-outer" strokeWidth={proj.size * 0.024} />
          <polygon points={pts} className="track-inner" strokeWidth={proj.size * 0.006} />
        </>
      )
    }
    return points.map(([x, y], i) => {
      const [px, py] = proj.project(x, y)
      return <circle key={i} cx={px} cy={py} r={proj.size * 0.004} className="trail-dot" />
    })
    // no modo rastro, redesenha a cada ~50 pontos novos (como a projeção)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, outline, outline ? 0 : Math.floor(points.length / 50)])

  return (
    <Box
      title={`Pista${s.session.circuit ? ` · ${s.session.circuit}` : ''}`}
      className="lv-map"
      aside={
        <>
          {s.trackStatus && mode === 'cars' && <span className={`flag flag-${s.trackStatus}`}>{TRACK_STATUS_LABEL[s.trackStatus]}</span>}
          <span className="seg" role="group" aria-label="O que o mapa mostra">
            <button className={mode === 'cars' ? 'active' : undefined} aria-pressed={mode === 'cars'} onClick={() => setMode('cars')}>
              Carros
            </button>
            <button className={mode === 'dominance' ? 'active' : undefined} aria-pressed={mode === 'dominance'} onClick={() => setMode('dominance')}>
              Domínio
            </button>
          </span>
        </>
      }
    >
      {!proj || !viewBox ? (
        <p className="muted loading">Esperando as posições dos carros…</p>
      ) : mode === 'dominance' ? (
        outline ? (
          <DominanceMap outline={outline} proj={proj} dominance={s.dominance ?? null} colors={colors} />
        ) : (
          <p className="muted loading">O domínio aparece quando o traçado da pista estiver pronto.</p>
        )
      ) : (
        <div className="track-wrap">
          <svg viewBox={proj.viewBox} className="track-map" role="img" aria-label={`Traçado de ${s.session.circuit ?? ''}`}>
            {trackLayer}
          </svg>
          <CarsCanvas viewBox={viewBox} cars={cars} labelSize={proj.size * 0.028} onPick={onToggle} snapDistance={proj.size * 0.15} />
        </div>
      )}
      {!outline && proj && mode === 'cars' && <p className="foot">O traçado aparece depois que um carro completa uma volta limpa.</p>}
    </Box>
  )
}

// ---------- Gráficos da volta ao vivo ----------

const NO_TRACES: LiveTraces = {}
const NO_WEATHER: WeatherSample[] = []
const TRACE_CHARTS = [
  { key: 'speed', label: 'Velocidade (km/h)', h: 104, min: 0, max: 360, step: false, ticks: [100, 200, 300] },
  { key: 'throttle', label: 'Acelerador (%)', h: 40, min: 0, max: 100, step: false, ticks: [50] },
  { key: 'brake', label: 'Freio', h: 18, min: 0, max: 1, step: true, ticks: [] },
] as const

type LiveTraces = NonNullable<LiveSnapshot['traces']>

/**
 * Volta atual (linha cheia) e a anterior (tracejada) dos pilotos mostrados, por distância.
 * `traces` só muda quando o servidor manda telemetria nova (1 vez por segundo): com o memo, os
 * gráficos não são refeitos nos outros snapshots.
 */
const LapTraces = memo(
  function LapTraces({ traces, drivers, colors, lapLength }: { traces: LiveTraces; drivers: LiveDriver[]; colors: string[]; lapLength: number | null }) {
    const lines = drivers.map((d, i) => ({ d, color: colors[i] ?? '#888', ...(traces[d.driver] ?? { current: null, previous: null }) }))
    const ends = lines.flatMap((x) => [x.previous?.d.at(-1) ?? 0, x.current?.d.at(-1) ?? 0])
    const xMax = Math.max(lapLength ?? 0, ...ends, 1000)
    const hasData = lines.some((x) => x.current || x.previous)

    if (!hasData) {
      return <p className="muted traces-empty">Os gráficos da volta aparecem depois que o piloto cruza a linha de chegada.</p>
    }
    return (
      <div className="lap-traces">
        <div className="traces-legend">
          {lines.map((x) => (
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
            <TraceCanvas
              label={c.label}
              height={c.h}
              min={c.min}
              max={c.max}
              step={c.step}
              ticks={c.ticks}
              xMax={xMax}
              series={[
                ...lines.flatMap((x) =>
                  x.previous ? [{ key: `${x.d.driver}-prev`, color: x.color, d: x.previous.d, values: x.previous[c.key], previous: true }] : [],
                ),
                ...lines.flatMap((x) =>
                  x.current
                    ? [{ key: `${x.d.driver}-cur`, color: x.color, d: x.current.d, values: x.current[c.key], previous: false, lap: x.current.lap }]
                    : [],
                ),
              ]}
            />
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
  },
  // os objetos dos pilotos mudam a cada snapshot; aqui só importam quem é e a cor
  (a, b) =>
    a.traces === b.traces &&
    a.lapLength === b.lapLength &&
    a.colors.join() === b.colors.join() &&
    a.drivers.map((d) => `${d.driver}:${d.teamColor}`).join() === b.drivers.map((d) => `${d.driver}:${d.teamColor}`).join(),
)
