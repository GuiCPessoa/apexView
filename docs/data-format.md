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
        ├── laps.json
        ├── track.json              # traçado da pista
        ├── telemetry/{DRV}.json.gz # telemetria de cada volta, por piloto
        ├── track_status.json       # bandeiras e safety car (só R e S)
        └── positions/{DRV}.json.gz # posições X/Y para o replay (só R e S)
```

**Base de tempo das sessões:** `startTime`, `endTime`, `pitInTime`, `pitOutTime`, `track_status.json` e o replay usam **segundos desde o início da sessão** (o `SessionTime` do FastF1). Isso permite cruzar voltas, bandeiras e posições sem conversão.

**Coordenadas:** X/Y em **metros**, no sistema do live timing da F1 (eixo Y para cima). Para desenhar na orientação oficial, gire os pontos por `track.json.rotation` graus e inverta o Y para a tela.

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
| `replay` | object \| null | `null` quando a sessão não tem replay (hoje só `R` e `S` têm) |
| `replay.start`, `replay.end` | float | Janela do replay em segundos de sessão: da largada (início da volta 1) a 60 s depois do último carro fechar a volta |
| `replay.hz` | int | Amostras por segundo das posições (4) |
| `replay.drivers` | string[] | Pilotos com arquivo em `positions/` |
| `telemetry` | string[] | Pilotos com arquivo em `telemetry/` (vazio se não houver) |

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
| `q1`, `q2`, `q3` | float \| null | Melhor tempo (s) em Q1/Q2/Q3 (SQ1/SQ2/SQ3 na sprint quali). `null` fora da classificação ou quando o piloto não passou de fase |

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
| `freshTyre` | bool \| null | O jogo era novo quando o stint começou |
| `trackStatus` | string \| null | Códigos de status da pista que ocorreram na volta, concatenados (ex.: `"1"`, `"4"` = safety car, `"671"` = VSC). Mesmos códigos de `track_status.json` |
| `pitIn`, `pitOut` | bool | Entrou ou saiu dos boxes nesta volta |
| `startTime`, `endTime` | float \| null | Início e fim da volta, em segundos de sessão |
| `pitInTime`, `pitOutTime` | float \| null | Entrada e saída dos boxes, em segundos de sessão |
| `personalBest` | bool | Melhor volta pessoal até aquele momento |
| `deleted` | bool \| null | Volta anulada (limite de pista etc.), segundo as mensagens da direção de prova. `null` se a informação não existir |
| `speedTrap` | int \| null | Velocidade no speed trap (km/h) |
| `segment` | int \| null | Segmento da classificação: 1, 2 ou 3 (Q e SQ). `null` nas outras sessões |

> Na volta de saída dos boxes, `startTime` costuma ser o fim da volta anterior (de antes de o carro ficar parado na garagem). Para saber quando o carro voltou à pista, use `pitOutTime`.

## `track.json`

Traçado tirado da volta mais rápida da sessão, com um ponto a cada 10 m. Exportado para toda sessão (o replay e a telemetria usam).

| Campo | Tipo | Descrição |
|---|---|---|
| `rotation` | float | Rotação (graus) para a orientação oficial do mapa. `0` se as informações do circuito não estiverem disponíveis |
| `lapLength` | float | Comprimento da volta de referência (m) |
| `referenceLap` | object | `{driver, lap}` da volta usada |
| `outline` | `[x, y][]` | Pontos do traçado em metros. O primeiro ponto fica na linha de chegada |
| `corners` | array | Curvas: `{number, letter, x, y, angle, distance}`. `angle` posiciona o rótulo; `distance` é em metros desde a linha. Pode vir vazio |

## `track_status.json`

Mudanças de estado da pista, em ordem. O estado vale até a próxima mudança.

```json
[{"time": 792.826, "status": "green", "code": "1", "message": "AllClear"}]
```

| `status` | `code` | Significado |
|---|---|---|
| `green` | 1 | Pista livre |
| `yellow` | 2 | Bandeira amarela |
| `sc` | 4 | Safety car |
| `red` | 5 | Bandeira vermelha |
| `vsc` | 6 | Safety car virtual |
| `vsc_ending` | 7 | Fim do safety car virtual |

## `positions/{DRV}.json.gz`

Um arquivo por piloto, em JSON comprimido com gzip (o front descomprime com `DecompressionStream`).

```json
{"driver": "LEC", "start": 3350.494, "hz": 4, "x": [812, 805, ...], "y": [-203, -190, ...]}
```

- A amostra `i` corresponde ao tempo de sessão `start + i / hz`. Todos os pilotos usam a mesma grade (`meta.replay`).
- `x`, `y` são inteiros em metros. `null` quando não há dado real a menos de 3 s (carro na garagem, abandono, falha de transmissão).
- Monza 2024 (corrida, 77 min): cerca de 40 KB por piloto, 842 KB no total.

## `telemetry/{DRV}.json.gz`

Um arquivo por piloto com todas as voltas que têm dados do carro, em JSON comprimido com gzip. São as **amostras originais** do carro (~4 Hz, ~300 por volta em Monza), sem reamostragem. Para comparar duas voltas, o front interpola as duas numa mesma grade de distância.

```json
{"driver": "LEC", "laps": [{"lap": 33, "lapTime": 83.226, "compound": "HARD",
  "d": [9.3, 41.3, ...], "t": [0.0, 0.36, ...], "speed": [331, 333, ...],
  "throttle": [100, ...], "brake": [0, ...], "gear": [8, ...], "drs": [1, ...]}]}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `lap` | int | Número da volta |
| `lapTime` | float \| null | Tempo oficial da volta (s) |
| `compound` | string \| null | Composto do pneu |
| `d` | float[] | Distância desde o início da volta (m), crescente |
| `t` | float[] | Tempo desde o início da volta (s) |
| `speed` | int[] | Velocidade (km/h) |
| `throttle` | int[] | Acelerador, 0–100 % (o feed às vezes manda >100; limitado a 100) |
| `brake` | int[] | Freio acionado: 1/0 |
| `gear` | int[] | Marcha, 0–8 |
| `drs` | int[] | DRS aberto: 1/0 (códigos 10, 12 e 14 do live timing) |

- Todas as listas de uma volta têm o mesmo tamanho.
- A distância vem da integração da velocidade (`add_distance` do FastF1). Por isso ela pode terminar alguns metros antes ou depois do comprimento real da volta.
- Monza 2024 (corrida): até 130 KB por piloto, 2,4 MB no total. O front só baixa os pilotos que estão sendo comparados.
