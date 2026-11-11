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

Temporadas inteiras (calendário, classificação e todas as corridas já disputadas, pulando as já exportadas): `python export_season.py 2024 2025 2026`. Use `--sessions R S Q` para incluir sprints e classificações e `--force` para reexportar. A primeira passagem demora (cada corrida baixa ~100 MB para o cache do FastF1, em `pipeline/cache/`); hoje o site versiona só as corridas de 2026 (~2 MB cada). Os dados de 2024 (inclusive o fim de semana completo de Monza usado nas fases 0–5) saíram da versão atual, mas continuam no histórico do git.

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

### 4.5 Modo ao vivo (fase 6)
```bash
cd live
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python server.py                 # modo automático (deixe rodando)
```
Com o backend rodando e o `npm run dev` aberto, use a aba **Ao vivo** do site. O backend só escuta em `127.0.0.1:8000`.

- **Modo automático (padrão):** no horário de cada sessão do fim de semana de GP (de 15 min antes até 1 h depois do fim previsto), o site mostra o **ao vivo**, sem escolha, e o feed é gravado em `live/recordings/`. Os horários vêm de `data/{ano}/calendar.json`: mantenha o calendário exportado (`python export_standings.py 2026` no pipeline). Fora das sessões, o site simula uma gravação e o botão **Trocar sessão** lista as sessões de qualquer ano desde 2018: as já baixadas abrem na hora; as outras (marcadas com ↓) o servidor baixa do arquivo da F1 (~1 min) e guarda em `live/recordings/`.
- `python server.py live` força o ao vivo; `python server.py replay [ARQUIVO] [--speed 4] [--start 00:50:00]` só simula (sem ligar o ao vivo sozinho).

- **Login:** usa o mesmo token F1 TV do pipeline (o do FastF1). Ele vence em poucos dias: antes do GP, rode um export qualquer do pipeline para renovar o login. O backend nunca lê nem grava usuário e senha.
- **Simulação:** pausa, velocidade e linha do tempo na própria página. Para baixar uma sessão pelo terminal: `python record_archive.py 2026 20 R`.
- **Gravações** ficam em `live/recordings/` (fora do git): são dados do feed oficial, só para uso pessoal.
- Todo acesso ao live timing está em `live/feed.py`. Se o feed mudar, o ajuste fica ali.

### 4.4 Git
```bash
git init
printf "pipeline/cache/\npipeline/.venv/\nnode_modules/\n" > .gitignore
```

## 5. Roadmap

- [x] **Fase 0 — Setup:** repositório, venv, Vite rodando, primeiro export de uma corrida
- [x] **Fase 1 — Standings e calendário:** tabelas de pilotos e equipes (Jolpica). `python export_standings.py 2026` gera `calendar.json` e `standings.json`; o site tem as abas Classificação, Calendário e Sessões
- [x] **Fase 2 — Mapa da pista:** traçado a partir de X/Y de uma volta rápida; replay com slider de tempo. Pronto para corridas e sprints: `export_session.py` gera `track.json`, `track_status.json` e `positions/{DRV}.json.gz` (~40 KB por piloto); aba "Mapa e replay" na sessão
- [x] **Fase 3 — Telemetria:** comparar duas voltas (velocidade, acelerador, freio, marcha, DRS) alinhadas por distância. `export_session.py` gera `telemetry/{DRV}.json.gz` (amostras originais, até ~130 KB por piloto); aba "Telemetria" com gráficos uPlot sincronizados, delta, setores e mini-mapa
- [x] **Fase 4 — Corrida:** posições por volta, estratégia de pneus (stints), pit stops, gaps. Aba "Corrida" com destaques, posições volta a volta, estratégia de pneus, diferença para o líder e tabela de pit stops; testes do front com Vitest
- [x] **Fase 5 — Treinos e classificação:** setores, melhores voltas, evolução por sessão. Resultados com Q1/Q2/Q3 e cortes; treinos ordenados pela melhor volta; aba "Voltas e setores" com volta ideal, speed trap e evolução da sessão (faixas de Q1/Q2/Q3). Monza 2024 foi exportado completo para o desenvolvimento; hoje o site traz só as corridas de 2026
- [x] **Redesign — painel único da sessão:** as abas da sessão viraram uma página só, em cartões (tema escuro de "pit wall", fonte Titillium Web). Na corrida: mapa e replay, torre, telemetria, resultado, posições, estratégia, gaps e pit stops; na classificação e nos treinos: telemetria, resultado, setores e evolução. Clicar num piloto o põe em foco em todos os cartões (até dois, que são os comparados na telemetria), e a volta do replay aparece como cursor nos gráficos. Componentes em `web/src/panels/`
- [x] **Redesign — Classificação:** destaque com a situação do título (decidido ou não, pontos ainda em jogo), próxima corrida, top 3 em cartões, tabela de pilotos com a forma recente, pódios e diferença para o líder, construtores com os pontos de cada piloto, evolução dos pontos rodada a rodada (com sprints) e vencedor de cada rodada. As estatísticas saem do `export_standings.py`.
- [x] **Fase 6 — Ao vivo:** LiveF1 → FastAPI → WebSocket. Backend local em `live/` (veja a seção 4.5) e aba "Ao vivo" no site: mapa com os carros, torre (líder ou intervalo, pneu e idade, última volta), telemetria dos pilotos em foco (velocidade, marcha, RPM, acelerador, freio, DRS, setores e gráficos da volta atual e da anterior por distância), direção de prova e clima. Atraso ajustável para sincronizar com a TV. Fora do fim de semana de GP, simula a partir de uma gravação (feed bruto de uma sessão passada). Modo automático: o ao vivo entra sozinho no horário das sessões; fora delas, o site escolhe qualquer sessão desde 2018 (baixada do arquivo da F1 na hora).

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
