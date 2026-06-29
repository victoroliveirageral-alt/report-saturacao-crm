# Painel Saturação CRM V2

Este repositório contém a V2 do painel de saturação CRM. Ele deve ser publicado como um painel separado, sem alterar o painel original que já está em produção.

## Publicação

Serviço recomendado no Render:

- Type: Static Site
- Name: `report-saturacao-crm-v2`
- Repository: `victoroliveirageral-alt/report-saturacao-crm`
- Branch: `main`
- Build Command: `echo "No build step"`
- Publish Directory: `.`

O arquivo `render.yaml` já deixa essa configuração versionada. A rota `/push-health` é reescrita para `/index.html` dentro do serviço V2.

## Ambiente atual

A V2 também está publicada via GitHub Pages:

https://victoroliveirageral-alt.github.io/report-saturacao-crm/
