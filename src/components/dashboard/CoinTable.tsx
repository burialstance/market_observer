import { memo, useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import type { CoinRowVM } from '../../types';
import { formatCompact, formatPercent, formatPrice, formatDisplaySymbol } from '../../utils/formatters';
import { Sparkline } from '../charts/Sparkline';
import { TrendBadge } from './CoinCard';
import { cn } from '../../utils/cn';

interface RowProps {
  row: CoinRowVM;
  isFavorite: boolean;
  onToggleFavorite: (key: string) => void;
  onClick: (key: string) => void;
}

/** Строка таблицы монет с цветовой пульсацией при изменении цены */
const CoinTableRow = memo(function CoinTableRow({ row, isFavorite, onToggleFavorite, onClick }: RowProps) {
  const prevPrice = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const p = prevPrice.current;
    if (p != null && row.price !== p) {
      setFlash(row.price > p ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 600);
      prevPrice.current = row.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = row.price;
  }, [row.price]);

  const positive = row.change24h >= 0;

  return (
    <tr
      onClick={() => onClick(row.key)}
      className="cursor-pointer border-b transition-colors hover:bg-muted/50"
    >
      <td className="px-2 py-[var(--row-pad)]">
        <button
          aria-label={isFavorite ? 'Убрать из избранного' : 'В избранное'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(row.key);
          }}
          className={cn('text-muted-foreground hover:text-yellow-400', isFavorite && 'text-yellow-400')}
        >
          <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </td>
      <td className="px-2 py-[var(--row-pad)] font-medium whitespace-nowrap">
        {formatDisplaySymbol(row.symbol)}
        <div className="text-[10px] uppercase text-muted-foreground">
          {row.exchange} · {row.market}
        </div>
      </td>
      <td
        className={cn(
          'px-2 py-[var(--row-pad)] text-right font-semibold tabular-nums rounded-sm',
          flash === 'up' && 'animate-price-up',
          flash === 'down' && 'animate-price-down',
        )}
      >
        {formatPrice(row.price)}
      </td>
      <td
        className={cn(
          'px-2 py-[var(--row-pad)] text-right tabular-nums font-medium',
          positive ? 'text-success' : 'text-destructive',
        )}
      >
        {formatPercent(row.change24h)}
      </td>
      <td className="px-2 py-[var(--row-pad)] text-right tabular-nums text-muted-foreground">
        {formatCompact(row.volume24h)}
      </td>
      <td className="px-2 py-[var(--row-pad)]">
        <Sparkline data={row.sparkline} width={100} height={28} />
      </td>
      <td className="hidden px-2 py-[var(--row-pad)] text-right text-xs md:table-cell">
        <span className="text-success">{row.supportLevels.length}</span>
        {' / '}
        <span className="text-destructive">{row.resistanceLevels.length}</span>
      </td>
      <td className="px-2 py-[var(--row-pad)]">
        <TrendBadge trend={row.trend} />
      </td>
    </tr>
  );
});

export { CoinTableRow };
