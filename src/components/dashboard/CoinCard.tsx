import { memo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { CoinRowVM } from '../../types';
import { formatCompact, formatPercent, formatPrice, formatDisplaySymbol } from '../../utils/formatters';
import { Sparkline } from '../charts/Sparkline';
import { cn } from '../../utils/cn';

export const TrendBadge = memo(function TrendBadge({ trend }: { trend: CoinRowVM['trend'] }) {
  if (trend === 'bullish')
    return (
      <span className="inline-flex items-center gap-1 text-success text-xs">
        <ArrowUpRight className="h-3.5 w-3.5" /> Бычий
      </span>
    );
  if (trend === 'bearish')
    return (
      <span className="inline-flex items-center gap-1 text-destructive text-xs">
        <ArrowDownRight className="h-3.5 w-3.5" /> Медвежий
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
      <Minus className="h-3.5 w-3.5" /> Нейтр.
    </span>
  );
});

interface Props {
  row: CoinRowVM;
  onClick: () => void;
}

/** Карточка монеты для grid-режима главной страницы */
function CoinCardInner({ row, onClick }: Props) {
  const positive = row.change24h >= 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{formatDisplaySymbol(row.symbol)}</div>
          <div className="text-[11px] uppercase text-muted-foreground">
            {row.exchange} · {row.market}
          </div>
        </div>
        <TrendBadge trend={row.trend} />
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="price-pulse text-lg font-bold tabular-nums">{formatPrice(row.price)}</div>
          <div className={cn('text-sm font-medium tabular-nums', positive ? 'text-success' : 'text-destructive')}>
            {formatPercent(row.change24h)}
          </div>
        </div>
        <Sparkline data={row.sparkline} width={96} height={36} />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Объём: {formatCompact(row.volume24h)}</span>
        <span className="truncate max-w-[55%]" title={`S: ${row.supportLevels.map(formatPrice).join(', ')}`}>
          S/R: {row.supportLevels.length}/{row.resistanceLevels.length}
        </span>
      </div>
    </button>
  );
}

export const CoinCard = memo(CoinCardInner);
