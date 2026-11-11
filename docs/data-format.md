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
    ├── outlines.json               # traçado simplificado de cada rodada (para o calendário)
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

## `{ano}/outlines.json`

```json
{"schemaVersion": 1, "year": 2026, "size": 1000, "outlines": {"1": [[x, y], ...], "2": [...]}}
```

- Um traçado por rodada, já girado como o mapa do site e centrado num quadrado de 0 a `size`, com ~120 pontos (o arquivo da temporada tem ~27 KB, uma consulta só para o calendário inteiro).
- Recriado a cada export (junto do `index.json`) a partir dos `track.json`: usa o da corrida e, se faltar ou for inválido (traçado com menos de 500 m de extensão, como o de Mônaco 2026), o da classificação ou de outra sessão.
- Rodadas ainda sem sessão exportada não aparecem.

## `{ano}/standings.json`

```json
{"schemaVersion": 1, "year": 2026, "afterRound": 20, "generatedAt": "...", "drivers": [ ... ], "constructors": [ ... ],
 "winners": [{"round": 20, "driver": "NOR", "team": "McLaren", "teamColor": "#ff8000"}, ...],
 "rounds": [{"round": 20, "podium": [{"driver": "NOR", "team": "McLaren", "teamColor": "#ff8000"}, ...], "pole": {"driver": "ANT", ...}}, ...],
 "history": {"rounds": [1, 2, ..., 20], "points": {"ANT": [18.0, 47.0, ...], ...}}}
```

- `winners`: vencedor de cada corrida já disputada.
- `rounds`: pódio (até 3 classificados) e pole de cada rodada já disputada, usados no calendário.
- `history`: pontos acumulados de cada piloto após cada rodada, corridas **e sprints** somadas (o último valor bate com `points`). Pilotos que estrearam no meio do ano têm 0 nas rodadas anteriores.
- `winners`, `history` e os campos de estatística abaixo são calculados a partir dos resultados de corridas, sprints e classificações do Jolpica (poucas consultas paginadas). Arquivos exportados antes podem não tê-los; o site funciona sem eles.

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
| `podiums` | int | Pódios em corridas (sem sprints) |
| `poles` | int | Poles (1º na classificação de domingo; sem a da sprint) |
| `form` | (int \| null)[] | Últimas 5 corridas, da mais antiga à mais recente; `null` = não classificado |

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
| `drivers` | `{driver, points}[]` | Pontos de cada piloto **por esta equipe** (quem trocou de equipe aparece nas duas), do maior para o menor |

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

Se a posição dessa volta for inválida (sem amostras, menos de 500 m de extensão ou mais de 20% das amostras no mesmo ponto, como as posições placeholder em (0, 0) de Mônaco 2026), o export tenta a próxima volta mais rápida, de qualquer piloto, e avisa no log. `referenceLap` diz qual volta foi usada. As curvas (`distance`) são medidas nessa mesma volta.

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
{"driver": "LEC", "start": 3350.494, "hz": 4, "encoding": "delta", "x": [812, -7, ...], "y": [-203, 13, ...]}
```

- A amostra `i` corresponde ao tempo de sessão `start + i / hz`. Todos os pilotos usam a mesma grade (`meta.replay`).
- `x`, `y` são inteiros em metros, **codificados em diferenças** como na telemetria (depois de um `null` o valor volta a ser absoluto). `null` quando não há dado real a menos de 3 s (carro na garagem, abandono, falha de transmissão). Amostras em exatamente (0, 0) são placeholder do feed e contam como ausentes.
- Monza 2024 (corrida, 77 min): cerca de 22 KB por piloto, 450 KB no total.

## `telemetry/{DRV}.json.gz`

Um arquivo por piloto com todas as voltas que têm dados do carro, em JSON comprimido com gzip. São as **amostras originais** do carro (~4 Hz, ~300 por volta em Monza), sem reamostragem. Para comparar duas voltas, o front interpola as duas numa mesma grade de distância.

```json
{"driver": "LEC", "encoding": "delta", "laps": [{"lap": 33, "lapTime": 83.226, "compound": "HARD",
  "d": [9, 32, ...], "t": [0, 36, ...], "speed": [331, 2, ...],
  "throttle": [100, 0, ...], "brake": [0, ...], "gear": [8, ...], "drs": [1, ...]}]}
