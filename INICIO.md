# F1 Interactive Race Visualization — Guia de Início

Projeto pessoal, **100% gratuito**, para visualizar corridas, treinos e classificações de Fórmula 1 com telemetria, mapa da pista, standings de pilotos e equipes, e (opcionalmente) dados ao vivo.

---

## 1. Decisões já tomadas

| Tema | Decisão | Por quê |
|---|---|---|
| Dados históricos | **FastF1** (Python) + conta **F1 TV** | Maduro, cache embutido, telemetria e posição X/Y por volta. Desde 2026 o arquivo de live timing exige login F1 TV (ver seção 7) |
| Classificações e calendário | **Jolpica-F1** (via FastF1 `Ergast` ou HTTP direto) | Sucessor do Ergast, gratuito |
| Dados ao vivo | **LiveF1** (Python, MIT) | Assina o feed de live timing da F1; sem API paga |
| Frontend | **Vite + React + TypeScript** | Gera site estático, hospedável de graça |
| Gráficos | **D3** (mapa da pista) + **uPlot** ou Recharts (telemetria) | uPlot lida bem com séries densas |
| Hospedagem | **GitHub Pages** ou **Vercel** (plano gratuito) | Replay não precisa de servidor |

> Alternativas (Next.js, OpenF1) são possíveis. Se mudar a stack, atualize esta tabela.

## 2. Arquitetura

```
 FastF1 / Jolpica ──► scripts Python (export) ──► data/*.json.gz | *.parquet
                                                        │
                                                        ▼
                                           Frontend estático (Vite)
                                                        ▲
 LiveF1 ──► backend local FastAPI ──► WebSocket (só no modo ao vivo)
```

- **Replay (fases 1–5):** tudo pré-processado em arquivos estáticos. Zero custo de servidor.
- **Ao vivo (fase 6):** exige um processo rodando durante o GP. Rodar na própria máquina.

## 3. Estrutura do repositório

```
f1-viz/
├── INICIO.md
├── CLAUDE.md                # contexto curto para o Claude Code (opcional)
├── .claude/agents/          # subagents do projeto
├── pipeline/                # Python: coleta e exportação
│   ├── export_session.py
│   ├── export_standings.py
│   ├── requirements.txt
│   └── cache/               # cache do FastF1 (no .gitignore)
├── data/                    # saída dos scripts, consumida pelo front
│   └── {ano}/{gp}/{sessao}/
├── web/                     # Vite + React + TS
│   └── src/
├── live/                    # backend ao vivo (fase 6)
└── docs/
```

## 4. Setup inicial

### 4.1 Pré-requisitos
- Python 3.10+ e Node 20+
- Git

### 4.2 Pipeline (Python)
```bash
mkdir -p f1-viz/pipeline && cd f1-viz/pipeline
python -m venv .venv
# Windows: .venv\Scripts\activate    |  macOS/Linux: source .venv/bin/activate
pip install fastf1 pandas pyarrow
pip freeze > requirements.txt
```

Script de partida (`pipeline/export_session.py`):

```python
import json
import sys
from pathlib import Path

import fastf1

fastf1.Cache.enable_cache("cache")  # crie a pasta cache/ antes se necessário


def export_session(year: int, gp: str, ident: str, out_root: str = "../data"):
    session = fastf1.get_session(year, gp, ident)
    session.load(telemetry=True, weather=True, messages=False)

    out = Path(out_root) / str(year) / gp.lower().replace(" ", "-") / ident
    out.mkdir(parents=True, exist_ok=True)

    # Resultados
    results = session.results[["DriverNumber", "Abbreviation", "TeamName",
                               "Position", "GridPosition", "Points"]]
    results.to_json(out / "results.json", orient="records")

    # Voltas (timedeltas -> segundos)
    laps = session.laps[["Driver", "LapNumber", "LapTime", "Sector1Time",
                         "Sector2Time", "Sector3Time", "Compound",
                         "Stint", "TyreLife"]].copy()
    for col in ["LapTime", "Sector1Time", "Sector2Time", "Sector3Time"]:
        laps[col] = laps[col].dt.total_seconds()
    laps.to_json(out / "laps.json", orient="records")

    print(f"OK: {out}")


if __name__ == "__main__":
    export_session(int(sys.argv[1]), sys.argv[2], sys.argv[3])
```

Teste: `python export_session.py 2024 Monza R`

Calendário e classificação de uma temporada (Jolpica, sem login): `python export_standings.py 2026`

> A primeira execução baixa muitos dados e é lenta. Depois, o cache acelera.

> **Versão atual do script:** o código acima é só o ponto de partida. O script real em `pipeline/export_session.py` também grava `meta.json` e `data/index.json`, usa a pasta `{rodada}-{local}` (ex.: `2024/16-monza/R`) e converte `NaN` em `null`. O formato completo está em `docs/data-format.md`.

