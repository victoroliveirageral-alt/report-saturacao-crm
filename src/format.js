// Formatação única para manter todos os números em pt-BR.
export function formatNumberBR(value, decimals = 0) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

export function formatPercentBR(value, decimals = 1) {
  return `${formatNumberBR(value, decimals)}%`;
}

export function monthLabelBR(month) {
  if (!month) return 'período';
  const [year, rawMonth] = String(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, rawMonth - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
    .format(date)
    .replace('.', '')
    .replace(' de ', '/');
}

// A IA pode responder em markdown; a tela mostra só texto limpo.
export function stripMarkdown(markdown = '') {
  return String(markdown)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
