import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { Candle, Exchange, Interval, MarketType } from '../../types';
import { restInterval } from '../../types';

/**
 * RTK Query API для исторических данных (CORS-friendly публичные REST эндпоинты бирж).
 * Используется для первичной загрузки свечей и списка пар; real-time идёт через WebSocket.
 */

interface KlinesArgs {
  exchange: Exchange;
  market: MarketType;
  symbol: string;
  interval: Interval;
  limit: number;
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

function binanceBaseUrl(market: MarketType): string {
  return market === 'spot' ? 'https://api.binance.com' : 'https://fapi.binance.com';
}

function bybitBaseUrl(market: MarketType): string {
  return market === 'spot' ? 'https://api.bybit.com' : 'https://api.bybit.com';
}

const cryptoApi = createApi({
  reducerPath: 'cryptoApi',
  // Базовый URL подставляется относительный — реальный адрес формируется в queryFn
  baseQuery: fetchBaseQuery({ baseUrl: '' }),
  tagTypes: ['Klines', 'Symbols'],
  endpoints: (builder) => ({
    /** Кэширование исторических данных для графиков */
    getHistoricalData: builder.query<Candle[], KlinesArgs>({
      queryFn: async ({ exchange, market, symbol, interval, limit }) => {
        try {
          if (exchange === 'binance') {
            const ri = restInterval(interval);
            const url = `${binanceBaseUrl(market)}/api/v3/klines?symbol=${symbol}&interval=${ri}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = (await res.json()) as [string | number][];
            let candles: Candle[] = rows.map((r) => ({
              time: Math.floor(Number(r[0]) / 1000),
              open: parseFloat(String(r[1])),
              high: parseFloat(String(r[2])),
              low: parseFloat(String(r[3])),
              close: parseFloat(String(r[4])),
              volume: parseFloat(String(r[5])),
              trades: Number(r[8]) || undefined,
            }));
            if (interval === '1w') candles = aggregateWeekly(candles);
            return { data: candles };
          }

          // Bybit v5
          const ri = interval === '1w' ? 'W' : interval;
          const category = market === 'spot' ? 'spot' : 'linear';
          const url =
            `${bybitBaseUrl(market)}/v5/market/kline?category=${category}&symbol=${symbol}` +
            `&interval=${ri}&limit=${Math.min(limit, 1000)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const list = (json?.result?.list ?? []) as string[][];
          // Bybit отдаёт новые свечи первыми — разворачиваем
          let candles: Candle[] = list
            .map((r) => ({
              time: Math.floor(Number(r[0]) / 1000),
              open: parseFloat(r[1]),
              high: parseFloat(r[2]),
              low: parseFloat(r[3]),
              close: parseFloat(r[4]),
              volume: parseFloat(r[5]),
            }))
            .reverse();
          if (interval === '1w') candles = aggregateWeekly(candles);
          return { data: candles };
        } catch (err) {
          return { error: { status: 500, error: err instanceof Error ? err.message : 'Fetch failed' } };
        }
      },
      providesTags: (_r, _e, args) => [{ type: 'Klines', id: `${args.exchange}|${args.market}|${args.symbol}|${args.interval}` }],
    }),

    /** Список торговых пар (USDT-котируемые) для скринера */
    getSymbols: builder.query<SymbolInfo[], { exchange: Exchange; market: MarketType }>({
      queryFn: async ({ exchange, market }) => {
        try {
          if (exchange === 'binance') {
            const url = `${binanceBaseUrl(market)}/api/v3/ticker/price`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = (await res.json()) as { symbol: string }[];
            const symbols = rows
              .map((r) => r.symbol)
              .filter((s) => s.endsWith('USDT'))
              .slice(0, 60)
              .map((symbol) => ({ symbol, baseAsset: symbol.slice(0, -4), quoteAsset: 'USDT' }));
            return { data: symbols };
          }
          const category = market === 'spot' ? 'spot' : 'linear';
          const url = `${bybitBaseUrl(market)}/v5/market/tickers?category=${category}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const list = (json?.result?.list ?? []) as { symbol: string }[];
          const symbols = list
            .filter((t) => t.symbol.endsWith('USDT'))
            .slice(0, 60)
            .map((t) => ({ symbol: t.symbol, baseAsset: t.symbol.slice(0, -4), quoteAsset: 'USDT' }));
          return { data: symbols };
        } catch (err) {
          return { error: { status: 500, error: err instanceof Error ? err.message : 'Fetch failed' } };
        }
      },
      providesTags: (_r, _e, args) => [{ type: 'Symbols', id: `${args.exchange}|${args.market}` }],
      keepUnusedDataFor: 3600,
    }),
  }),
});

function aggregateWeekly(daily: Candle[]): Candle[] {
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

export const cryptoApiSlice = cryptoApi;
export const { useGetHistoricalDataQuery, useGetSymbolsQuery } = cryptoApi;
export default cryptoApi;
