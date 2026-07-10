const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const app = express();
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SOURCE_API = (process.env.SOURCE_PANEL_API || 'https://relatorio-campanhas-clevertap.onrender.com').replace(/\/+$/, '');
const PANEL_FALLBACK_URL = process.env.PANEL_FALLBACK_URL || 'https://report-saturacao-crm.onrender.com/';
const PORT = Number(process.env.PORT || 3000);
const METRICS_TTL_MS = Number(process.env.METRICS_TTL_MS || 5 * 60 * 1000);

let metricsCache = { expiresAt: 0, data: null };
const audioCache = new Map();

app.use(express.json({ limit: '1mb' }));

// CORS ajuda o app nativo Expo a consumir a API quando apontar para o Render.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function fmtNumber(value, digits = 0) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

function fmtPercent(value, digits = 1) {
  return `${fmtNumber(value, digits)}%`;
}

function parseMonth(month) {
  const [year, monthIndex] = String(month).split('-').map(Number);
  return { year, monthIndex };
}

function daysInMonth(month) {
  const { year, monthIndex } = parseMonth(month);
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

function lastDayOfMonth(month) {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

function previousMonth(month) {
  const { year, monthIndex } = parseMonth(month);
  const date = new Date(Date.UTC(year, monthIndex - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month) {
  const { year, monthIndex } = parseMonth(month);
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
  return label.replace('.', '').replace(' de ', '/');
}

function updatedLabel(dateLike) {
  if (!dateLike) return 'dados em atualização';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(dateLike));
}

async function fetchPanelJson(pathname, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SOURCE_API}${pathname}`, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Painel retornou ${response.status} em ${pathname}: ${text.slice(0, 160)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getMonthlySeries(insights, plan = 'total') {
  const byPlan = insights?.mensal_por_plano?.[plan];
  const series = Array.isArray(byPlan) ? byPlan : insights?.mensal;
  return Array.isArray(series) ? series.filter((item) => item && item.mes) : [];
}

function chooseStableMonth(insights, series) {
  const selected = insights?.mes_selecionado || series.at(-1)?.mes;
  const analysisTo = insights?.periodo_analise_diaria?.to;
  const selectedDay = analysisTo && analysisTo.startsWith(selected) ? Number(analysisTo.slice(8, 10)) : null;
  if (selectedDay && selectedDay < daysInMonth(selected)) return previousMonth(selected);
  return selected;
}

function combineDailyBuckets(freqDaily) {
  const labels = ['1 push/dia', '2 pushes/dia', '3 pushes/dia', '4 pushes/dia', '5 pushes/dia', '6+ pushes/dia'];
  const rows = labels.map((label) => {
    const value = Number(freqDaily?.buckets_filiado?.[label] || 0) + Number(freqDaily?.buckets_outros?.[label] || 0);
    const optOut = Number(freqDaily?.buckets_filiado_optout?.[label] || 0) + Number(freqDaily?.buckets_outros_optout?.[label] || 0);
    return { label, value, optOut };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return rows.map((row) => ({
    ...row,
    percent: total ? round((row.value / total) * 100, 2) : 0,
    optOutPercent: row.value ? round((row.optOut / row.value) * 100, 2) : 0,
  }));
}

function makeObservation(reachability, series, stableMonth, pressure) {
  const filiado = reachability.segmentacao_plan.filiado;
  const outros = reachability.segmentacao_plan.outros;
  const gap = round(filiado.taxa_opt_out - outros.taxa_opt_out, 2);
  const last = series.at(-1);
  const peak = series.reduce((max, item) => (item.taxa_opt_out > max.taxa_opt_out ? item : max), series[0]);

  return {
    filiadoGap:
      gap >= 0
        ? `Filiados têm opt-out ${fmtNumber(gap, 2)}pp acima de Outros e concentram ${fmtPercent(filiado.share_opt_out, 1)} dos opt-outs classificados.`
        : `Filiados têm opt-out ${fmtNumber(Math.abs(gap), 2)}pp abaixo de Outros; o risco relativo está mais concentrado fora da base trabalhada pelo CRM.`,
    trend:
      peak?.mes === last?.mes
        ? `O mês atual é o ponto mais alto da série disponível, então a leitura pede controle imediato da pressão de envio.`
        : `O pico foi em ${monthLabel(peak.mes)}; o mês mais recente está em ${fmtPercent(last?.taxa_opt_out, 1)} nos movimentos de permissão.`,
    pressure:
      pressure?.highShare > 0
        ? `Em ${monthLabel(stableMonth)}, a faixa 6+ pushes/dia concentrou ${fmtPercent(pressure.highShare, 1)} dos dias-usuário com push e teve ${fmtPercent(pressure.highOptOutRate, 1)} desses perfis já em opt-out hoje.`
        : 'A distribuição diária ainda não retornou dados suficientes para medir a cauda de frequência.',
  };
}

async function buildMetrics() {
  const [reachability, insights] = await Promise.all([
    fetchPanelJson('/api/reachability-push', { timeoutMs: 120000 }),
    fetchPanelJson('/api/push-health-insights-v2', { timeoutMs: 120000 }),
  ]);

  if (!reachability?.sucesso || !insights?.sucesso) {
    throw new Error('O painel fonte respondeu sem sucesso nos endpoints principais.');
  }

  const series = getMonthlySeries(insights, 'total');
  const stableMonth = chooseStableMonth(insights, series);
  const stableInsightsPromise =
    stableMonth === insights.mes_selecionado
      ? Promise.resolve(insights)
      : fetchPanelJson(`/api/push-health-insights-v2?month=${encodeURIComponent(stableMonth)}`, { timeoutMs: 120000 });
  const from = `${stableMonth}-01`;
  const to = lastDayOfMonth(stableMonth);

  const [freqDailyResult, sendFreqResult, stableInsightsResult] = await Promise.allSettled([
    fetchPanelJson(`/api/frequencia-diaria?month=${encodeURIComponent(stableMonth)}`, { timeoutMs: 120000 }),
    fetchPanelJson(`/api/frequencia-envio-push?from=${from}&to=${to}&status=completed`, { timeoutMs: 120000 }),
    stableInsightsPromise,
  ]);

  const stableInsights = stableInsightsResult.status === 'fulfilled' ? stableInsightsResult.value : insights;
  const freqDaily = freqDailyResult.status === 'fulfilled' ? freqDailyResult.value : null;
  const sendFreq = sendFreqResult.status === 'fulfilled' ? sendFreqResult.value : null;
  const sendMonth = sendFreq?.meses?.find((item) => item.mes === stableMonth) || null;
  const buckets = freqDaily?.sucesso ? combineDailyBuckets(freqDaily) : [];
  const highBucket = buckets.find((bucket) => bucket.label === '6+ pushes/dia');
  const classifiedBase =
    Number(reachability.segmentacao_plan.filiado.base_com_token || 0) +
    Number(reachability.segmentacao_plan.outros.base_com_token || 0);
  const pushesPerUserDay =
    sendMonth?.envios && classifiedBase ? round(sendMonth.envios / classifiedBase / daysInMonth(stableMonth), 2) : null;
  const pressure = {
    month: stableMonth,
    highShare: highBucket?.percent || 0,
    highValue: highBucket?.value || 0,
    highOptOutRate: highBucket?.optOutPercent || 0,
    pushesPerUserDay,
    envios: sendMonth?.envios || null,
    campanhas: sendMonth?.campanhas_push || sendMonth?.campanhas_push_com_envio || null,
  };
  const sendMonths = Array.isArray(sendFreq?.meses)
    ? sendFreq.meses.map((item) => ({
        mes: item.mes,
        envios: Number(item.envios || 0),
        impressoes: Number(item.impressoes || 0),
        cliques: Number(item.cliques || 0),
        campanhas: Number(item.campanhas_push || item.campanhas_push_com_envio || 0),
        ctrEnvios: Number(item.ctr_envios || 0),
        ctrImpressoes: Number(item.ctr_impressoes || 0),
      }))
    : [];
  const sendFrequency = {
    period: sendFreq?.periodo || { from, to },
    source: sendFreq?.fonte || 'message/report.json sem filtro de labels',
    months: sendMonths,
    totalSends: sendMonths.reduce((sum, item) => sum + item.envios, 0),
    averageMonthlySends: sendMonths.length
      ? round(sendMonths.reduce((sum, item) => sum + item.envios, 0) / sendMonths.length, 0)
      : null,
    averageMonthlyCampaigns: sendMonths.length
      ? round(sendMonths.reduce((sum, item) => sum + item.campanhas, 0) / sendMonths.length, 1)
      : null,
  };
  const observations = makeObservation(reachability, series, stableMonth, pressure);
  const first = series[0];
  const current = series.at(-1);
  const peak = series.reduce((max, item) => (item.taxa_opt_out > max.taxa_opt_out ? item : max), first);
  const avg = series.length ? round(series.reduce((sum, item) => sum + Number(item.taxa_opt_out || 0), 0) / series.length, 2) : 0;
  const filiado = reachability.segmentacao_plan.filiado;
  const outros = reachability.segmentacao_plan.outros;
  const filiadoGap = round(filiado.taxa_opt_out - outros.taxa_opt_out, 2);
  const retailOptIn = 64.03;
  const updatedAt = insights.atualizado_em || reachability.atualizado_em;
  const criticalDay = stableInsights?.maiores_dias_opt_out?.[0] || insights?.maiores_dias_opt_out?.[0] || null;

  return {
    report: {
      title: 'Cartao de TODOS - Executive Stories',
      displayTitle: 'Cartão de TODOS',
      subtitle: 'Saturação CRM V2 · Briefing Executivo',
      liveLabel: updatedLabel(updatedAt),
      fallbackUrl: PANEL_FALLBACK_URL,
    },
    source: {
      panelUrl: PANEL_FALLBACK_URL,
      apiBaseUrl: SOURCE_API,
      updatedAt,
      updatedLabel: updatedLabel(updatedAt),
      stableMonth,
      selectedMonth: insights.mes_selecionado,
    },
    cards: [
      {
        id: 'snapshot',
        layout: 'portrait',
        color: '#00A988',
        kicker: 'Retrato atual',
        title: 'A base Push segue majoritariamente aberta.',
        total: {
          label: 'usuários com app instalado e device token',
          value: reachability.base_com_token,
        },
        split: {
          positive: {
            label: 'Aceitam push',
            value: reachability.perfis_opt_in,
            percent: reachability.taxa_opt_in,
            legend: 'has_token + MSG-push true',
          },
          negative: {
            label: 'Bloquearam',
            value: reachability.perfis_opt_out,
            percent: reachability.taxa_opt_out,
            legend: 'has_token + MSG-push false',
          },
        },
        note: reachability.metodologia.observacao,
      },
      {
        id: 'benchmark',
        layout: 'standard',
        color: '#A6FF00',
        kicker: 'Benchmark retail',
        title: 'O opt-in do Cartão está acima do varejo.',
        metric: {
          value: reachability.taxa_opt_in,
          suffix: '%',
          decimals: 2,
          label: 'opt-in total atual',
        },
        progress: {
          percent: reachability.taxa_opt_in,
          label: `${fmtNumber(round(reachability.taxa_opt_in - retailOptIn, 2), 2)}pp acima do benchmark retail (${fmtPercent(retailOptIn, 2)}).`,
        },
        note: 'Comparação executiva com o benchmark de opt-in Retail usado no painel original.',
      },
      {
        id: 'filiados',
        layout: 'problem',
        color: '#FB2A5B',
        kicker: 'Onde exige cuidado',
        title: 'Filiados carregam a maior parte do opt-out classificado.',
        metric: {
          value: filiado.perfis_opt_out,
          label: 'Filiados em opt-out',
          tag: `${fmtPercent(filiado.share_opt_out, 1)} dos opt-outs classificados`,
        },
        sectionLabel: 'Taxa de opt-out atual',
        segments: [
          { label: 'Filiados', value: filiado.taxa_opt_out, display: fmtPercent(filiado.taxa_opt_out, 2) },
          { label: 'Outros', value: outros.taxa_opt_out, display: fmtPercent(outros.taxa_opt_out, 2) },
          { label: 'Total', value: reachability.taxa_opt_out, display: fmtPercent(reachability.taxa_opt_out, 2) },
        ],
        gap: {
          label: 'Gap Filiados vs. Outros',
          value: `${fmtNumber(filiadoGap, 2)}pp`,
          observation: observations.filiadoGap,
        },
      },
      {
        id: 'trend',
        layout: 'trend',
        color: '#05a9c4',
        kicker: 'Trajetória',
        title: 'O opt-out por movimento acelerou no pico de campanha.',
        metric: {
          value: current?.taxa_opt_out || 0,
          suffix: '%',
          decimals: 2,
          label: `${monthLabel(current?.mes)} · mês mais recente`,
        },
        delta: {
          value: round((current?.taxa_opt_out || 0) - (first?.taxa_opt_out || 0), 2),
          label: 'vs início do período',
        },
        bars: [
          { label: `Início · ${monthLabel(first?.mes)}`, value: first?.taxa_opt_out || 0, tone: 'dim' },
          { label: `Atual · ${monthLabel(current?.mes)}`, value: current?.taxa_opt_out || 0, tone: 'main' },
          { label: `Pico · ${monthLabel(peak?.mes)}`, value: peak?.taxa_opt_out || 0, tone: 'accent' },
        ],
        average: {
          label: 'Média do período',
          value: `${fmtPercent(avg, 2)}`,
        },
        observation: observations.trend,
      },
      {
        id: 'pressure',
        layout: 'problem',
        color: '#f28b22',
        kicker: 'Pressão diária',
        title: 'A cauda 6+ pushes/dia é o radar de saturação.',
        empty: !freqDaily?.sucesso,
        metric: {
          value: pressure.highShare,
          suffix: '%',
          decimals: 2,
          label: `dias-usuário em 6+ pushes/dia · ${monthLabel(stableMonth)}`,
          tag: pressure.pushesPerUserDay
            ? `${fmtNumber(pressure.pushesPerUserDay, 2)} pushes/usuário/dia no mês`
            : 'frequência média em atualização',
        },
        sectionLabel: 'Distribuição por faixa',
        segments: buckets.map((bucket) => ({
          label: bucket.label,
          value: bucket.percent,
          display: fmtPercent(bucket.percent, 1),
        })),
        gap: {
          label: 'Dia crítico do mês',
          value: criticalDay ? `${fmtNumber(criticalDay.opt_out)} opt-outs` : 'sem retorno',
          observation: criticalDay
            ? `${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${criticalDay.data}T00:00:00Z`))}: ${fmtNumber(criticalDay.campanhas)} campanhas e ${fmtNumber(criticalDay.envios)} envios. ${observations.pressure}`
            : observations.pressure,
        },
      },
      {
        id: 'action',
        layout: 'highlights',
        color: '#A6FF00',
        kicker: 'Conclusão executiva',
        title: 'O que os dados nos dizem?',
        // O último story precisa ser lido em poucos segundos; os sinais foram somados em dois destaques.
        highlights: [
          {
            tone: 'danger',
            label: 'Risco',
            title: 'Frequência alta acelera opt-out.',
            body:
              'ABR-JUN/26 teve mais frequência e os maiores picos de opt-out. Dias críticos: +25,5% campanhas e +33,1% CTR.',
            action: 'Frear colisão diária.',
          },
          {
            tone: 'accent',
            label: 'Compra',
            title: 'Frequência de compra também acelerou.',
            body:
              'Recorrência 2+ subiu de 31,6% para 33,5%; média 34,4% e pico de 36,1% em Mai/26. Compradores 4+ cresceram 27,5%.',
            action: 'Proteger quem compra mais com menor repetição de push.',
          },
        ],
      },
    ],
    questions: [
      'Por que Filiados bloqueiam mais push que Outros?',
      'Qual foi o pico de opt-out no período?',
      'O limite de 1 push por dia ainda faz sentido?',
    ],
    qaContext: {
      reachability,
      monthly: series,
      stableMonth,
      pressure,
      criticalDay,
      criticalComparison: stableInsights?.comparacao_dias_criticos || insights?.comparacao_dias_criticos || null,
      sendFrequency,
      purchaseFrequency: {
        recurrence2Start: 31.6,
        recurrence2End: 33.5,
        recurrence2Average: 34.4,
        recurrence2Peak: 36.1,
        recurrence2PeakMonth: '2026-05',
        buyersGrowth: 15.9,
        buyersStartMonthly: 2230000,
        buyersEndMonthly: 2590000,
        buyers4PlusGrowth: 27.5,
      },
    },
  };
}

