import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveAccount, LiveCatalog, LiveSnapshot } from '../types/live'

/** Endereço do backend local. Pode ser trocado com VITE_LIVE_URL no .env.local do web/. */
export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ?? 'ws://127.0.0.1:8000/ws'

const RECONNECT_MS = 2000

// ---------- Conta F1 TV ----------

/** Com menos que isto até vencer, a aba Ao vivo sugere renovar o login. */
export const EXPIRING_SOON_S = 24 * 3600

export type AccountKind = 'ok' | 'expiring' | 'off'

export function accountKind(account: LiveAccount, nowSec: number): AccountKind {
  if (!account.connected || account.expires == null || account.expires <= nowSec) return 'off'
  return account.expires - nowSec < EXPIRING_SOON_S ? 'expiring' : 'ok'
}

/** Tempo até vencer, curto: "5 h", "40 min". */
export function formatRemaining(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h`
  return `${Math.max(1, Math.floor(seconds / 60))} min`
}

/** "20/11 às 21:14" no fuso de quem vê. */
export function formatExpiry(epochSec: number): string {
  const d = new Date(epochSec * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} às ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * Página de login servida pelo backend (mesmo endereço do WebSocket, em http).
 * `from` é a origem do site, para o botão "Voltar ao apexView" da página.
 */
export function loginUrl(liveUrl: string, from?: string): string | null {
  try {
    const url = new URL(liveUrl)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/login'
    url.search = from ? `?from=${encodeURIComponent(from)}` : ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/** Atrasos oferecidos na aba Ao vivo (s), para sincronizar com a TV. */
export const DELAY_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60] as const
/** Folga além do atraso: o que fica guardado por inteiro e o que sobra no histórico. */
export const DELAY_MARGIN_MS = 5000
/** Histórico guardado: o maior atraso mais a folga (trocar o atraso não esvazia a tela). */
const KEEP_MS = Math.max(...DELAY_OPTIONS) * 1000 + DELAY_MARGIN_MS

/**
 * Guarda os snapshots recebidos para mostrá-los com atraso (sincronizar com a TV,
 * que costuma vir alguns segundos atrás do feed).
 *
 * Guarda `keepMs` de histórico, mas só os últimos `atraso + DELAY_MARGIN_MS` por inteiro: os mais
 * antigos passam por `lighten` (no ao vivo, perdem a telemetria da volta, a parte pesada), porque
 * só voltam à tela se o atraso aumentar.
 */
export class DelayBuffer<T> {
  private items: { at: number; value: T; light: boolean }[] = []
  private keepMs: number
  private lighten: ((value: T) => T) | null

  constructor(keepMs = KEEP_MS, lighten: ((value: T) => T) | null = null) {
    this.keepMs = keepMs
    this.lighten = lighten
  }

  push(value: T, at: number, delayMs = 0): void {
    this.items.push({ at, value, light: false })
    const cutoff = at - this.keepMs
    let drop = 0
    while (drop < this.items.length - 1 && this.items[drop].at < cutoff) drop++
    if (drop) this.items.splice(0, drop)
    if (this.lighten) {
      // de trás para frente: para no primeiro já aliviado (os anteriores também estão)
      const heavyFrom = at - delayMs - DELAY_MARGIN_MS
      for (let i = this.items.length - 1; i >= 0; i--) {
        const item = this.items[i]
        if (item.at >= heavyFrom) continue
        if (item.light) break
        item.value = this.lighten(item.value)
        item.light = true
      }
    }
  }

  /** Último valor recebido até `now - delayMs` (ou o mais antigo, se o atraso ainda não encheu). */
  at(now: number, delayMs: number): T | null {
    if (this.items.length === 0) return null
    const target = now - delayMs
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].at <= target) return this.items[i].value
    }
    return this.items[0].value
  }

  /**
   * Quando (no relógio de `now`) o próximo valor deve aparecer com este atraso; null se o mais
   * novo já está na tela. Serve para mostrar cada snapshot no seu instante, sem relógio fixo.
   */
  nextAt(now: number, delayMs: number): number | null {
    const target = now - delayMs
    for (const item of this.items) {
      if (item.at > target) return item.at + delayMs
    }
    return null
  }

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items = []
  }
}

/** Snapshot sem a telemetria da volta, para o histórico do atraso. */
export function withoutTraces(snap: LiveSnapshot): LiveSnapshot {
  if (snap.traces === undefined) return snap
  const { traces: _traces, ...rest } = snap
  return rest
}

/** Campos que o servidor só manda quando mudam. */
const STICKY_KEYS = ['outline', 'raceControl', 'weatherHistory'] as const
export type StickyFields = Required<Pick<LiveSnapshot, (typeof STICKY_KEYS)[number]>>
export const emptySticky = (): StickyFields => ({ outline: null, raceControl: [], weatherHistory: [] })

/**
 * Completa um snapshot com os últimos valores recebidos dos campos que só vêm quando mudam
 * (traçado, mensagens da direção de prova, histórico do clima) e guarda os que vieram em `last`.
 */
export function withSticky(snap: LiveSnapshot, last: StickyFields): LiveSnapshot {
  const out = { ...snap }
  for (const key of STICKY_KEYS) {
    if (key in snap && snap[key] !== undefined) (last as Record<string, unknown>)[key] = snap[key]
    ;(out as Record<string, unknown>)[key] = last[key]
  }
  return out
}

/** "+1.234" -> "+1.234"; "LAP 34" -> "Volta 34"; "1 L" -> "+1 V". */
export function formatLiveGap(text: string | null): string {
  if (!text) return ''
  const lap = /^LAP (\d+)$/i.exec(text)
  if (lap) return `Volta ${lap[1]}`
  const lapped = /^(\d+) LAPS?$|^(\d+) L$/i.exec(text)
  if (lapped) return `+${lapped[1] ?? lapped[2]} V`
  return text
}

/** Caminho SVG de um canal ao longo da volta (x = distância, y invertido para o SVG). */
export function tracePath(
  d: number[],
  values: number[],
  xMax: number,
  yMin: number,
  yMax: number,
  width: number,
  height: number,
  step = false,
): string {
  const X = (v: number) => (Math.min(v, xMax) / xMax) * width
  const Y = (v: number) => height - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * height
  let path = ''
  for (let i = 0; i < d.length; i++) {
    const x = X(d[i]).toFixed(1)
    const y = Y(values[i]).toFixed(1)
    if (i === 0) path = `M${x},${y}`
    else path += step ? `H${x}V${y}` : `L${x},${y}`
  }
  return path
}

/** Identifica o que está passando (ao vivo ou qual gravação): trocou, os cartões recomeçam. */
export function sourceKey(snap: LiveSnapshot): string {
  return `${snap.source.mode}:${snap.source.selected ?? ''}`
}

/**
 * Como `sourceKey`, mais o pulo na gravação (`generation`). Quando muda, o histórico guardado
 * para o atraso é descartado: só nessa hora, com o novo instante já em mãos, e não no clique
 * (senão a tela fica sem snapshot até o servidor terminar o pulo).
 */
export function bufferKey(snap: LiveSnapshot): string {
  return `${sourceKey(snap)}:${snap.source.generation ?? 0}`
}

export type LiveStatus = 'connecting' | 'open' | 'closed'

/**
 * Conecta ao backend e reconecta sozinho. Devolve o snapshot a mostrar (com atraso),
 * o estado da conexão e uma função para mandar comandos (controles da simulação).
 */
export function useLiveFeed(delayS: number) {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [catalog, setCatalog] = useState<LiveCatalog | null>(null)
  const lastKey = useRef<string | null>(null)
  const buffer = useRef(new DelayBuffer<LiveSnapshot>(undefined, withoutTraces))
  const reschedule = useRef<() => void>(() => undefined)
  const sticky = useRef<StickyFields>(emptySticky())
  const socket = useRef<WebSocket | null>(null)
  const delayRef = useRef(delayS)
  const traceDrivers = useRef<string[]>([])

  useEffect(() => {
    delayRef.current = delayS
    reschedule.current() // mudou o atraso: mostra já o instante certo e reagenda o próximo
  }, [delayS])

  useEffect(() => {
    let closed = false
    let retry = 0
    // Cada snapshot aparece no seu instante (chegada + atraso). Sem atraso, na hora em que chega.
    // Um relógio fixo de 250 ms contra envios de ~250–270 ms repetia um snapshot e pulava o seguinte,
    // e os carros paravam meio segundo no mapa.
    let timer = 0
    const show = () => {
      timer = 0
      const now = Date.now()
      const delayMs = delayRef.current * 1000
      setSnapshot(buffer.current.at(now, delayMs))
      const next = buffer.current.nextAt(now, delayMs)
      if (next != null) timer = window.setTimeout(show, Math.max(0, next - now))
    }
    const restart = () => {
      window.clearTimeout(timer)
      show()
    }
    reschedule.current = restart
    const connect = () => {
      setStatus('connecting')
      const ws = new WebSocket(LIVE_URL)
      socket.current = ws
      ws.onopen = () => {
        setStatus('open')
        if (traceDrivers.current.length) ws.send(JSON.stringify({ cmd: 'traces', drivers: traceDrivers.current }))
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as LiveSnapshot | LiveCatalog
          if (msg.type === 'catalog') {
            setCatalog(msg)
            return
          }
          const snap = msg
          const key = bufferKey(snap)
          const changed = key !== lastKey.current
          if (changed) {
            // trocou de sessão ou pulou na gravação: o atraso não deve mostrar o instante anterior
            buffer.current.clear()
            lastKey.current = key
          }
          buffer.current.push(withSticky(snap, sticky.current), Date.now(), delayRef.current * 1000)
          if (changed) restart()
          else if (!timer) show()
        } catch {
          // mensagem inválida: ignora
        }
      }
      ws.onclose = () => {
        // só limpa se ainda for o socket atual (um socket antigo pode fechar depois do novo abrir)
        if (socket.current === ws) socket.current = null
        if (closed) return
        setStatus('closed')
        retry = window.setTimeout(connect, RECONNECT_MS)
      }
    }
    connect()
    return () => {
      closed = true
      reschedule.current = () => undefined
      window.clearTimeout(retry)
      window.clearTimeout(timer)
      socket.current?.close()
    }
  }, [])

  const send = (cmd: Record<string, unknown>) => {
    socket.current?.send(JSON.stringify(cmd))
  }

  /** Pilotos cujos traços de volta o servidor deve mandar (telemetria ao vivo). */
  const requestTraces = useCallback((drivers: string[]) => {
    traceDrivers.current = drivers
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ cmd: 'traces', drivers }))
    }
  }, [])

  /** Pede a lista de sessões de um ano (chega em `catalog`). */
  const requestCatalog = useCallback((year: number | null) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ cmd: 'catalog', year }))
    }
  }, [])

  return { status, snapshot, send, requestTraces, catalog, requestCatalog }
}
