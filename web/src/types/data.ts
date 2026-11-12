// Tipos dos arquivos em data/. Mantenha em sincronia com docs/data-format.md.
// Tempos em segundos, distâncias em metros, velocidade em km/h.

/** Código curto da sessão: FP1, FP2, FP3, SQ, S, Q, R */
export type SessionCode = 'FP1' | 'FP2' | 'FP3' | 'SQ' | 'S' | 'Q' | 'R' | (string & {})

/** data/index.json */
export interface DataIndex {
  seasons: SeasonIndexEntry[]
  sessions: SessionIndexEntry[]
}

export interface SeasonIndexEntry {
  year: number
  afterRound: number // última rodada contabilizada na classificação
  totalRounds: number | null
}

export interface SessionIndexEntry {
  path: string // ex.: "2024/16-monza/R"
  year: number
  round: number
  eventName: string
  session: SessionCode
  sessionName: string
}

/** data/{ano}/calendar.json */
export interface Calendar {
  schemaVersion: number
  year: number
  generatedAt: string
  rounds: CalendarRound[]
}

export interface CalendarRound {
  round: number
  eventName: string
  circuitId: string
  circuitName: string
  locality: string
  country: string
  lat: number | null
  lon: number | null
  sprint: boolean
  sessions: CalendarSession[]
}

export interface CalendarSession {
  code: SessionCode
  /** ISO 8601 em UTC ("2026-03-15T07:00:00Z"), só a data ("2026-03-15") ou null */
  start: string | null
}

/** data/{ano}/standings.json */
export interface Standings {
  schemaVersion: number
  year: number
  afterRound: number
  generatedAt: string
  drivers: DriverStanding[]
  constructors: ConstructorStanding[]
  /** Vencedor de cada corrida já disputada. */
  winners?: RoundWinner[]
  /** Pódio e pole de cada rodada já disputada. */
  rounds?: RoundResult[]
  /** Pontos acumulados (corridas + sprints) após cada rodada, por piloto. */
  history?: { rounds: number[]; points: Record<string, number[]> }
}

export interface DriverStanding {
  position: number | null
  driver: string
  number: string | null
  givenName: string
  familyName: string
  nationality: string | null
  teams: string[] // a última é a equipe atual
  teamColor: string | null
  points: number
  wins: number
  podiums?: number
  poles?: number
  /** Últimas 5 corridas, da mais antiga para a mais recente; null = não classificado. */
  form?: (number | null)[]
}

export interface RoundWinner {
  round: number
  driver: string
  team: string | null
  teamColor: string | null
}

export interface RoundDriver {
  driver: string
  team: string | null
  teamColor: string | null
}

export interface RoundResult {
  round: number
  podium: RoundDriver[] // 1º, 2º e 3º classificados (pode ter menos)
  pole: RoundDriver | null
}

/** data/{ano}/outlines.json: traçado simplificado de cada rodada (para o calendário). */
export interface Outlines {
  schemaVersion: number
  year: number
  size: number // os pontos vão de 0 a size, já girados como o mapa
  outlines: Record<string, [number, number][]> // chave: número da rodada
}

export interface ConstructorStanding {
  position: number | null
  constructorId: string
  team: string
  nationality: string | null
  teamColor: string | null
  points: number
  wins: number
  /** Pontos marcados por cada piloto por esta equipe (corridas + sprints). */
  drivers?: { driver: string; points: number }[]
}

/** data/{ano}/{rodada}-{local}/{sessao}/meta.json */
export interface SessionMeta {
  schemaVersion: number
  year: number
  round: number
  slug: string
  eventName: string
  country: string
  location: string
  session: SessionCode
  sessionName: string
  sessionDate: string | null
  generatedAt: string
  fastf1Version: string
  replay: ReplayInfo | null
  telemetry: string[] // pilotos com telemetry/{DRV}.json.gz
}

/** Janela do replay em segundos de sessão (SessionTime) */
export interface ReplayInfo {
  start: number
  end: number
  hz: number
  drivers: string[]
}

