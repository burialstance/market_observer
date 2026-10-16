import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List, Search, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../store/hooks';
import { useFilters, useFavorites, useGoToCoin } from '../../hooks';
import { useGetSymbolsQuery } from '../../store/api/cryptoApi';
import { wsManager } from '../../services/websocket/manager';
import {
  calculateSupportResistance,
  trendFromCandles,
} from '../../utils/calculations';
import { formatDisplaySymbol } from '../../utils/formatters';
import type { CoinRowVM, Exchange, Interval, MarketType, TickerData } from '../../types';
import { pairKey } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { CoinTableRow } from './CoinTable';
import { CoinCard } from './CoinCard';
import { cn } from '../../utils/cn';

/** Символы, для которых держим live-свечи (sparkline + S/R + тренд) */
const SPARK_INTERVAL: Interval = '15m';
const SPARK_LIMIT = 40;
const MAX_LIVE_PAIRS = 36; // лимит подписок на соединение

interface SparkCacheEntry {
  closes: number[];
  support: number[];
  resistance: number[];
  trend: CoinRowVM['trend'];
}

type ViewMode = 'table' | 'cards';

export function ScreenerList() {
  const settings = useAppSelector((s) => s.settings.value);
  const tickers = useAppSelector((s) => s.tickers.items);
  const { filters, update } = useFilters();
  const { favorites, toggleFavorite } = useFavorites();
  const goToCoin = useGoToCoin();
  const [view, setView] = useState<ViewMode>('table');
  const [, forceTick] = useState(0);

  // Список пар по активным биржам/рынкам
  const combos = useMemo(() => {
    const out: { exchange: Exchange; market: MarketType }[] = [];
    for (const ex of settings.exchanges) for (const m of settings.markets) out.push({ exchange: ex, market: m });
    return out;
  }, [settings.exchanges, settings.markets]);

  const binanceSpot = useGetSymbolsQuery({ exchange: 'binance', market: 'spot' }, { skip: !combos.some((c) => c.exchange === 'binance' && c.market === 'spot') });
  const binanceFut = useGetSymbolsQuery({ exchange: 'binance', market: 'futures' }, { skip: !combos.some((c) => c.exchange === 'binance' && c.market === 'futures') });
  const bybitSpot = useGetSymbolsQuery({ exchange: 'bybit', market: 'spot' }, { skip: !combos.some((c) => c.exchange === 'bybit' && c.market === 'spot') });
  const bybitFut = useGetSymbolsQuery({ exchange: 'bybit', market: 'futures' }, { skip: !combos.some((c) => c.exchange === 'bybit' && c.market === 'futures') });

  const allSymbols = useMemo(() => {
    const rows: { key: string; symbol: string; exchange: Exchange; market: MarketType }[] = [];
    const add = (q: typeof binanceSpot, exchange: Exchange, market: MarketType) => {
      for (const s of q.data ?? []) {
        rows.push({ key: pairKey(exchange, market, s.symbol), symbol: s.symbol, exchange, market });
      }
    };
    add(binanceSpot, 'binance', 'spot');
    add(binanceFut, 'binance', 'futures');
    add(bybitSpot, 'bybit', 'spot');
    add(bybitFut, 'bybit', 'futures');
    return rows;
  }, [binanceSpot.data, binanceFut.data, bybitSpot.data, bybitFut.data]);

  // Подписка на тикеры всех видимых пар (после фильтрации по бирже/поиску)
  const visiblePairs = useMemo(() => {
    let pairs = allSymbols;
    if (filters.exchange !== 'all') pairs = pairs.filter((p) => p.exchange === filters.exchange);
    if (filters.market !== 'all') pairs = pairs.filter((p) => p.market === filters.market);
    if (filters.search.trim()) {
      const q = filters.search.trim().toUpperCase();
      pairs = pairs.filter((p) => p.symbol.toUpperCase().includes(q));
    }
    return pairs;
  }, [allSymbols, filters.exchange, filters.market, filters.search]);

  const tickerKeysRef = useRef<string[]>([]);
  useEffect(() => {
    const keys = visiblePairs.map((p) => p.key);
    tickerKeysRef.current = keys;
    const unsubs = keys.map((k) => wsManager.subscribeTicker(k, () => {}));
    return () => {
      for (const u of unsubs) u();
    };
  }, [visiblePairs]);

  // Live-свечи для топ-N пар (экономия подписок): N ограничено сверху
  const sparkKeys = useMemo(() => visiblePairs.slice(0, MAX_LIVE_PAIRS).map((p) => p.key), [visiblePairs]);
  const sparkCache = useRef<Map<string, SparkCacheEntry>>(new Map());

  const ensureSpark = useCallback((key: string, interval: string) => {
    const cache = sparkCache.current;
    if (!cache.has(key)) {
      cache.set(key, { closes: [], support: [], resistance: [], trend: 'neutral' });
    }
    void interval;
  }, []);

  useEffect(() => {
    const unsubs = sparkKeys.map((k) => {
      ensureSpark(k, SPARK_INTERVAL);
      return wsManager.subscribeKline(k, SPARK_INTERVAL, (payload) => {
        const candle = payload as { close: number; high: number; low: number; time: number };
        const entry = sparkCache.current.get(k)!;
        // Массив фиксированной длины — без утечек памяти
        if (entry.closes.length >= SPARK_LIMIT) entry.closes.shift();
        entry.closes.push(candle.close);
        // Пересчёт S/R и тренда редко — раз на закрытие ~каждой 10-й свечи
        if (entry.closes.length % 10 === 0) {
          const fake = entry.closes.map((c) => ({ time: candle.time, open: c, high: candle.high, low: candle.low, close: c, volume: 0 }));
          const sr = calculateSupportResistance(fake, 40);
          entry.support = sr.support;
          entry.resistance = sr.resistance;
          entry.trend = trendFromCandles(fake);
        }
      });
    });
    return () => {
      for (const u of unsubs) u();
    };
  }, [sparkKeys, ensureSpark]);

  // Периодический ре-рендер списка для актуализации sparkline/S-R из ref-кэша
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), Math.max(5, settings.refreshIntervalSec) * 1000);
    return () => clearInterval(t);
  }, [settings.refreshIntervalSec]);

  // Сборка ViewModel
  const rows: CoinRowVM[] = useMemo(() => {
    return visiblePairs.map((p) => {
      const t: TickerData | undefined = tickers[p.key];
      const spark = sparkCache.current.get(p.key);
      return {
        key: p.key,
        symbol: p.symbol,
        displaySymbol: formatDisplaySymbol(p.symbol),
        exchange: p.exchange,
        market: p.market,
        price: t?.price ?? 0,
        change24h: t?.changePercent24h ?? 0,
        volume24h: t?.quoteVolume24h ?? 0,
        sparkline: spark?.closes ?? [],
        supportLevels: spark?.support ?? [],
        resistanceLevels: spark?.resistance ?? [],
        trend: spark?.trend ?? 'neutral',
        updatedAt: t?.updatedAt ?? 0,
      };
    });
  }, [visiblePairs, tickers]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = filters.sortDir === 'asc' ? 1 : -1;
    switch (filters.sortBy) {
      case 'price':
        arr.sort((a, b) => (a.price - b.price) * dir);
        break;
      case 'change':
        arr.sort((a, b) => (a.change24h - b.change24h) * dir);
        break;
      case 'volume':
        arr.sort((a, b) => (a.volume24h - b.volume24h) * dir);
        break;
      case 'alpha':
        arr.sort((a, b) => a.displaySymbol.localeCompare(b.displaySymbol) * dir);
        break;
    }
    return arr;
  }, [rows, filters.sortBy, filters.sortDir]);

  const isLoadingAny =
    (binanceSpot.isLoading || bybitSpot.isLoading) && !binanceSpot.data && !bybitSpot.data;

  const sortToggle = (col: typeof filters.sortBy) => {
    if (filters.sortBy === col) {
      update({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      update({ sortBy: col, sortDir: 'desc' });
    }
  };

  const SortIcon = ({ col }: { col: typeof filters.sortBy }) =>
    filters.sortBy !== col ? (
      <ArrowUpDown className="ml-1 h-3 w-3 inline" />
    ) : filters.sortDir === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );

  return (
    <div className="space-y-4">
      {/* Панель фильтров */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Поиск монеты (BTC, ETH...)"
            className="pl-8"
            aria-label="Поиск по названию монеты"
          />
        </div>

        <Select value={filters.exchange} onValueChange={(v) => update({ exchange: v as never })}>
          <SelectTrigger className="w-[140px]" aria-label="Фильтр по бирже">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все биржи</SelectItem>
            <SelectItem value="binance">Binance</SelectItem>
            <SelectItem value="bybit">Bybit</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.market} onValueChange={(v) => update({ market: v as never })}>
          <SelectTrigger className="w-[130px]" aria-label="Фильтр по категории">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Spot + Futures</SelectItem>
            <SelectItem value="spot">Spot</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('table')} aria-label="Табличный вид">
            <List className="h-4 w-4" />
          </Button>
          <Button variant={view === 'cards' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('cards')} aria-label="Карточный вид">
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Link to="/settings">
            <Button variant="ghost" size="sm" aria-label="Настройки">
              <Settings2 className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {isLoadingAny ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground">
          Нет пар, соответствующих фильтрам.
          <div className="mt-2 text-xs">
            Проверьте активные биржи в <Link className="underline" to="/settings">настройках</Link>.
          </div>
        </div>
      ) : view === 'table' ? (
        <div className="rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                <TableHead>
                  <button className="font-medium" onClick={() => sortToggle('alpha')}>
                    Пара <SortIcon col="alpha" />
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button className="font-medium" onClick={() => sortToggle('price')}>
                    Цена <SortIcon col="price" />
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button className="font-medium" onClick={() => sortToggle('change')}>
                    24ч % <SortIcon col="change" />
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button className="font-medium" onClick={() => sortToggle('volume')}>
                    Объём 24ч <SortIcon col="volume" />
                  </button>
                </TableHead>
                <TableHead>График</TableHead>
                <TableHead className="hidden text-right md:table-cell">S / R</TableHead>
                <TableHead>Тренд</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <CoinTableRow
                  key={row.key}
                  row={row}
                  isFavorite={favorites.includes(row.key)}
                  onToggleFavorite={toggleFavorite}
                  onClick={goToCoin}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.slice(0, 120).map((row) => (
              <CoinCard key={row.key} row={row} onClick={() => goToCoin(row.key)} />
            ))}
          </div>
          {sorted.length > 120 && (
            <Badge variant="secondary" className={cn('block text-center')}>
              Показаны первые 120 из {sorted.length}
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
