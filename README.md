# Saturacao CRM - Executive Stories

App mobile-first em Expo + React Native Web que transforma os dados reais do painel de saturação CRM em stories executivos.

## Deploy no Render

Use este diretório como raiz do serviço web.

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Runtime: Node 24+

Variáveis recomendadas:

- `SOURCE_PANEL_API=https://relatorio-campanhas-clevertap.onrender.com`
- `PANEL_FALLBACK_URL=https://report-saturacao-crm.onrender.com/`
- `OPENAI_API_KEY` opcional, para gerar briefing/perguntas com modelo e áudio.
- `OPENAI_TEXT_MODEL` opcional, padrão `gpt-5-mini`.
- `OPENAI_TTS_MODEL` opcional, padrão `gpt-4o-mini-tts`.

O arquivo `render.yaml` já contém a configuração básica do serviço.

## Comandos locais

```bash
npm install
npm run build
npm start
```

Depois abra `http://localhost:3000`.

Para usar a porta local usada na validação:

```powershell
$env:PORT=4317
npm start
```

## API exposta pelo app

- `GET /api/metrics`: agrega dados reais de reachability, opt-out mensal, frequência diária e frequência de envio.
- `POST /api/briefing`: retorna transcrição do briefing e, com `OPENAI_API_KEY`, tenta gerar áudio.
- `POST /api/ask`: responde perguntas sobre a base usando os dados agregados.
- `GET /api/health`: health check simples.

## Validação

Com o servidor local rodando:

```bash
npm run test:visual
```

O teste abre a página, valida o primeiro story, gera o briefing e consulta uma pergunta sugerida.
