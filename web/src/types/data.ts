// Tipos dos arquivos em data/. Mantenha em sincronia com docs/data-format.md.
// Tempos em segundos, distâncias em metros, velocidade em km/h.

/** Código curto da sessão: FP1, FP2, FP3, SQ, S, Q, R */
export type SessionCode = 'FP1' | 'FP2' | 'FP3' | 'SQ' | 'S' | 'Q' | 'R' | (string & {})

/** data/index.json */
export interface SessionIndexEntry {
  path: string // ex.: "2024/16-monza/R"
  year: number
  round: number
  eventName: string
  session: SessionCode
  sessionName: string
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
  pitIn: boolean
  pitOut: boolean
}
