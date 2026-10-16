import type {
  Candle,
  Exchange,
  MarketType,
  OrderBookSnapshot,
  TickerData,
  TradeRecord,
} from '../../types';
import { pairKey } from '../../types';
import { BaseWsClient } from './base';
import { BinanceWsClient, binanceStreams } from './binance';
import type {
  BinanceAggTrade,
  BinanceDepthMsg,
  BinanceKlineMsg,
  BinanceTicker,
} from './binance';
import { BybitWsClient, bybitTopics } from './bybit';
import type {
  BybitKlineItem,
  BybitOrderbookMsg,
  BybitTickerSpot,
  BybitTradeItem,
  BybitWsMessage,
} from './bybit';

/**
 * Менеджер WebSocket-подключений (синглтон).
 * Поддерживает до 4 соединений: binance|spot, binance|futures, bybit|spot, bybit|linear.
 * Нормализует данные бирж в единый формат и диспетчеризует подписки UI по ключу пары.
 */

import type { WsStatus } from './base';

type Listener = (payload: unknown) => void;

interface PairSubs {
  tickers: Set<Listener>;
  klines: Map<string /*interval*/, Set<Listener>>;
  depth: Set<Listener>;
  trades: Set<Listener>;
}

class WsManager {
  private clients = new Map<string, BaseWsClient>();
  /** key -> listeners */
  private subs = new Map<string, PairSubs>();
  /** key -> текущий интервал свечной подписки */
  private klineInterval = new Map<string, string>();
  /** key -> статус соединения его биржи */
  private statusListeners = new Set<(ex: Exchange, market: MarketType, status: WsStatus) => void>();
  private statuses = new Map<string, WsStatus>();

  /** Экономия трафика: тикеры раз в 5с вместо ~1с */
  private economyMode = false;

  setEconomyMode(on: boolean): void {
    if (this.economyMode === on) return;
    this.economyMode = on;
    // Пересобрать все ticker-подписки с новой частотой
    for (const [key] of this.subs) {
      const { exchange, market, symbol } = parse(key);
      const client = this.getClient(exchange, market);
      if (!client) continue;
      client.unsubscribe(tickerStream(exchange, market, symbol, !on));
      client.subscribe(tickerStream(exchange, market, symbol, on));
    }
  }

  getStatuses(): Record<string, WsStatus> {
    const out: Record<string, WsStatus> = {};
    for (const [k, v] of this.statuses) out[k] = v;
    return out;
  }