```

**Codificação em diferenças (`"encoding": "delta"`).** Para ocupar menos espaço, `d`, `t`, `speed` e `throttle` guardam a diferença para a amostra anterior; o primeiro valor (e o primeiro depois de um `null`) é absoluto. Decodificar: some acumulando (`deltaDecode` em `web/src/lib/data.ts`, `delta_encode` em `pipeline/common.py`). Arquivos sem o campo `encoding` (formato antigo) trazem os valores absolutos. Isso reduziu a telemetria em ~60%.

| Campo | Tipo | Descrição |
|---|---|---|
| `lap` | int | Número da volta |
| `lapTime` | float \| null | Tempo oficial da volta (s) |
| `compound` | string \| null | Composto do pneu |
| `d` | int[] | Distância desde o início da volta (m, inteiro), crescente. Codificado em diferenças |
| `t` | int[] | Tempo desde o início da volta, em **centésimos de segundo**. Codificado em diferenças (o front converte para segundos) |
| `speed` | int[] | Velocidade (km/h). Codificado em diferenças |
| `throttle` | int[] | Acelerador, 0–100 % (o feed às vezes manda >100; limitado a 100). Codificado em diferenças |
| `brake` | int[] | Freio acionado: 1/0 |
| `gear` | int[] | Marcha, 0–8 |
| `drs` | int[] | DRS aberto: 1/0 (códigos 10, 12 e 14 do live timing) |

- Todas as listas de uma volta têm o mesmo tamanho.
- A distância vem da integração da velocidade (`add_distance` do FastF1). Por isso ela pode terminar alguns metros antes ou depois do comprimento real da volta.
- Monza 2024 (corrida): ~50 KB por piloto, ~1 MB no total (2,4 MB antes da codificação em diferenças). O front só baixa os pilotos que estão sendo comparados.

## Modo ao vivo (fase 6)

O backend local (`live/server.py`) não grava arquivos em `data/`: ele manda **snapshots** por WebSocket (`ws://127.0.0.1:8000/ws`), 4 vezes por segundo. Cada snapshot é o estado completo da sessão naquele instante, já normalizado (tipos em `web/src/types/live.ts`).

```json
{"type": "snapshot", "time": 1794163777.465,
 "session": {"meeting": "São Paulo Grand Prix", "circuit": "Interlagos", "name": "Race", "type": "Race", "status": "Started", ...},
 "lap": {"current": 34, "total": 71}, "clock": {"remaining": 3612.0, "running": true},
 "trackStatus": "green", "weather": {"airTemp": 15.6, "trackTemp": 22.2, "humidity": 90.1, "rainfall": false, "windSpeed": 3.0},
 "drivers": [{"driver": "NOR", "position": 1, "gap": "LAP 34", "interval": null,
   "lastLap": {"time": 73.1, "best": "personal"}, "bestLap": {...}, "sectors": [{...}, null, null],
   "compound": "SOFT", "tyreAge": 12, "inPit": false, "x": -346.8, "y": 120.4,
   "speed": 298, "gear": 7, "rpm": 11200, "throttle": 100, "brake": 0, "drs": false, ...}],
 "raceControl": [{"utc": "2026-11-08T18:43:45", "lap": 71, "category": "Flag", "flag": "YELLOW", "message": "..."}],
 "outline": [[x, y], ...],
 "source": {"mode": "replay", "error": null, "auto": true, "canChoose": true,
   "selected": "2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/", "loading": null,
   "liveSession": null, "nextLive": {"label": "Las Vegas Grand Prix · Treino 1", "event": "Las Vegas Grand Prix", "code": "FP1", "start": "2026-11-20T00:30:00Z"},
   "recording": "2026-20-r.jsonl.gz", "speed": 4, "paused": false, "elapsed": 6000.0, "duration": 9600.6}}
```

