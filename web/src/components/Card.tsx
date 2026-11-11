import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Texto ou controles à direita do título. */
  aside?: ReactNode
  /** Colunas ocupadas na grade de 12 (no celular tudo vira uma coluna). */
  span: 4 | 6 | 8 | 12
  id?: string
  className?: string
  children: ReactNode
}

/** Cartão do painel da sessão. */
export default function Card({ title, aside, span, id, className, children }: Props) {
  return (
    <section id={id} className={`card span-${span} ${className ?? ''}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {aside && <div className="card-aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}
