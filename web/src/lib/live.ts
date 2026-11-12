import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveCatalog, LiveSnapshot } from '../types/live'

/** Endereço do backend local. Pode ser trocado com VITE_LIVE_URL no .env.local do web/. */
export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ?? 'ws://127.0.0.1:8000/ws'

const RECONNECT_MS = 2000

/**
 * Guarda os snapshots recebidos para mostrá-los com atraso (sincronizar com a TV,
 * que costuma vir alguns segundos atrás do feed).
 */
export class DelayBuffer<T> {
  private items: { at: number; value: T }[] = []
  private keepMs: number

  constructor(keepMs = 125_000) {
    this.keepMs = keepMs
  }

  push(value: T, at: number): void {
    this.items.push({ at, value })
    const cutoff = at - this.keepMs
    let drop = 0
    while (drop < this.items.length - 1 && this.items[drop].at < cutoff) drop++
    if (drop) this.items.splice(0, drop)
  }

  /** Último valor recebido até `now - delayMs` (ou o mais antigo, se o atraso ainda não encheu). */
  at(now: number, delayMs: number): T | null {
    if (this.items.length === 0) return null
    const target = now - delayMs
    let found: T | null = null
    for (const item of this.items) {
      if (item.at > target) break
      found = item.value
    }
    return found ?? this.items[0].value
  }

  clear(): void {
    this.items = []
  }
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

/** Identifica o que está passando (ao vivo ou qual gravação); quando muda, o histórico do atraso é descartado. */
export function sourceKey(snap: LiveSnapshot): string {
  return `${snap.source.mode}:${snap.source.selected ?? ''}`
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
  const buffer = useRef(new DelayBuffer<LiveSnapshot>())
  const sticky = useRef<StickyFields>(emptySticky())
  const socket = useRef<WebSocket | null>(null)
  const delayRef = useRef(delayS)
  const traceDrivers = useRef<string[]>([])

  useEffect(() => {
    delayRef.current = delayS
  }, [delayS])

  useEffect(() => {
    let closed = false
    let retry = 0
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
          const key = sourceKey(snap)
          if (key !== lastKey.current) {
            // trocou de sessão: o atraso não deve mostrar a anterior
            buffer.current.clear()
            lastKey.current = key
          }
          buffer.current.push(withSticky(snap, sticky.current), Date.now())
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
    // mostra o snapshot do momento (com atraso) 4 vezes por segundo
    const tick = window.setInterval(() => {
      setSnapshot(buffer.current.at(Date.now(), delayRef.current * 1000))
    }, 250)
    return () => {
      closed = true
      window.clearTimeout(retry)
      window.clearInterval(tick)
      socket.current?.close()
    }
  }, [])

  const send = (cmd: Record<string, unknown>) => {
    if (cmd.cmd === 'seek') buffer.current.clear()
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