async function getMetrics(force = false) {
  const now = Date.now();
  if (!force && metricsCache.data && metricsCache.expiresAt > now) return metricsCache.data;

  try {
    const data = await buildMetrics();
    metricsCache = { data, expiresAt: now + METRICS_TTL_MS };
    return data;
  } catch (error) {
    if (metricsCache.data) return { ...metricsCache.data, stale: true, staleReason: error.message };
    throw error;
  }
}

function stripMarkdown(markdown = '') {
  return String(markdown)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactMetrics(metrics) {
  const cards = metrics.cards.map((card) => ({
    id: card.id,
    title: card.title,
    metric: card.metric,
    split: card.split,
    gap: card.gap,
    average: card.average,
    observation: card.observation,
    lead: card.lead,
    insights: card.insights,
    highlights: card.highlights,
  }));
  return {
    updatedAt: metrics.source.updatedLabel,
    stableMonth: metrics.source.stableMonth,
    cards,
    questions: metrics.questions,
  };
}

function localBriefing(metrics) {
  const snapshot = metrics.cards.find((card) => card.id === 'snapshot');
  const filiados = metrics.cards.find((card) => card.id === 'filiados');
  const trend = metrics.cards.find((card) => card.id === 'trend');
  const pressure = metrics.cards.find((card) => card.id === 'pressure');
  const action = metrics.cards.find((card) => card.id === 'action');

  return [
    `**Resumo executivo:** a base Push do Cartão de TODOS tem ${fmtNumber(snapshot.total.value)} usuários com token e ${fmtPercent(snapshot.split.positive.percent, 2)} de opt-in.`,
    `O ponto de atenção está em Filiados: ${fmtNumber(filiados.metric.value)} já estão em opt-out, com gap de ${filiados.gap.value} contra Outros.`,
    `Na série histórica, o mês mais recente está em ${fmtPercent(trend.metric.value, 2)} de opt-out por movimento; ${trend.observation}`,
    pressure.empty
      ? 'A leitura de frequência diária ainda está indisponível no backend fonte.'
      : `Em frequência, ${fmtPercent(pressure.metric.value, 2)} dos dias-usuário ficaram na faixa 6+ pushes/dia. ${pressure.gap.observation}`,
    `**Conclusão:** ${action.highlights.map((item) => `${item.title} ${item.action}`).join(' ')}`,
  ].join('\n\n');
}

async function callOpenAIText(system, user) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: user }] },
      ],
      max_output_tokens: 650,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI texto indisponível: ${response.status} ${text.slice(0, 160)}`);
  }

  const json = await response.json();
  if (json.output_text) return json.output_text;
  const chunks = [];
  for (const item of json.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function generateAudio(script, voiceKey) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const voiceMap = {
    grave: 'onyx',
    ponderada: 'sage',
    energica: 'nova',
  };

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: voiceMap[voiceKey] || voiceMap.ponderada,
      input: stripMarkdown(script).slice(0, 4000),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI áudio indisponível: ${response.status} ${text.slice(0, 160)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const id = crypto.randomUUID();
  audioCache.set(id, { buffer, createdAt: Date.now() });
  return `/api/audio/${id}.mp3`;
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function localAnswer(question, metrics) {
  const q = question.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const context = metrics.qaContext;
  const monthly = context.monthly;
  const peak = monthly.reduce((max, item) => (item.taxa_opt_out > max.taxa_opt_out ? item : max), monthly[0]);
  const reach = context.reachability;
  const filiado = reach.segmentacao_plan.filiado;
  const outros = reach.segmentacao_plan.outros;
  const gap = round(filiado.taxa_opt_out - outros.taxa_opt_out, 2);

  if (hasAny(q, ['envio', 'envios', 'disparo', 'disparos', 'mensagem', 'mensagens'])) {
    const send = context.sendFrequency;
    if (!send?.months?.length) {
      return {
        answer:
          '**Envios/mês:** a API fonte não retornou meses de envio para o recorte consultado. Por isso não vou substituir por opt-in ou zero.',
        deterministic: true,
      };
    }

    const rows = send.months
      .map((item) => `${monthLabel(item.mes)}: ${fmtNumber(item.envios)} envios e ${fmtNumber(item.campanhas)} campanhas`)
      .join('; ');
    const period =
      send.period?.from && send.period?.to
        ? `${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${send.period.from}T00:00:00Z`))} a ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${send.period.to}T00:00:00Z`))}`
        : 'recorte disponível';

    return {
      answer: `**Média de envios/mês:** ${fmtNumber(send.averageMonthlySends)} envios/mês no recorte consultado (${period}). Detalhe: ${rows}. Fonte: ${send.source}.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['compra', 'compras', 'comprador', 'compradores', 'recorrencia', 'recorrente', 'cashback'])) {
    const purchase = context.purchaseFrequency;
    return {
      answer: `**Frequência de compra:** a recorrência 2+ subiu de ${fmtPercent(purchase.recurrence2Start, 1)} para ${fmtPercent(purchase.recurrence2End, 1)}, com média de ${fmtPercent(purchase.recurrence2Average, 1)} e pico de ${fmtPercent(purchase.recurrence2Peak, 1)} em ${monthLabel(purchase.recurrence2PeakMonth)}. Compradores únicos cresceram ${fmtPercent(purchase.buyersGrowth, 1)} (${fmtNumber(purchase.buyersStartMonthly)} -> ${fmtNumber(purchase.buyersEndMonthly)}/mês) e compradores 4+ cresceram ${fmtPercent(purchase.buyers4PlusGrowth, 1)}.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['ctr', 'clique', 'cliques', 'impressao', 'impressoes', 'engajamento'])) {
    const comparison = context.criticalComparison;
    const ctr = comparison?.ctr;
    const impression = comparison?.taxa_impressao;
    if (!ctr || !impression) {
      return {
        answer: '**CTR e impressão:** esse recorte não voltou no endpoint de comparação de dias críticos agora.',
        deterministic: true,
      };
    }
    return {
      answer: `**Engajamento nos dias críticos:** o CTR ficou ${fmtPercent(ctr.variacao_percentual, 1)} vs. dias de referência e a taxa de impressão ficou ${fmtPercent(impression.variacao_percentual, 1)}. A leitura é reduzir colisão e repetição; não cortar campanhas relevantes automaticamente.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['campanha', 'campanhas', 'concentracao', 'top 3', 'ranking'])) {
    const comparison = context.criticalComparison;
    const campaigns = comparison?.campanhas;
    const critical = context.criticalDay;
    return {
      answer: campaigns
        ? `**Concentração de campanhas:** nos dias críticos, campanhas ficaram ${fmtPercent(campaigns.variacao_percentual, 1)} vs. referência. O principal dia crítico foi ${critical?.data || 'sem data disponível'}, com ${fmtNumber(critical?.campanhas || 0)} campanhas e ${fmtNumber(critical?.opt_out || 0)} opt-outs.`
        : '**Concentração de campanhas:** o endpoint não retornou comparação suficiente para esse recorte agora.',
      deterministic: true,
    };
  }

  if (hasAny(q, ['opt in', 'opt-in', 'aceitam', 'aceite', 'push ativo'])) {
    return {
      answer: `**Opt-in atual:** ${fmtPercent(reach.taxa_opt_in, 2)} da base com token aceita push (${fmtNumber(reach.perfis_opt_in)} perfis). Entre Filiados, o opt-in é ${fmtPercent(filiado.taxa_opt_in, 2)}.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['filiado', 'filiados', 'outros', 'plano'])) {
    return {
      answer: `**Filiados exigem mais atenção.** A taxa atual de opt-out em Filiados é ${fmtPercent(filiado.taxa_opt_out, 2)}, contra ${fmtPercent(outros.taxa_opt_out, 2)} em Outros. O gap é de ${fmtNumber(gap, 2)}pp e Filiados concentram ${fmtPercent(filiado.share_opt_out, 1)} dos opt-outs classificados.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['pico', 'mes', 'meses', 'tendencia', 'historico', 'opt-out', 'opt out', 'bloqueio', 'bloquearam'])) {
    return {
      answer: `**Pico de opt-out:** o pico do período foi ${monthLabel(peak.mes)}, com ${fmtPercent(peak.taxa_opt_out, 2)} de opt-out por movimento. No mês mais recente da série, ${monthLabel(monthly.at(-1).mes)}, a taxa está em ${fmtPercent(monthly.at(-1).taxa_opt_out, 2)}.`,
      deterministic: true,
    };
  }

  if (hasAny(q, ['frequencia', 'push', '1 push', 'limite', 'pressao', '6+'])) {
    const pressure = context.pressure;
    return {
      answer: pressure?.highShare
        ? `**Frequência de push:** em ${monthLabel(context.stableMonth)}, ${fmtPercent(pressure.highShare, 2)} dos dias-usuário com push ficaram na faixa 6+ pushes/dia. A frequência média estimada foi ${fmtNumber(pressure.pushesPerUserDay, 2)} pushes/usuário/dia, usando ${fmtNumber(pressure.envios)} envios e a base classificada de Filiados + Outros.`
        : '**Frequência de push:** a distribuição diária ainda não voltou completa no backend fonte. O app não substitui ausência por zero.',
      deterministic: true,
    };
  }

  return {
    answer: `**Leitura curta:** a base está saudável no agregado, com ${fmtPercent(reach.taxa_opt_in, 2)} de opt-in. O risco principal é saturação concentrada em Filiados, dias com muitas campanhas simultâneas e faixas de alta frequência de push.`,
    deterministic: false,
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, source: SOURCE_API });
});

