import type { Candle, TrendDirection } from '../types';

/** SMA — простое скользящее среднее по close */
export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

/** EMA — экспоненциальное скользящее среднее */
export function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    prev = isNaN(prev) ? v : v * k + prev * (1 - k);
    out.push(i >= period - 1 ? prev : NaN);
  }
  return out;
}

/** RSI (Wilder smoothing). Период по умолчанию 14. */
export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** MACD: линия, сигнальная, гистограмма */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  const valid = line.filter((v) => !isNaN(v));
  const sigValid = ema(valid, signal);
  const offset = line.length - valid.length;
  const signalLine = line.map((_, i) =>
    i < offset + signal - 1 ? NaN : sigValid[i - offset],
  );
  const histogram = line.map((v, i) => (isNaN(v) || isNaN(signalLine[i]) ? NaN : v - signalLine[i]));
  return { line, signal: signalLine, histogram };
}

/** Bollinger Bands: middle/upper/lower + массив ширины полос */
export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(mid[i])) {
      upper.push(NaN);
      lower.push(NaN);
      width.push(NaN);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
    width.push(mean !== 0 ? ((upper[i] - lower[i]) / mean) * 100 : NaN);
  }
  return { middle: mid, upper, lower, width };
}

/** ATR (Average True Range), период по умолчанию 14 */
export function atr(candles: Candle[], period = 14): number[] {
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  // Сглаживание Уайлдера
  const out: number[] = new Array(candles.length).fill(NaN);
  if (trs.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Истинный диапазон последней свечи */
export function trueRange(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const c = candles[candles.length - 1];
  if (candles.length < 2) return c.high - c.low;
  const pc = candles[candles.length - 2].close;
  return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
}

/** Волатильность: стандартное отклонение доходностей в % */
export function volatility(closes: number[], lookback = 30): number {
  const data = closes.slice(-(lookback + 1));
  if (data.length < 2) return 0;
  const rets: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] > 0) rets.push((data[i] - data[i - 1]) / data[i - 1]);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varr = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varr) * 100;
}

export function averageVolume(candles: Candle[], lookback = 30): number {
  const data = candles.slice(-lookback);
  if (data.length === 0) return 0;
  return data.reduce((s, c) => s + c.volume, 0) / data.length;
}

export function totalTrades(candles: Candle[]): number {
  return candles.reduce((s, c) => s + (c.trades ?? 0), 0);
}

/**
 * Автоматический расчёт уровней поддержки/сопротивления.
 * Локальные экстремумы (fractal pivot) сgroup-окном `wing`, кластеризация близких уровней.
 */
export function calculateSupportResistance(
  candles: Candle[],
  lookback = 50,
  wing = 3,
): { support: number[]; resistance: number[] } {
  const data = candles.slice(-lookback);
  if (data.length < wing * 2 + 1) return { support: [], resistance: [] };

  const maxima: number[] = [];
  const minima: number[] = [];
  for (let i = wing; i < data.length - wing; i++) {
    let isMax = true;
    let isMin = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (data[j].high >= data[i].high) isMax = false;
      if (data[j].low <= data[i].low) isMin = false;
    }
    if (isMax) maxima.push(data[i].high);
    if (isMin) minima.push(data[i].low);
  }

  const last = data[data.length - 1].close;
  const cluster = (levels: number[]): number[] => {
    const sorted = [...levels].sort((a, b) => a - b);
    const tol = last * 0.005; // 0.5%
    const result: number[] = [];
    for (const v of sorted) {
      if (result.length && v - result[result.length - 1] < tol) {
        result[result.length - 1] = (result[result.length - 1] + v) / 2;
      } else {
        result.push(v);
      }
    }
    return result;
  };

  const support = cluster(minima).filter((v) => v < last).slice(-3);
  const resistance = cluster(maxima).filter((v) => v > last).slice(0, 3);
  return { support, resistance };
}

/** Индикатор тренда по MA и структуре */
export function trendFromCandles(candles: Candle[]): TrendDirection {
  const closes = candles.map((c) => c.close);
  if (closes.length < 21) return 'neutral';
  const maShort = sma(closes, 7);
  const maLong = sma(closes, 21);
  const s = maShort[maShort.length - 1];
  const l = maLong[maLong.length - 1];
  if (isNaN(s) || isNaN(l)) return 'neutral';
  const spread = (s - l) / l;
  if (spread > 0.004) return 'bullish';
  if (spread < -0.004) return 'bearish';
  return 'neutral';
}

/** Агрегация дневных свечей в недельные (для интервала 1w из REST 1d) */
export function aggregateToWeekly(daily: Candle[]): Candle[] {
  const weeks: Candle[] = [];
  let bucket: Candle | null = null;
  for (const c of daily) {
    const weekStart = Math.floor(c.time / (7 * 86400)) * 7 * 86400;
    if (!bucket || bucket.time !== weekStart) {
      if (bucket) weeks.push(bucket);
      bucket = { time: weekStart, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume;
    }
  }
  if (bucket) weeks.push(bucket);
  return weeks;
}