  onStatus(cb: (ex: Exchange, market: MarketType, status: WsStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  subscribeTicker(key: string, cb: Listener): () => void {
    return this.addListener(key, 'tickers', cb);
  }

  subscribeKline(key: string, interval: string, cb: Listener): () => void {
    const s = this.ensureSubs(key);
    const prevInterval = this.klineInterval.get(key);
    if (prevInterval && prevInterval !== interval) {
      const { exchange, market, symbol } = parse(key);
      this.getClient(exchange, market)?.unsubscribe(
        streamName(exchange, market, symbol, 'klines', prevInterval, this.economyMode),
      );
      s.klines.clear();
    }
    this.klineInterval.set(key, interval);
    return this.addListener(key, 'klines', cb, interval);
  }

  subscribeDepth(key: string, cb: Listener): () => void {
    return this.addListener(key, 'depth', cb);
  }

  subscribeTrades(key: string, cb: Listener): () => void {
    return this.addListener(key, 'trades', cb);
  }

  private addListener(key: string, kind: 'tickers' | 'depth' | 'trades', cb: Listener): () => void;
  private addListener(key: string, kind: 'klines', cb: Listener, interval: string): () => void;
  private addListener(
    key: string,
    kind: 'tickers' | 'klines' | 'depth' | 'trades',
    cb: Listener,
    interval?: string,
  ): () => void {
    const s = this.ensureSubs(key);
    let set: Set<Listener>;
    if (kind === 'klines') {
      set = getOrCreateKlineSet(s, interval!);
    } else {
      set = s[kind];
    }
    const wasEmpty = set.size === 0;
    set.add(cb);
    if (wasEmpty) this.activateRemote(key, kind, interval);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.deactivateRemote(key, kind, interval);
    };
  }

  private ensureSubs(key: string): PairSubs {
    let s = this.subs.get(key);
    if (!s) {
      s = { tickers: new Set(), klines: new Map(), depth: new Set(), trades: new Set() };
      this.subs.set(key, s);
    }
    return s;
  }

  private activateRemote(key: string, kind: StreamKind, interval?: string): void {
    const { exchange, market, symbol } = parse(key);
    const client = this.getClient(exchange, market);
    if (!client) return;
    client.subscribe(streamName(exchange, market, symbol, kind, interval, this.economyMode));
  }

  private deactivateRemote(key: string, kind: StreamKind, interval?: string): void {
    const { exchange, market, symbol } = parse(key);
    const client = this.getClient(exchange, market);
    if (!client) return;
    client.unsubscribe(streamName(exchange, market, symbol, kind, interval, this.economyMode));
  }

  private getClient(exchange: Exchange, market: MarketType): BaseWsClient | null {
    const ck = `${exchange}|${market}`;
    let client = this.clients.get(ck);
    if (client) return client;
    try {
      client =
        exchange === 'binance' ? new BinanceWsClient(market) : new BybitWsClient(market);
    } catch {
      return null;
    }
    client.onMessage = (data) => this.dispatch(ck, data);
    client.onStatusChange = (status) => {
      this.statuses.set(ck, status);
      for (const cb of this.statusListeners) cb(exchange, market, status);
    };
    this.clients.set(ck, client);
    client.connect();
    return client;
  }

  /** Нормализация и маршрутизация входящих сообщений */
  private dispatch(connKey: string, raw: unknown): void {
    const [exchangeStr, marketStr] = connKey.split('|');
    const exchange = exchangeStr as Exchange;
    const market = marketStr as MarketType;

    if (exchange === 'binance') {
      this.dispatchBinance(exchange, market, raw);
    } else {
      this.dispatchBybit(exchange, market, raw);
    }
  }

  private emit(key: string, kind: StreamKind, payload: unknown, interval?: string): void {
    const s = this.subs.get(key);
    if (!s) return;
    let set: Set<Listener> | undefined;
    if (kind === 'klines') set = s.klines.get(interval ?? '');
    else set = s[kind];
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        /* listener error isolation */
      }
    }
  }

  // ===== Binance =====

  private dispatchBinance(exchange: Exchange, market: MarketType, raw: unknown): void {
    const obj = raw as Record<string, unknown>;
    const evType = obj?.e as string | undefined;
    const symbol = obj?.s as string | undefined;
    if (!symbol) return;
    const key = pairKey(exchange, market, symbol);

    switch (evType) {
      case '24hrTicker': {
        const t = obj as unknown as BinanceTicker;
        const ticker: TickerData = {
          symbol,
          exchange,
          market,
          price: parseFloat(t.c),
          change24h: parseFloat(t.p ?? '0'),
          changePercent24h: parseFloat(t.P ?? '0'),
          high24h: parseFloat(t.h),
          low24h: parseFloat(t.l),
          volume24h: parseFloat(t.v),
          quoteVolume24h: parseFloat(t.q),
          updatedAt: Date.now(),
        };
        this.emit(key, 'tickers', ticker);
        break;
      }
      case 'kline': {
        const k = obj as unknown as BinanceKlineMsg;
        const candle: Candle = {
          time: Math.floor(k.k.t / 1000),
          open: parseFloat(k.k.o),
          high: parseFloat(k.k.h),
          low: parseFloat(k.k.l),
          close: parseFloat(k.k.c),
          volume: parseFloat(k.k.v),
          closeTime: k.k.T,
          trades: k.k.n,
        };
        this.emit(key, 'klines', candle, k.k.i);
        break;
      }
      default:
        break;
    }

    // Depth/aggTrade не имеют поля e — различаем по форме
    if (!evType) {
      if ('bids' in obj || 'asks' in obj || 'b' in obj) {
        const d = obj as unknown as BinanceDepthMsg & { bids?: [string, string][]; asks?: [string, string][] };
        const bidsRaw = (d.bids ?? d.b ?? []) as [string, string][];
        const asksRaw = (d.asks ?? d.a ?? []) as [string, string][];
        const book: OrderBookSnapshot = {
          bids: bidsRaw.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
          asks: asksRaw.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
          updatedAt: Date.now(),
        };
        this.emit(key, 'depth', book);
      } else if ('p' in obj && 'q' in obj && 'T' in obj) {
        const tr = obj as unknown as BinanceAggTrade;
        const trade: TradeRecord = {
          id: String(tr.a),
          price: parseFloat(tr.p),
          quantity: parseFloat(tr.q),
          time: tr.T,
          side: tr.m ? 'sell' : 'buy',
        };
        this.emit(key, 'trades', trade);
      }
    }
  }

  // ===== Bybit =====

  private dispatchBybit(exchange: Exchange, market: MarketType, raw: unknown): void {
    const msg = raw as BybitWsMessage;
    if (!msg?.topic) return;
    const parts = msg.topic.split('.');
    const kind = parts[0];

    if (kind === 'tickers') {
      const symbol = parts[1];
      const key = pairKey(exchange, market, symbol);
      const d = msg.data as BybitTickerSpot;
      if (!d || d.lastPrice == null) return;
      const pct = parseFloat(d.price24hPcnt ?? '0') * 100;
      const price = parseFloat(d.lastPrice);
      const ticker: TickerData = {
        symbol,
        exchange,
        market,
        price,
        change24h: (price * pct) / (100 + pct || 1),
        changePercent24h: pct,
        high24h: parseFloat(d.highPrice24h ?? '0'),
        low24h: parseFloat(d.lowPrice24h ?? '0'),
        volume24h: parseFloat(d.volume24h ?? '0'),
        quoteVolume24h: parseFloat(d.turnover24h ?? '0'),
        updatedAt: Date.now(),
      };
      this.emit(key, 'tickers', ticker);
      return;
    }

    if (kind === 'kline') {
      const interval = parts[1];
      const symbol = parts[2];
      const key = pairKey(exchange, market, symbol);
      const items = msg.data as BybitKlineItem[];
      const last = items?.[items.length - 1];
      if (!last) return;
      const candle: Candle = {
        time: Math.floor(last.start / 1000),
        open: parseFloat(last.open),
        high: parseFloat(last.high),
        low: parseFloat(last.low),
        close: parseFloat(last.close),
        volume: parseFloat(last.volume),
        closeTime: last.end,
      };
      this.emit(key, 'klines', candle, interval);
      return;
    }

    if (kind === 'orderbook') {
      const symbol = parts[2];
      const key = pairKey(exchange, market, symbol);
      const d = msg.data as BybitOrderbookMsg;
      const book: OrderBookSnapshot = {
        bids: (d.b ?? []).map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
        asks: (d.a ?? []).map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
        updatedAt: msg.ts ?? Date.now(),
      };
      this.emit(key, 'depth', book);
      return;
    }

    if (kind === 'publicTrade') {
      const symbol = parts[1];
      const key = pairKey(exchange, market, symbol);
      const items = msg.data as BybitTradeItem[];
      for (const it of items ?? []) {
        const trade: TradeRecord = {
          id: it.i,
          price: parseFloat(it.p),
          quantity: parseFloat(it.v),
          time: it.T,
          side: it.S === 'Buy' ? 'buy' : 'sell',
        };
        this.emit(key, 'trades', trade);
      }
    }
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) client.disconnect();
    this.clients.clear();
    this.statuses.clear();
  }
}