app.get('/api/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics(req.query.refresh === '1');
    res.json(metrics);
  } catch (error) {
    res.status(502).json({
      erro: 'Não foi possível consultar os dados reais do painel fonte.',
      detalhe: error.message,
      fallbackUrl: PANEL_FALLBACK_URL,
    });
  }
});

app.post('/api/briefing', async (req, res) => {
  const voice = req.body?.voice || 'ponderada';

  try {
    const metrics = await getMetrics();
    let script = localBriefing(metrics);
    let engine = 'Leitura local dos dados reais';
    let audioUrl = null;

    if (process.env.OPENAI_API_KEY) {
      const prompt = `Gere um briefing executivo em pt-BR, até 130 palavras, sem inventar dados. Use somente este JSON: ${JSON.stringify(compactMetrics(metrics))}`;
      script =
        (await callOpenAIText(
          'Você é um analista executivo de CRM. Responda em markdown simples, direto, com números em pt-BR.',
          prompt,
        )) || script;
      engine = `${process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini'} + ${process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'}`;
      audioUrl = await generateAudio(script, voice).catch(() => null);
    }

    res.json({ script, audioUrl, engine, voice });
  } catch (error) {
    res.status(502).json({
      erro: 'Não foi possível gerar o briefing agora.',
      detalhe: error.message,
    });
  }
});

