// Общие типы приложения крипто-скринера

export type Exchange = 'binance' | 'bybit';
export type MarketType = 'spot' | 'futures';
export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type ChartType = 'candles' | 'line' | 'area';
export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'comfortable';
export type FontSize = 'sm' | 'md' | 'lg';

/** Интервалы, поддерживаемые обеими биржами */
export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

/** Binance REST не отдаёт 1w — эмулируем из 1d */
export function restInterval(interval: Interval): Interval {
  return interval === '1w' ? '1d' : interval;
}

export interface Candle {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** unix ms закрытия — для нормализованных WebSocket-данных */
  closeTime?: number;
  trades?: number;
}

/** Нормализованные 24ч тикер-данные */
export interface TickerData {
  symbol: string; // базовый символ, напр. 'BTCUSDT'
  exchange: Exchange;
  market: MarketType;
  price: number;
  change24h: number; // абсолютное изменение цены
  changePercent24h: number; // %
  high24h: number;
  low24h: number;
  volume24h: number; // в базовой монете
  quoteVolume24h: number; // в котируемой монете (USDT)
  updatedAt: number; // unix ms
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: number;
}

export interface TradeRecord {
  id: string;
  price: number;
  quantity: number;
  time: number; // unix ms
  side: 'buy' | 'sell';
}

export interface TargetLevel {
  id: string;
  value: number;
  kind: 'support' | 'resistance';
  manual: boolean;
}

/** Ключ пары: exchange|market|SYMBOL */
export function pairKey(exchange: Exchange, market: MarketType, symbol: string): string {
  return `${exchange}|${market}|${symbol}`;
}

export function parsePairKey(key: string): { exchange: Exchange; market: MarketType; symbol: string } {
  const [exchange, market, symbol] = key.split('|');
  return { exchange: exchange as Exchange, market: market as MarketType, symbol };
}

export interface CoinRowVM {
  key: string;
  symbol: string;
  displaySymbol: string;
  exchange: Exchange;
  market: MarketType;
  price: number;
  change24h: number;
  volume24h: number;
  sparkline: number[];
  supportLevels: number[];
  resistanceLevels: number[];
  trend: TrendDirection;
  updatedAt: number;
}
