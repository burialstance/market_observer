import { memo, useEffect, useRef } from 'react';
import type { OrderBookSnapshot, TradeRecord } from '../../types';
import { formatPrice, formatNumber, formatTime } from '../../utils/formatters';
import { cn } from '../../utils/cn';

/** Глубина рынка (order book snapshot из WebSocket) */
export const OrderBook = memo(function OrderBook({ book }: { book: OrderBookSnapshot | null }) {
  if (!book || book.bids.length === 0) {
    return <div className="p-4 text-center text-xs text-muted-foreground">Нет данных стакана</div>;
  }
  const maxQty = Math.max(
    ...book.bids.slice(0, 12).map((l) => l.quantity),
    ...book.asks.slice(0, 12).map((l) => l.quantity),
    1,
  );
  const bids = book.bids.slice(0, 12);
  const asks = book.asks.slice(0, 12).reverse();

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">Стакан (глубина рынка)</h3>
      <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
        <div>
          {asks.map((l, i) => (
            <div key={i} className="relative flex justify-between px-1 py-0.5">
              <span
                className="absolute inset-y-0 right-0 bg-destructive/15"
                style={{ width: `${(l.quantity / maxQty) * 100}%` }}
              />
              <span className="relative text-destructive">{formatPrice(l.price)}</span>
              <span className="relative text-muted-foreground">{formatNumber(l.quantity, 3)}</span>
            </div>
          ))}
        </div>
        <div>
          {bids.map((l, i) => (
            <div key={i} className="relative flex justify-between px-1 py-0.5">
              <span
                className="absolute inset-y-0 right-0 bg-success/15"
                style={{ width: `${(l.quantity / maxQty) * 100}%` }}
              />
              <span className="relative text-success">{formatPrice(l.price)}</span>
              <span className="relative text-muted-foreground">{formatNumber(l.quantity, 3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/** Лента последних сделок с выделением крупных */
export const TradesList = memo(function TradesList({ trades }: { trades: TradeRecord[] }) {
  const avgRef = useRef(0);
  useEffect(() => {
    if (trades.length > 0) {
      const sum = trades.reduce((s, t) => s + t.quantity, 0);
      avgRef.current = sum / trades.length;
    }
  }, [trades]);

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">Последние сделки</h3>
      {trades.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Ожидание сделок…</div>
      ) : (
        <div className="max-h-72 overflow-auto text-xs tabular-nums">
          <table className="w-full">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="font-normal">Время</th>
                <th className="font-normal text-right">Цена</th>
                <th className="font-normal text-right">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr
                  key={t.id}
                  className={cn(
                    'border-b border-border/40',
                    t.quantity > avgRef.current * 5 && 'bg-yellow-500/10',
                  )}
                  title={t.quantity > avgRef.current * 5 ? 'Крупная сделка' : undefined}
                >
                  <td className="py-0.5 text-muted-foreground">{formatTime(t.time)}</td>
                  <td className={cn('text-right', t.side === 'buy' ? 'text-success' : 'text-destructive')}>
                    {formatPrice(t.price)}
                  </td>
                  <td className="text-right">{formatNumber(t.quantity, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
