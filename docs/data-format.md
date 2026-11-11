# Formato dos dados (`data/`)

Gerados por `pipeline/export_session.py` (sessões) e `pipeline/export_standings.py` (calendário e classificação) e lidos pelo frontend (`web/`). Os tipos TypeScript equivalentes estão em `web/src/types/data.ts`. **Mudou algo aqui? Atualize os dois.**

Versão atual do esquema: **1** (campo `schemaVersion` de `meta.json`, `calendar.json` e `standings.json`).

## Convenções

- Tempos em **segundos (float)**, com 3 casas decimais. Distância em **metros**, velocidade em **km/h**.
- Pilotos pela **abreviação de 3 letras** (`VER`, `HAM`).
- Chaves JSON em `camelCase`. Valor ausente vira `null`, nunca `NaN`.
- JSON compacto (sem indentação), em UTF-8.

## Estrutura

```
data/
├── index.json                      # temporadas e sessões exportadas
└── {ano}/
    ├── calendar.json               # calendário da temporada (Jolpica)
    ├── standings.json              # classificação de pilotos e construtores (Jolpica)
    └── {rodada}-{local}/{sessao}/  # dados de uma sessão (FastF1)
        ├── meta.json
        ├── results.json
        └── laps.json
```

- `{rodada}-{local}`: rodada com 2 dígitos + local do GP sem acento, ex.: `16-monza`, `21-sao-paulo`. A rodada evita colisão quando o mesmo circuito recebe duas provas no ano (ex.: 2020).
- `{sessao}`: `FP1`, `FP2`, `FP3`, `SQ` (sprint quali/shootout), `S` (sprint), `Q`, `R`.

## `index.json`

Recriado a cada export a partir dos `standings.json` e `meta.json` existentes. Temporadas ordenadas por ano; sessões por ano, rodada e sessão.

```json
{
  "seasons": [{"year": 2026, "afterRound": 20, "totalRounds": 23}],
  "sessions": [{"path": "2024/16-monza/R", "year": 2024, "round": 16, "eventName": "Italian Grand Prix", "session": "R", "sessionName": "Race"}]
}
```

- `afterRound`: última rodada contabilizada na classificação.
- `totalRounds`: rodadas no calendário (`null` se não houver `calendar.json`).
- Para ligar uma rodada do calendário às sessões exportadas, use `year` + `round` (não o nome da pasta: o local do FastF1 e do Jolpica podem diferir).

## `{ano}/calendar.json`

```json
{"schemaVersion": 1, "year": 2026, "generatedAt": "...", "rounds": [ ... ]}
```

Cada item de `rounds`:

| Campo | Tipo | Descrição |
|---|---|---|
| `round` | int | Rodada |
| `eventName` | string | Ex.: `Chinese Grand Prix` |
| `circuitId`, `circuitName` | string | Identificador e nome do circuito no Jolpica |
| `locality`, `country` | string | Cidade e país |
| `lat`, `lon` | float \| null | Coordenadas do circuito |
| `sprint` | bool | Fim de semana com sprint |
| `sessions` | array | `{code, start}` em ordem cronológica. `code` usa os mesmos códigos das pastas de sessão. `start` é ISO 8601 em UTC (`2026-03-15T07:00:00Z`), só a data (`2026-03-15`) quando o horário não é conhecido, ou `null` |

## `{ano}/standings.json`

```json
{"schemaVersion": 1, "year": 2026, "afterRound": 20, "generatedAt": "...", "drivers": [ ... ], "constructors": [ ... ]}
```

`drivers`:

| Campo | Tipo | Descrição |
|---|---|---|
| `position` | int \| null | Posição no campeonato (`null` se não classificado) |
| `driver` | string | Abreviação (`ANT`) |
| `number` | string \| null | Número permanente |
| `givenName`, `familyName` | string | Nome e sobrenome |
| `nationality` | string \| null | Nacionalidade (em inglês, como no Jolpica) |
| `teams` | string[] | Equipes na temporada, a última é a atual |
| `teamColor` | string \| null | Cor oficial da equipe atual, `#rrggbb` |
| `points` | float | Pontos |
| `wins` | int | Vitórias |

`constructors`:

| Campo | Tipo | Descrição |
|---|---|---|
| `position` | int \| null | Posição no campeonato |
| `constructorId` | string | Identificador no Jolpica (`red_bull`) |
| `team` | string | Nome da equipe |
| `nationality` | string \| null | Nacionalidade |
| `teamColor` | string \| null | Cor oficial, `#rrggbb` |
| `points` | float | Pontos |
| `wins` | int | Vitórias |

As cores vêm do arquivo de constantes do FastF1 (`fastf1/plotting/constants.json`, temporadas 2018+). Equipes que o Jolpica nomeia diferente do FastF1 estão em `TEAM_ALIASES` em `export_standings.py`.

## `{ano}/{rodada}-{local}/{sessao}/meta.json`

| Campo | Tipo | Descrição |
|---|---|---|
| `schemaVersion` | int | Versão deste formato |
| `year`, `round` | int | Temporada e rodada |
| `slug` | string | `{rodada}-{local}` |
| `eventName` | string | Ex.: `Italian Grand Prix` |
| `country`, `location` | string | País e cidade/circuito |
| `session` | string | Código curto (`R`, `Q`…) |
| `sessionName` | string | Nome no FastF1 (`Race`, `Qualifying`…) |
| `sessionDate` | string \| null | Início da sessão (ISO 8601) |
| `generatedAt` | string | Data do export (ISO 8601, UTC) |
| `fastf1Version` | string | Versão do FastF1 usada |

## `results.json`

Uma linha por piloto.

| Campo | Tipo | Descrição |
|---|---|---|
| `driver` | string | Abreviação (`VER`) |
| `number` | string \| null | Número do carro |
| `fullName` | string \| null | Nome completo |
| `team` | string \| null | Equipe |
| `teamColor` | string \| null | Cor da equipe, `#rrggbb` |
| `position` | int \| null | Posição final |
| `classifiedPosition` | string \| null | `"1"`…`"20"` ou `R` (abandono), `D` (desclassificado), `E`, `W`, `F`, `N` |
| `gridPosition` | int \| null | Largada; `0` = pit lane |
| `status` | string \| null | Ex.: `Finished`, `+1 Lap`, `Retired` |
| `points` | float \| null | Pontos na sessão |

## `laps.json`

Uma linha por volta de cada piloto.

| Campo | Tipo | Descrição |
|---|---|---|
| `driver` | string | Abreviação |
| `lap` | int \| null | Número da volta |
| `lapTime` | float \| null | Tempo da volta (s); `null` quando não registrado (ex.: volta 1 ou com bandeira vermelha) |
| `sector1`, `sector2`, `sector3` | float \| null | Tempos de setor (s) |
| `position` | int \| null | Posição ao fim da volta |
| `compound` | string \| null | `SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET` |
| `stint` | int \| null | Número do stint |
| `tyreLife` | int \| null | Voltas no jogo de pneus |
| `pitIn`, `pitOut` | bool | Entrou ou saiu dos boxes nesta volta |

## Próximos (fases 2–3)

`telemetry/{DRV}.json.gz` (por piloto, com downsampling de ~4–10 Hz) e posições X/Y para o mapa ainda não são exportados.
