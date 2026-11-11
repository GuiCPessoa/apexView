// Snapshot do modo ao vivo, enviado pelo backend local (live/server.py) por WebSocket.
// Formato documentado em docs/data-format.md ("Modo ao vivo").

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

export interface LiveRaceControl {
  utc: string | null
  lap: number | null
  category: string | null
  flag: string | null
  message: string | null
}

export interface LiveSource {
  mode: 'live' | 'replay' | 'idle'
  error: string | null
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
  weather: {
    airTemp: number | null
    trackTemp: number | null
    humidity: number | null
    rainfall: boolean
    windSpeed: number | null
  } | null
  drivers: LiveDriver[]
  raceControl: LiveRaceControl[]
  /** Traçado (metros). Ausente = igual ao último recebido; null = ainda não montado. */
  outline?: [number, number][] | null
  source: LiveSource
  /** Só para os pilotos pedidos com {"cmd": "traces"}: volta atual (até o instante mostrado) e a anterior. */
  traces?: Record<string, { current: LiveTrace | null; previous: LiveTrace | null }>
}
