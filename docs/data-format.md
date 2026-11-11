# Formato dos dados (`data/`)

Gerados por `pipeline/export_session.py` e lidos pelo frontend (`web/`). Os tipos TypeScript equivalentes estão em `web/src/types/data.ts`. **Mudou algo aqui? Atualize os dois.**

Versão atual do esquema: **1** (campo `schemaVersion` do `meta.json`).

## Convenções

- Tempos em **segundos (float)**, com 3 casas decimais. Distância em **metros**, velocidade em **km/h**.
- Pilotos pela **abreviação de 3 letras** (`VER`, `HAM`).
- Chaves JSON em `camelCase`. Valor ausente vira `null`, nunca `NaN`.
- JSON compacto (sem indentação), em UTF-8.

## Estrutura

```
data/
├── index.json                      # lista de sessões exportadas
└── {ano}/{rodada}-{local}/{sessao}/
    ├── meta.json
    ├── results.json
    └── laps.json
```

- `{rodada}-{local}`: rodada com 2 dígitos + local do GP sem acento, ex.: `16-monza`, `21-sao-paulo`. A rodada evita colisão quando o mesmo circuito recebe duas provas no ano (ex.: 2020).
- `{sessao}`: `FP1`, `FP2`, `FP3`, `SQ` (sprint quali/shootout), `S` (sprint), `Q`, `R`.

## `index.json`

Recriado a cada export a partir de todos os `meta.json`. Ordenado por ano, rodada e sessão.

```json
[{"path": "2024/16-monza/R", "year": 2024, "round": 16, "eventName": "Italian Grand Prix", "session": "R", "sessionName": "Race"}]
```

## `meta.json`

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
