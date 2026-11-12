// Snapshot do modo ao vivo, enviado pelo backend local (live/server.py) por WebSocket.
// Formato documentado em docs/data-format.md ("Modo ao vivo").

import type { RaceControlMessage, WeatherSample } from './data'

export type LiveTrackStatus = 'green' | 'yellow' | 'sc' | 'red' | 'vsc' | 'vsc_ending' | 'unknown'

export interface LiveTimed {
  time: number // segundos
  best: 'overall' | 'personal' | null // roxo (melhor da sessão) ou verde (melhor do piloto)
}

export interface LiveDriver {
  driver: string // sigla de 3 letras
  number: string
  fullName: string | null
  team: string | null
  teamColor: string | null
  position: number | null
  line: number | null
  gap: string | null // texto do feed: "+1.234", "1 L", "LAP 34"
  interval: string | null
  lastLap: LiveTimed | null
  bestLap: LiveTimed | null
  sectors: (LiveTimed | null)[]
  laps: number | null
  pits: number | null
  inPit: boolean
  pitOut: boolean
  retired: boolean
  stopped: boolean
  knockedOut: boolean
  compound: string | null
  tyreAge: number | null
  newTyre: boolean | null
  x: number | null // metros
  y: number | null
  speed: number | null // km/h
  rpm: number | null
  gear: number | null
  throttle: number | null // %
  brake: number | null // 0 ou 100
  drs: boolean
}

/** Sessão do calendário (modo automático). */
export interface LiveScheduled {
  label: string // "Las Vegas Grand Prix · Treino 1"
  event: string
  code: string // FP1, Q, R...
  start: string // ISO UTC
}

export interface LiveSource {
  mode: 'live' | 'replay' | 'idle'
  error: string | null
  auto?: boolean // o servidor liga o ao vivo sozinho no horário das sessões
  canChoose?: boolean // fora do ao vivo, o site pode escolher a sessão
  selected?: string | null // sessão em simulação (caminho no arquivo da F1)
  loading?: { path: string; label: string; done: number; total: number } | null // baixando do arquivo
  liveSession?: LiveScheduled | null
  nextLive?: LiveScheduled | null
  recording?: string | null
  speed?: number
  paused?: boolean
  elapsed?: number // s desde o início da gravação
  duration?: number
}

/** Canais de uma volta por distância (m desde a linha de chegada), amostras do carro (~4 Hz). */
export interface LiveTrace {
  lap: number
  d: number[]
  speed: number[] // km/h
  throttle: number[] // %
  brake: number[] // 1/0
}

export interface LiveSnapshot {
  type: 'snapshot'
  time: number // epoch UTC (s) do feed
  session: {
    meeting: string | null
    location: string | null
    country: string | null
    circuit: string | null
    name: string | null
    type: string | null
    start: string | null
    status: string | null
  }
  lap: { current: number | null; total: number | null }
  clock: { remaining: number | null; running: boolean } | null
  trackStatus: LiveTrackStatus | null
  weather: Omit<WeatherSample, 'time'> | null
  /** Amostras de clima da sessão (time = epoch UTC). Ausente = igual ao último recebido. */
  weatherHistory?: WeatherSample[]
  drivers: LiveDriver[]
  /** Todas as mensagens da direção de prova, em ordem (time = epoch UTC). Ausente = igual ao último recebido. */
  raceControl?: RaceControlMessage[]
  /** Traçado (metros). Ausente = igual ao último recebido; null = ainda não montado. */
  outline?: [number, number][] | null
  source: LiveSource
  /** Só para os pilotos pedidos com {"cmd": "traces"}: volta atual (até o instante mostrado) e a anterior. */
  traces?: Record<string, { current: LiveTrace | null; previous: LiveTrace | null }>
}

/** Sessões que dá para simular, resposta a {"cmd": "catalog", "year": ...}. */
export interface LiveCatalogSession {
  name: string | null // "Race", "Qualifying", "Practice 1"...
  type: string | null
  path: string
  start: string | null // ISO UTC
  recorded: boolean // já baixada em live/recordings/
}

export interface LiveMeeting {
  number: number | null
  name: string | null
  location: string | null
  country: string | null
  sessions: LiveCatalogSession[]
}

export interface LiveCatalog {
  type: 'catalog'
  year: number
  years: number[]
  meetings: LiveMeeting[]
  error: string | null
}
