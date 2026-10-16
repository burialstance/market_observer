import type { MarketType } from '../../types';
import { BaseWsClient } from './base';

const BYBIT_WS_SPOT = 'wss://stream.bybit.com/v5/public/spot';
const BYBIT_WS_LINEAR = 'wss://stream.bybit.com/v5/public/linear';

/**
 * Клиент Bybit WebSocket v5 (публичные данные).
 * Одно соединение, подписки через JSON { op: 'subscribe', args: [...] }.
 * Topics: tickers.{symbol}, kline.{interval}.{symbol}, orderbook.{depth}.{symbol}, publicTrade.{symbol}
 */
export class BybitWsClient extends BaseWsClient {
  constructor(market: MarketType) {
    super(market === 'spot' ? BYBIT_WS_SPOT : BYBIT_WS_LINEAR, 'bybit', market);
  }

  protected buildUrl(): string {
    return this.market === 'spot' ? BYBIT_WS_SPOT : BYBIT_WS_LINEAR;
  }

  protected handleParsed(parsed: unknown): void {
    const msg = parsed as {
      topic?: string;
      type?: string;
      ts?: number;
      data?: unknown;
      success?: boolean;
      op?: string;
      ret_msg?: string;
    };
    // Ответ на ping — обновляем lastMessageAt (уже сделано в base), ничего не транслируем
    if (msg.type === 'pong' || msg.op === 'subscribe' || msg.op === 'unsubscribe') return;
    if (msg.topic && msg.data !== undefined) {
      this.onMessage({ topic: msg.topic, type: msg.type, ts: msg.ts, data: msg.data });
    }
  }

  protected sendSubscribe(topic: string): void {
    this.sendRaw({ op: 'subscribe', args: [topic] });
  }

  protected sendUnsubscribe(topic: string): void {
    this.sendRaw({ op: 'unsubscribe', args: [topic] });
  }

  /** Bybit требует client-side ping каждые ~20 секунд */
  protected override onHeartbeatTick(): void {
    this.sendRaw({ op: 'ping', req_id: `ping-${Date.now()}` });
  }
}

/** Утилита формирования имён топиков */
export const bybitTopics = {
  ticker: (symbol: string) => `tickers.${symbol}`,
  kline: (symbol: string, interval: string) => `kline.${interval}.${symbol}`,
  orderbook: (symbol: string, depth = 25) => `orderbook.${depth}.${symbol}`,
  trades: (symbol: string) => `publicTrade.${symbol}`,
};

// ===== Форматы сообщений Bybit =====

export interface BybitTickerSpot {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string; // дробь, напр. 0.0123 = +1.23%
  highPrice24h: string;
  lowPrice24h: string;
  volume24h: string; // базовая
  turnover24h: string; // котируемая
  usdExchangeRate?: string;
}

export interface BybitTickerLinear extends BybitTickerSpot {
  openInterest: string;
  indexPrice: string;
}

/** kline: массив [{start,end,interval,open,high,low,close,volume,turnover,confirm}] */
export type BybitKlineItem = {
  start: number;
  end: number;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
  confirm: boolean;
};

/** orderbook: { s, b: [[price, size],...], a: [...], u, seq } */
export interface BybitOrderbookMsg {
  s: string;
  b: [string, string][];
  a: [string, string][];
  u?: number;
  seq?: number;
}

/** publicTrade: массив сделок */
export type BybitTradeItem = {
  T: number; // timestamp ms
  s: string;
  S: 'Buy' | 'Sell';
  v: string; // size
  p: string; // price
  i: string; // trade id
  T_k: string; // tape
};

export interface BybitWsMessage {
  topic: string;
  type: string;
  ts: number;
  data: unknown;
}
