# F1 Interactive Race Visualization

Projeto pessoal e **gratuito** de visualização de corridas, treinos e classificações de Fórmula 1: telemetria, mapa da pista, standings de pilotos e equipes e, opcionalmente, dados ao vivo.

Leia `INICIO.md` para o guia completo (arquitetura, setup, roadmap e riscos).

## Stack
- **Pipeline:** Python 3.10+ com FastF1 e Jolpica-F1 (`pipeline/`)
- **Frontend:** Vite + React + TypeScript, D3 (mapa da pista) e uPlot (telemetria) (`web/`)
- **Ao vivo (fase 6):** LiveF1 + FastAPI + WebSocket (`live/`)
- **Hospedagem:** site estático no GitHub Pages ou Vercel (planos gratuitos)

## Estrutura
- `pipeline/` coleta e exporta os dados; `pipeline/cache/` é o cache do FastF1 (ignorado no git)
- `data/{ano}/{gp}/{sessao}/` saída dos scripts, consumida pelo frontend
- `web/` frontend; `live/` backend ao vivo; `docs/` documentação (incluindo `docs/data-format.md`)

## Convenções
- Tempos em **segundos (float)**, distância em **metros**, velocidade em **km/h**.
- Pilotos identificados pela **abreviação de 3 letras** (`VER`, `HAM`).
- Um arquivo por sessão e tipo de dado: `results.json`, `laps.json`, `meta.json`, `telemetry/{DRV}.json.gz`.
- Todo `meta.json` traz ano, GP, tipo de sessão, data de geração e versão do FastF1.
- Telemetria é pesada: exportar por piloto, com downsampling (~4–10 Hz) e compressão.
- Mudou o formato dos dados? Atualize `docs/data-format.md` e os tipos em `web/src/types/`.

## Comandos
- Pipeline: `cd pipeline && source .venv/bin/activate` (Windows: `.venv\Scripts\activate`), depois `python export_session.py 2024 Monza R` (sessão, exige login F1 TV) ou `python export_standings.py 2026` (calendário e classificação)
- Frontend: `cd web && npm install && npm run dev`
- Testes do pipeline: `cd pipeline && pytest`

## Regras do projeto
- Manter tudo **gratuito**. Avise antes de propor qualquer serviço pago.
- O feed de live timing não é documentado e pode mudar sem aviso. Uso apenas pessoal e não comercial. Isole o acesso ao LiveF1 em um único módulo.
- Respeite o rate limit do Jolpica e use sempre o cache do FastF1.
- Comece com 1–2 corridas antes de exportar uma temporada inteira.
- Cada fase do roadmap termina com algo **visível e funcionando no navegador**.
- Não faça push, force push, deploy ou publique dados sem confirmação do usuário.
- Nunca versione segredos, `pipeline/cache/`, `.venv/` ou `node_modules/`.
- Idioma: responda e documente em **português do Brasil**; nomes de código em inglês.

## Agents (`.claude/agents/`)
- `f1-planner`: quebra fases em tarefas e mantém o roadmap
- `f1-data-engineer`: scripts de exportação e formato dos dados
- `f1-viz-frontend`: componentes React, mapa da pista e gráficos
- `f1-live-stream`: modo ao vivo (LiveF1, FastAPI, WebSocket)
- `f1-qa-reviewer`: revisão de código, validação de dados e testes
- `f1-devops`: deploy gratuito e GitHub Actions