type StreamKind = 'tickers' | 'klines' | 'depth' | 'trades';

function getOrCreateKlineSet(s: PairSubs, interval: string): Set<Listener> {
  let set = s.klines.get(interval);
  if (!set) {
    set = new Set();
    s.klines.set(interval, set);
  }
  return set;
}

function parse(key: string) {
  const [exchange, market, symbol] = key.split('|');
  return { exchange: exchange as Exchange, market: market as MarketType, symbol };
}

function tickerStream(exchange: Exchange, market: MarketType, symbol: string, economy: boolean): string {
  if (exchange === 'binance') {
    return economy ? binanceStreams.ticker(symbol) + '@5s' : binanceStreams.ticker(symbol);
  }
  return bybitTopics.ticker(symbol);
}

function streamName(
  exchange: Exchange,
  _market: MarketType,
  symbol: string,
  kind: StreamKind,
  interval?: string,
  economy = false,
): string {
  if (exchange === 'binance') {
    switch (kind) {
      case 'tickers':
        return tickerStream(exchange, _market, symbol, economy);
      case 'klines':
        return binanceStreams.kline(symbol, interval as never);
      case 'depth':
        return binanceStreams.depth(symbol);
      case 'trades':
        return binanceStreams.aggTrade(symbol);
    }
  }
  switch (kind) {
    case 'tickers':
      return bybitTopics.ticker(symbol);
    case 'klines':
      return bybitTopics.kline(symbol, interval ?? '1m');
    case 'depth':
      return bybitTopics.orderbook(symbol);
    case 'trades':
      return bybitTopics.trades(symbol);
  }
}

export const wsManager = new WsManager();
