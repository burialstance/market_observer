import { useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../store/hooks';
import { updateTicker } from '../store/slices';
import { wsManager } from '../services/websocket/manager';
import type { Candle, OrderBookSnapshot, TickerData, TradeRecord } from '../types';

/** Подписка на real-time тикер пары; данные пишутся в Redux (tickers.items) */
export function useWsTicker(key: string): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!key) return;
    const unsub = wsManager.subscribeTicker(key, (payload) => {
      dispatch(updateTicker(payload as TickerData));
    });
    return unsub;
  }, [key, dispatch]);
}

const MAX_CANDLES = 500;

/**
 * Исторические свечи через RTK Query + live-обновления через WebSocket.
 * Возвращает локальный буфер свечей, обновляемый без ре-рендера на каждый тик
 * (данные мутируются в ref; version — троттлированный счётчик для подписчиков).
 */
export function useLiveCandles(
  key: string,
  interval: string,
  historical: Candle[] | undefined,
  isLoading: boolean,
): { getCandles: () => Candle[]; version: number } {
  const bufferRef = useRef<Candle[]>([]);
  const [version, setVersion] = useState(0);
  const throttleRef = useRef(0);

  // Синхронизация с историческими данными из кэша RTK Query
  useEffect(() => {
    if (historical && historical.length) {
      bufferRef.current = historical.slice(-MAX_CANDLES);
      setVersion((v) => v + 1);
    }
  }, [historical, isLoading]);

  useEffect(() => {
    if (!key || !interval) return;
    const unsub = wsManager.subscribeKline(key, interval, (payload) => {
      const candle = payload as Candle;
      const buf = bufferRef.current;
      const last = buf[buf.length - 1];
      if (last && last.time === candle.time) {
        buf[buf.length - 1] = candle;
      } else if (!last || candle.time > last.time) {
        buf.push(candle);
        if (buf.length > MAX_CANDLES) buf.splice(0, buf.length - MAX_CANDLES);
      }
      // Троттлинг уведомления UI — не чаще раза в ~300мс
      const now = Date.now();
      if (now - throttleRef.current > 300) {
        throttleRef.current = now;
        setVersion((v) => v + 1);
      }
    });
    return unsub;
  }, [key, interval]);

  return { getCandles: () => bufferRef.current, version };
}

/** Стакан (order book) по ключу пары */
export function useOrderBook(key: string, enabled: boolean): OrderBookSnapshot | null {
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  useEffect(() => {
    if (!key || !enabled) return;
    let raf = 0;
    const unsub = wsManager.subscribeDepth(key, (payload) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBook(payload as OrderBookSnapshot));
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [key, enabled]);
  return book;
}

/** Лента последних сделок (до 50) */
export function useTrades(key: string, enabled: boolean): TradeRecord[] {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  useEffect(() => {
    if (!key || !enabled) {
      setTrades([]);
      return;
    }
    let batch: TradeRecord[] = [];
    const flush = setInterval(() => {
      if (batch.length === 0) return;
      const b = batch;
      batch = [];
      setTrades((prev) => [...b.reverse(), ...prev].slice(0, 50));
    }, 500);
    const unsub = wsManager.subscribeTrades(key, (payload) => {
      batch.push(payload as TradeRecord);
    });
    return () => {
      clearInterval(flush);
      unsub();
    };
  }, [key, enabled]);
  return trades;
}