app.post('/api/ask', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (question.length < 3) {
    return res.status(400).json({ erro: 'Digite uma pergunta com pelo menos 3 caracteres.' });
  }

  try {
    const metrics = await getMetrics();
    const routedAnswer = localAnswer(question, metrics);
    let answer = routedAnswer.answer;
    let engine = 'Leitura local dos dados reais';

    if (process.env.OPENAI_API_KEY && !routedAnswer.deterministic) {
      const prompt = [
        `Pergunta: ${question}`,
        `Dados disponíveis: ${JSON.stringify(compactMetrics(metrics))}`,
        'Responda em até 110 palavras, em pt-BR. Escolha a métrica pedida antes de responder. Se a pergunta pedir envios, campanhas, CTR, compras, opt-in, opt-out ou frequência, use somente os campos correspondentes. Não troque a métrica por opt-in agregado.',
      ].join('\n\n');
      answer =
        (await callOpenAIText(
          'Você responde dúvidas executivas sobre saturação CRM usando somente os dados fornecidos. Para perguntas numéricas, seja determinístico e cite a metodologia ou recorte usado.',
          prompt,
        )) || answer;
      engine = process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini';
    }

    return res.json({ answer, engine });
  } catch (error) {
    return res.status(502).json({
      erro: 'Não foi possível consultar a base agora.',
      detalhe: error.message,
    });
  }
});

app.get('/api/audio/:id.mp3', (req, res) => {
  const item = audioCache.get(req.params.id);
  if (!item) return res.status(404).json({ erro: 'Áudio expirado ou indisponível.' });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(item.buffer);
});

app.use(express.static(DIST_DIR));

// O fallback entrega o app web gerado pelo Expo em rotas diretas do navegador.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(200).send('Build web ainda não encontrado. Rode npm run build antes de iniciar o servidor.');
});

app.listen(PORT, () => {
  console.log(`Executive Stories ouvindo na porta ${PORT}`);
});