/** Uma linha de results.json */
export interface DriverResult {
  driver: string // abreviação de 3 letras, ex.: "VER"
  number: string | null
  fullName: string | null
  team: string | null
  teamColor: string | null // "#rrggbb"
  position: number | null
  classifiedPosition: string | null // "1".."20", "R" (abandono), "D", "E", "W", "F", "N"
  gridPosition: number | null // 0 = largou do pit lane
  status: string | null
  points: number | null
  // melhores tempos em Q1/Q2/Q3 (SQ1/SQ2/SQ3 na sprint quali); null fora da classificação
  q1: number | null
  q2: number | null
  q3: number | null
}

/** Uma linha de laps.json */
export interface Lap {
  driver: string
  lap: number | null
  lapTime: number | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  position: number | null
  compound: string | null
  stint: number | null
  tyreLife: number | null
  freshTyre: boolean | null // pneu novo no início do stint
  trackStatus: string | null // códigos de status da pista na volta, ex.: "1", "4" (SC), "671"
  pitIn: boolean
  pitOut: boolean
  // segundos de sessão, mesma base do replay
  startTime: number | null
  endTime: number | null
  pitInTime: number | null
  pitOutTime: number | null
  personalBest: boolean
  deleted: boolean | null // volta anulada (limite de pista etc.)
  speedTrap: number | null // km/h no speed trap
  segment: number | null // 1/2/3 em Q e SQ
}

/** track.json — coordenadas em metros */
export interface Track {
  rotation: number // graus
  lapLength: number
  referenceLap: { driver: string; lap: number }
  outline: [number, number][]
  corners: Corner[]
}

export interface Corner {
  number: number
  letter: string | null
  x: number
  y: number
  angle: number
  distance: number
}

export type TrackStatusCode = 'green' | 'yellow' | 'sc' | 'red' | 'vsc' | 'vsc_ending' | 'unknown'

/** Uma linha de track_status.json */
export interface TrackStatusChange {
  time: number // segundos de sessão
  status: TrackStatusCode
  code: string
  message: string | null
}

/** Uma linha de weather.json (~1 amostra por minuto). No modo ao vivo, `time` é epoch UTC (s). */
export interface WeatherSample {
  time: number // segundos de sessão
  airTemp: number | null // °C
  trackTemp: number | null // °C
  humidity: number | null // %
  pressure: number | null // mbar
  rainfall: boolean
  windSpeed: number | null // m/s
  windDirection: number | null // graus, de onde o vento vem (0 = norte)
}

/** Uma linha de race_control.json. No modo ao vivo, `time` é epoch UTC (s). */
export interface RaceControlMessage {
  time: number // segundos de sessão
  lap: number | null
  category: string | null // Flag, SafetyCar, Drs, CarEvent, Other
  flag: string | null // GREEN, YELLOW, DOUBLE YELLOW, RED, BLUE, CLEAR, CHEQUERED, BLACK AND WHITE...
  scope: string | null // Track, Sector, Driver
  sector: number | null // setor de bandeira (marshal sector)
  driver: string | null // sigla do piloto citado
  status: string | null // DEPLOYED, ENDING, IN THIS LAP... (safety car e DRS)
  message: string
}

/** positions/{DRV}.json.gz — amostra i no tempo start + i / hz */
export interface DriverPositions {
  driver: string
  start: number
  hz: number
  x: (number | null)[]
  y: (number | null)[]
}

/** telemetry/{DRV}.json.gz */
export interface DriverTelemetry {
  driver: string
  laps: LapTelemetry[]
}

/** Amostras originais do carro numa volta; todas as listas têm o mesmo tamanho */
export interface LapTelemetry {
  lap: number
  lapTime: number | null
  compound: string | null
  d: number[] // distância desde o início da volta (m)
  t: number[] // tempo desde o início da volta (s)
  speed: number[] // km/h
  throttle: number[] // 0–100
  brake: number[] // 0/1
  gear: number[] // 0–8
  drs: number[] // 0/1
}
