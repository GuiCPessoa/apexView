# apexView

Visualização interativa de corridas, classificações e treinos de Fórmula 1: classificação do campeonato, calendário, replay da corrida no mapa da pista, telemetria volta a volta e, rodando localmente, dados ao vivo.

**Acesse:** https://apexview-peach.vercel.app

Projeto pessoal, gratuito e não comercial. Não tem ligação com a Fórmula 1, a FIA ou as equipes.

## Como usar o site

O menu do topo tem quatro áreas. O seletor de temporada fica à direita, nas telas de Classificação e Calendário.

### Classificação
- O destaque mostra a situação do título: quem lidera, por quantos pontos e se já está decidido matematicamente, contando os pontos que ainda estão em jogo, inclusive das sprints.
- Cartões do top 3, tabela de pilotos e tabela de construtores.
  - Na tabela de pilotos, a coluna **Forma** mostra as últimas 5 corridas: vitória em vermelho, pódio destacado e `AB` para abandono.
  - Nos construtores, a barra mostra quanto cada piloto somou pela equipe.
- **Evolução do campeonato:** os pontos dos 6 primeiros rodada a rodada.
- **Vencedores:** quem ganhou cada etapa, na cor da equipe.

### Calendário
- Linha do tempo da temporada, com o vencedor de cada corrida e um marcador de "hoje".
- **Próxima rodada:** contagem regressiva e a programação do fim de semana. Os horários aparecem no fuso do seu navegador.
- Um cartão por rodada, com o desenho do circuito, o pódio e a pole. Use os filtros *Todas*, *Disputadas* e *A disputar*.
- Os links **Corrida →** e **Classificação →** abrem o painel da sessão.

### Sessões
Escolha ano, GP e sessão, ou chegue pelos links do calendário. Tudo fica numa página só:
- **Replay no mapa:** use o play, a velocidade e a linha do tempo, que mostra as faixas de bandeira amarela, safety car e vermelha. A torre ao lado acompanha as posições.
- **Clique num piloto** em qualquer tabela ou gráfico para destacá-lo em todos os cartões. Dá para escolher até dois, que também são os comparados na telemetria.
- **Telemetria:** velocidade, acelerador, freio, marcha e RPM ao longo da volta, comparando dois pilotos. A volta do replay aparece como cursor nos gráficos.
- **Na corrida:** posições volta a volta, estratégia de pneus, diferenças para o líder e pit stops.
- **Na classificação e nos treinos:** setores e evolução dos tempos.

### Ao vivo
Só funciona com o backend rodando no seu computador e uma assinatura F1 TV (veja abaixo). No site publicado, sem o backend, a aba mostra "Backend desligado".

## Rodar no seu computador

Pré-requisitos: **Node 20+**, **Python 3.10+** e Git.

