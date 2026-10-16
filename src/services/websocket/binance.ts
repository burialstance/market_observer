import type { Interval, MarketType } from '../../types';
import { BaseWsClient } from './base';

const BINANCE_WS_SPOT = 'wss://stream.binance.com:9443';
const BINANCE_WS_FUTURES = 'wss://fstream.binance.com';

/**
 * Клиент Binance WebSocket.
 * Использует combined streams: /stream?streams=a/b/c — одно соединение на все подписки.
 * Стримы: <symbol>@miniTicker, <symbol>@kline_<interval>, <symbol>@depth20@100ms, <symbol>@aggTrade
 */
export class BinanceWsClient extends BaseWsClient {
  constructor(market: MarketType) {
    const base = market === 'spot' ? BINANCE_WS_SPOT : BINANCE_WS_FUTURES;
    super(`${base}/stream`, 'binance', market);
  }

  protected buildUrl(streams: string[]): string {
    const base = this.market === 'spot' ? BINANCE_WS_SPOT : BINANCE_WS_FUTURES;
    return streams.length
      ? `${base}/stream?streams=${streams.join('/')}`
      : `${base}/stream`;
  }

  /** Combined stream оборачивает данные в { stream, data } */
  protected handleParsed(parsed: unknown): void {
    const obj = parsed as { stream?: string; data?: unknown } & Record<string, unknown>;
    if (obj.stream && 'data' in obj) {
      this.onMessage(obj.data);
    } else {
      this.onMessage(parsed);
    }
  }

  protected sendSubscribe(stream: string): void {
    this.sendRaw({ method: 'SUBSCRIBE', params: [stream], id: Date.now() });
  }

  protected sendUnsubscribe(stream: string): void {
    this.sendRaw({ method: 'UNSUBSCRIBE', params: [stream], id: Date.now() });
  }
}

/** Утилита формирования имён стримов */
export const binanceStreams = {
  // @ticker содержит P (изменение в %), p (абсолютное) и n (число сделок)
  ticker: (symbol: string) => `${symbol.toLowerCase()}@ticker`,
  kline: (symbol: string, interval: Interval) => `${symbol.toLowerCase()}@kline_${interval}`,
  depth: (symbol: string) => `${symbol.toLowerCase()}@depth20@100ms`,
  aggTrade: (symbol: string) => `${symbol.toLowerCase()}@aggTrade`,
};

// ===== Форматы сообщений Binance (для типизации парсеров) =====

export interface BinanceMiniTicker {
  e: string;
  E: number;
  s: string; // symbol
  c: string; // close price
  o: string; // open price (24h window for miniTicker? use @ticker for full stats)
  h: string; // high
  l: string; // low
  v: string; // base volume
  q: string; // quote volume
}

export interface BinanceTicker extends BinanceMiniTicker {
  P: string; // price change percent
  p: string; // price change
  n: number; // trades count
}

export interface BinanceKlineMsg {
  e: string;
  E: number;
  s: string;
  k: {
    t: number; // open time ms
    T: number; // close time ms
    s: string;
    i: string; // interval
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    n: number; // trades
    x: boolean; // closed
    q: string;
  };
}

export interface BinanceDepthMsg {
  lastUpdateId?: number;
  U?: number;
  u?: number;
  pu?: number;
  b: [string, string][]; // bids
  a: [string, string][]; // asks
}

export interface BinanceAggTrade {
  e: string;
  E: number;
  s: string;
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean; // buyer is maker => aggressor sell
}
