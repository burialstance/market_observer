const QUOTE_ASSETS = [
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'EUR', 'TRY', 'BNB', 'ETH', 'BTC', 'USD1',
];

/** Разбить торговый символ на базовый и котируемый активы */
export function splitSymbol(symbol: string): { base: string; quote: string } {
  for (const q of QUOTE_ASSETS) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return { base: symbol.slice(0, -q.length), quote: q };
    }
  }
  return { base: symbol, quote: '' };
}

export function formatDisplaySymbol(symbol: string): string {
  const { base, quote } = splitSymbol(symbol);
  return quote ? `${base}/${quote}` : base;
}

/** Цена с точностью, зависящей от порядка величины */
export function formatPrice(price: number): string {
  if (!isFinite(price)) return '-';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toPrecision(4);
  return price.toPrecision(2);
}

/** Сокращённый формат объёмов: 1.2M, 345K, 2.1B */
export function formatCompact(value: number): string {
  if (!isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return value.toFixed(2);
}

export function formatPercent(value: number, digits = 2): string {
  if (!isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!isFinite(value)) return '-';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatTime(unixMsOrSec: number): string {
  let ms = unixMsOrSec;
  if (ms < 1e12) ms *= 1000;
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