### Site
```bash
git clone https://github.com/GuiCPessoa/apexView.git
cd apexView/web
npm install
npm run dev
```
Abra o endereço que aparecer (normalmente http://localhost:5173). Os dados já exportados estão em `data/`, e o site os lê direto de lá.

### Atualizar os dados (pipeline)
```bash
cd pipeline
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

| Comando | O que faz | Login F1 TV? |
|---|---|---|
| `python export_standings.py 2026` | Calendário, classificação, estatísticas da temporada e traçados do calendário | Não |
| `python export_session.py 2026 Monza R` | Uma sessão (`FP1`, `FP2`, `FP3`, `SQ`, `S`, `Q` ou `R`): resultados, voltas, telemetria e replay | Sim |
| `python export_season.py 2024 2025 2026` | Todas as corridas e classificações das temporadas | Sim |

- **Login F1 TV:** na primeira vez, o FastF1 pede o e-mail e a senha da sua conta F1 TV no terminal. Rode o comando num terminal interativo. O token fica fora do repositório e vale por alguns dias. Quando vencer, ele pede de novo.
- **Cache e limites:** o FastF1 guarda um cache em `pipeline/cache/`, e as consultas ao Jolpica respeitam o limite de uso.
- **Volume:** comece com uma ou duas corridas antes de exportar uma temporada inteira.

Depois de exportar, faça commit e push de `data/`. O site publicado se atualiza sozinho (veja [Deploy](#deploy)).

### Modo ao vivo
Precisa de assinatura F1 TV e usa o mesmo login do pipeline. Rode o pipeline uma vez para ter o token.
```bash
cd live
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```
Deixe o servidor rodando e abra a aba **Ao vivo** do site (local ou publicado).
- **Durante uma sessão do fim de semana de GP**, ele mostra o ao vivo sozinho e grava o feed em `live/recordings/`.
  - Mapa com os carros, torre de tempos, telemetria dos pilotos em foco, direção de prova e clima.
  - Ajuste o **atraso** para sincronizar com a TV.
  - Os horários vêm de `data/{ano}/calendar.json`, então mantenha o calendário exportado.
- **Fora das sessões**, ele simula uma sessão passada como se fosse ao vivo.
  - Use **Trocar sessão** para escolher qualquer sessão desde 2018. As que ainda não foram baixadas são baixadas na hora, em cerca de 1 minuto.
  - Dá para pausar, mudar a velocidade e pular na linha do tempo.

Outros modos: `python server.py live` força o ao vivo, e `python server.py replay [ARQUIVO]` só simula.

O servidor escuta apenas em `127.0.0.1:8000`. Não o exponha na internet: ele usa a sua assinatura F1 TV, e o feed é só para uso pessoal.

Pelo navegador, só o site local (`localhost`) e o site publicado (https://apexview-peach.vercel.app) conseguem conectar no servidor; qualquer outro site é recusado. Se você publicar o site em outro endereço, libere-o com `python server.py --allow-origin https://seu-site` ou com a variável `APEXVIEW_ALLOWED_ORIGINS`.

### Testes
```bash
cd web && npm test               # lógica do site (web/src/lib)
cd pipeline && pytest            # exportação dos dados
cd live && pytest                # modo ao vivo
```

## Deploy

O site é estático (o build do `web/` mais os arquivos de `data/`) e fica na **Vercel**, no plano gratuito. O projeto `apexview` está ligado a este repositório, com `web/` como pasta raiz.
- Todo push na branch `main` publica uma nova versão em https://apexview-peach.vercel.app.
- O cache está configurado em `web/vercel.json`: os arquivos do build ficam em cache por 1 ano, e os dados por 5 minutos.
- O mesmo arquivo define os cabeçalhos de segurança do site, incluindo a política de conteúdo (CSP): o site só carrega scripts próprios, as fontes do Google Fonts e conecta no backend local em `ws://127.0.0.1:8000`. Se mudar a porta do backend (`VITE_LIVE_URL`) ou adicionar outro serviço externo, ajuste o `connect-src` da CSP.

## Estrutura

```
pipeline/   scripts Python de exportação (FastF1 + Jolpica)
data/       dados exportados, lidos pelo site (formato em docs/data-format.md)
web/        site em Vite + React + TypeScript (mapa em SVG, uPlot na telemetria)
live/       backend local do modo ao vivo (LiveF1 + FastAPI + WebSocket)
docs/       documentação do formato dos dados
```

Guia completo de arquitetura, setup e roadmap: [`INICIO.md`](INICIO.md).

## Dados e créditos

- [FastF1](https://github.com/theOehrly/Fast-F1): sessões, voltas, telemetria e posições.
- [Jolpica-F1](https://github.com/jolpica/jolpica-f1): calendário, resultados e classificação.
- [LiveF1](https://github.com/GoktugOcal/LiveF1) e o feed oficial de live timing da F1 (não documentado): modo ao vivo, só para uso pessoal.

Os dados de corrida pertencem aos seus donos. Este projeto é só para estudo e diversão entre amigos.