> **Login F1 TV:** na primeira execução o FastF1 pede o e-mail e a senha da conta F1 TV no terminal. Rode o script você mesmo num terminal interativo para isso. O token fica em `~/Library/Application Support/fastf1/f1auth_token.json` (fora do repositório) e é reutilizado até expirar. Depois disso é preciso entrar de novo. Nunca coloque `F1_USERNAME` ou `F1_PASSWORD` em arquivos versionados.

### 4.3 Frontend
```bash
cd .. && npm create vite@latest web -- --template react-ts
cd web && npm install
npm install d3 uplot
npm run dev
```

### 4.4 Git
```bash
git init
printf "pipeline/cache/\npipeline/.venv/\nnode_modules/\n" > .gitignore
```

## 5. Roadmap

- [x] **Fase 0 — Setup:** repositório, venv, Vite rodando, primeiro export de uma corrida
- [x] **Fase 1 — Standings e calendário:** tabelas de pilotos e equipes (Jolpica). `python export_standings.py 2026` gera `calendar.json` e `standings.json`; o site tem as abas Classificação, Calendário e Sessões
- [x] **Fase 2 — Mapa da pista:** traçado a partir de X/Y de uma volta rápida; replay com slider de tempo. Pronto para corridas e sprints: `export_session.py` gera `track.json`, `track_status.json` e `positions/{DRV}.json.gz` (~40 KB por piloto); aba "Mapa e replay" na sessão
- [ ] **Fase 3 — Telemetria:** comparar duas voltas (velocidade, acelerador, freio, marcha, DRS) alinhadas por distância
- [ ] **Fase 4 — Corrida:** posições por volta, estratégia de pneus (stints), pit stops, gaps
- [ ] **Fase 5 — Treinos e classificação:** setores, melhores voltas, evolução por sessão
- [ ] **Fase 6 — Ao vivo:** LiveF1 → FastAPI → WebSocket

Cada fase deve terminar com algo **visível e funcionando** no navegador.

## 6. Convenções de dados

- Tempos sempre em **segundos (float)**; distância em **metros**; velocidade em **km/h**.
- Pilotos identificados pela **abreviação de 3 letras** (ex.: `VER`, `HAM`).
- Um arquivo por sessão e tipo de dado (`results.json`, `laps.json`, `telemetry/{DRV}.json.gz`).
- **Telemetria é pesada:** exporte por piloto, faça downsampling (ex.: ~4–10 Hz para o replay) e comprima (gzip) ou use Parquet.
- Inclua um `meta.json` por sessão com ano, GP, tipo, data de geração e versão do FastF1.

## 7. Riscos e cuidados

- **FastF1 depende de assinatura F1 TV:** desde 2026 o `livetiming.formula1.com/static` responde 401 sem login e o mirror do FastF1 está fora do ar. O projeto usa a assinatura pessoal do dono. Se ela acabar, as alternativas gratuitas testadas são o **OpenF1** (histórico sem login: voltas, stints, pits, telemetria e X/Y) e o **Jolpica** (resultados e standings).
- **Feed de live timing não é documentado:** pode mudar ou quebrar sem aviso. Use apenas para projeto pessoal e não comercial; se o projeto crescer, revise os termos da F1.
- **Tamanho dos dados:** exportar a temporada inteira pode gerar GBs. Comece com 1–2 corridas e escale.
- **Dados ausentes:** algumas sessões têm telemetria incompleta. O front deve tolerar lacunas.
- **Limites de taxa:** o Jolpica tem rate limit. Use o cache do FastF1 e evite repetir requisições.

## 8. Agents do projeto (`.claude/agents/`)

| Agent | Quando usar |
|---|---|
| `f1-planner` | Quebrar fases em tarefas, priorizar, manter o roadmap |
| `f1-data-engineer` | Scripts de exportação, cache, formato e tamanho dos dados |
| `f1-viz-frontend` | Componentes React, mapa da pista, gráficos de telemetria |
| `f1-live-stream` | Modo ao vivo (LiveF1, FastAPI, WebSocket) |
| `f1-qa-reviewer` | Revisão de código, validação dos dados, testes |
| `f1-devops` | Deploy, GitHub Actions, automação da exportação |

Exemplo de uso no Claude Code: *"Use o f1-data-engineer para exportar a telemetria do GP de Monza 2024 e o f1-viz-frontend para plotar a comparação de duas voltas."*

## 9. Checklist do primeiro dia

1. [x] Criar o repositório e a estrutura de pastas
2. [x] Copiar `.claude/agents/` para dentro do repositório
3. [x] Configurar venv e instalar `fastf1`
4. [x] Rodar `export_session.py` para uma corrida
5. [x] Subir o Vite e listar os resultados do JSON na tela
6. [x] Commit inicial
