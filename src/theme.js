// Tokens centrais do sistema visual Dark Premium.
export const colors = {
  bg: '#0A0F0D',
  bgElev: '#111917',
  surface: '#182421',
  border: 'rgba(255,255,255,0.08)',
  text: '#E6F0EC',
  textDim: '#8B9C97',
  accent: '#A6FF00',
  accentDim: '#4d7a00',
  brand: '#00A988',
  brandDeep: '#006B4A',
  danger: '#FB2A5B',
  warn: '#f28b22',
  info: '#05a9c4',
};

// Helpers pequenos mantêm opacidades consistentes entre web e nativo.
export function alpha(hex, opacity) {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${opacity})`;
}