- `time` é o horário do feed (epoch UTC, s). As posições `x`, `y` (metros) são interpoladas 2 s atrás desse horário, para ficarem suaves entre as amostras; os canais do carro (`speed`, `gear`, `rpm`, `throttle`, `brake`, `drs`) usam o mesmo instante, para casar com o mapa.
- `gap` e `interval` são o texto do feed (`"+1.234"`, `"1 L"`, `"LAP 34"`); o front traduz. Na classificação vêm da diferença no segmento atual.
- `lastLap`, `bestLap` e `sectors` têm `best`: `"overall"` (roxo, melhor da sessão) ou `"personal"` (verde, melhor do piloto).
- `outline` é o traçado montado com uma volta limpa de algum carro (`null` até existir). Só vai no snapshot quando muda; quando a chave falta, vale o último recebido.
- `traces` só vem para quem pediu, com `{"cmd": "traces", "drivers": ["NOR", "VER"]}` (até 2 pilotos): por sigla, `{"current": ..., "previous": ...}` com a volta atual (até o instante mostrado) e a anterior. Cada uma é `{"lap", "d", "speed", "throttle", "brake"}`: listas alinhadas, `d` em metros desde a linha (integrada pela velocidade, como o FastF1), `brake` 1/0. `null` enquanto não houver uma passagem pela linha observada de verdade (a primeira leitura de voltas, ao conectar, não conta).
- `source.mode`: `"live"` (feed ao vivo), `"replay"` (simulação) ou `"idle"` (sem gravação, esperando a escolha). Na simulação o site pode mandar comandos pelo mesmo WebSocket: `{"cmd": "pause", "value": true}`, `{"cmd": "speed", "value": 16}` (1, 2, 4, 8, 16 ou 32) e `{"cmd": "seek", "value": 3600}` (segundos desde o início da gravação).
- `source.auto`: o servidor está no modo automático (liga o ao vivo no horário das sessões do `calendar.json`). `nextLive` é a próxima sessão em que isso acontece e `liveSession`, a sessão do calendário durante o ao vivo.
- `source.canChoose`: fora do ao vivo, o site pode trocar a sessão com `{"cmd": "select", "path": "2026/…_Grand_Prix/…_Qualifying/"}` (caminho do arquivo da F1). Se ainda não houver gravação dela, o servidor baixa e mostra o progresso em `loading` (`{"path", "label", "done", "total"}`, em tópicos); ao terminar, começa a simulação. `selected` é a sessão em simulação. Durante o ao vivo, `select` é ignorado.

#### Catálogo de sessões

`{"cmd": "catalog", "year": 2026}` responde só a quem pediu, com uma mensagem `"type": "catalog"` (não é snapshot):

```json
{"type": "catalog", "year": 2026, "years": [2026, 2025, ...], "error": null,
 "meetings": [{"number": 20, "name": "São Paulo Grand Prix", "location": "São Paulo", "country": "Brazil",
   "sessions": [{"name": "Race", "type": "Race", "path": "2026/…/2026-11-08_Race/", "start": "2026-11-08T17:00:00Z", "recorded": true}]}]}
```

- Vem do `Index.json` do arquivo da F1 (só sessões que já aconteceram), em ordem do calendário; `start` em UTC; `recorded` diz se já há gravação em `live/recordings/`.
- Sem acesso ao arquivo (token vencido, sem internet), `error` explica e a lista traz só as sessões já gravadas.

### Gravações (`live/recordings/*.jsonl.gz`)

Feed bruto da sessão, para reproduzir depois. Fica fora do git (dados do feed oficial, uso pessoal).

```
{"meta": {"source": "archive", "path": "2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/", "recordedAt": "..."}}
[1794154180.123, "TimingData", {"Lines": {"1": {"Position": "1"}}}]
[1794154180.402, "Position", {"Position": [{"Timestamp": "...", "Entries": {"1": {"Status": "OnTrack", "X": -3468, "Y": 1204, "Z": 0}}}]}]
```

- Uma linha JSON por mensagem: `[epoch_utc, tópico, dados]`, em ordem de tempo. Os tópicos `.z` (`Position`, `CarData`) já estão descomprimidos e sem o sufixo.
- Os dados são exatamente os do feed: o primeiro valor de cada tópico é o estado completo e os seguintes são mudanças parciais (aplicadas por `merge` em `live/state.py`). X/Y vêm em décimos de metro.
- Uma corrida completa ocupa ~12 MB.
- Sessões baixadas pelo site se chamam `{ano}-{gp}-{sessão}.jsonl.gz` (ex.: `2026-sao-paulo-grand-prix-qualifying.jsonl.gz`); as do ao vivo automático, `{data}-{ano}-{rodada}-{sessão}.jsonl.gz`. O servidor identifica a sessão de cada gravação pelo `SessionInfo` do começo do arquivo, não pelo nome.
- Nem toda sessão tem todos os tópicos (`LapCount` só existe em corrida e sprint); os que faltam são pulados.
