import { useMemo, useState } from 'react'
import { RC_KINDS, DEFAULT_RC_KINDS, countByKind, flagClass, visibleMessages, type RcKind } from '../lib/raceControl'
import type { RaceControlMessage } from '../types/data'

interface Props {
  messages: RaceControlMessage[]
  /** Só mostra mensagens até este instante (replay). null = todas. */
  now: number | null
  /** Rótulo de horário de cada mensagem (relógio da prova no replay, hora local no ao vivo). */
  formatTime: (m: RaceControlMessage) => string
  /** Clique numa mensagem (o replay pula para o instante dela). */
  onPick?: (m: RaceControlMessage) => void
  focus: string[]
  onToggle: (driver: string) => void
  teamColors: ReadonlyMap<string, string | null>
}

/** Feed completo da direção de prova, com filtros por tipo e o piloto citado clicável. */
export default function RaceControlFeed({ messages, now, formatTime, onPick, focus, onToggle, teamColors }: Props) {
  const [kinds, setKinds] = useState<ReadonlySet<RcKind>>(DEFAULT_RC_KINDS)
  const counts = useMemo(() => countByKind(messages, now), [messages, now])
  const shown = useMemo(() => visibleMessages(messages, now, kinds), [messages, now, kinds])

  const toggle = (kind: RcKind) =>
    setKinds((cur) => {
      const next = new Set(cur)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  return (
    <>
      <div className="rc-filters" role="group" aria-label="Tipos de mensagem">
        {RC_KINDS.filter((k) => counts[k.kind] > 0 || kinds.has(k.kind)).map((k) => (
          <button
            key={k.kind}
            className={`chip ${kinds.has(k.kind) ? 'on' : ''}`}
            aria-pressed={kinds.has(k.kind)}
            onClick={() => toggle(k.kind)}
          >
            {k.label} <span className="muted">{counts[k.kind]}</span>
          </button>
        ))}
      </div>
      <ol className="rc-list" aria-live="polite">
        {shown.length === 0 && (
          <li className="muted">{messages.length === 0 ? 'Nenhuma mensagem ainda.' : 'Nenhuma mensagem com estes filtros.'}</li>
        )}
        {shown.map((m, i) => {
          const about = m.driver != null && focus.includes(m.driver)
          return (
            <li
              key={`${m.time}-${m.message}`}
              className={`${i === 0 && now != null ? 'latest' : ''} ${about ? 'focused' : ''} ${onPick ? 'pickable' : ''}`}
              onClick={onPick ? () => onPick(m) : undefined}
              title={onPick ? 'Ir para este momento do replay' : undefined}
            >
              <span className="rc-meta">
                {formatTime(m)}
                {m.lap ? ` · V${m.lap}` : ''}
              </span>
              {m.flag && <span className={`rc-flag ${flagClass(m.flag)}`}>{m.flag}</span>}
              {m.status && !m.flag && <span className="rc-flag">{m.status}</span>}
              {m.driver && (
                <button
                  className={`rc-driver ${about ? 'on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(m.driver!)
                  }}
                  title="Pôr o piloto em foco"
                >
                  <i style={{ background: teamColors.get(m.driver) ?? 'var(--muted)' }} />
                  {m.driver}
                </button>
              )}
              <span className="rc-text">{m.message}</span>
            </li>
          )
        })}
      </ol>
    </>
  )
}
