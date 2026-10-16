import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, X } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { setSettings } from '../../store/slices';
import { wsManager } from '../../services/websocket/manager';
import type { Exchange, MarketType } from '../../types';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../utils/cn';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  closed: 'bg-gray-500',
  error: 'bg-red-500',
};

export function Header() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.settings.value.theme);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const toastRef = useRef<HTMLDivElement | null>(null);

  // Индикация статусов WS-соединений (graceful degradation при потере связи)
  useEffect(() => {
    const refresh = () => setStatuses(wsManager.getStatuses());
    refresh();
    const unsub = wsManager.onStatus(refresh);
    return unsub;
  }, []);

  const toggleTheme = useCallback(
    () => dispatch(setSettings({ theme: theme === 'dark' ? 'light' : 'dark' })),
    [dispatch, theme],
  );

  const connEntries = Object.entries(statuses);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-primary">₿</span>
          <span className="hidden sm:inline">Crypto Screener</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link to="/" className="rounded-md px-3 py-1.5 hover:bg-accent">
            Скринер
          </Link>
          <Link to="/settings" className="rounded-md px-3 py-1.5 hover:bg-accent">
            Настройки
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Статусы подключений */}
          <div className="hidden items-center gap-2 md:flex" aria-label="Статусы WebSocket">
            {connEntries.length === 0 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                offline
              </Badge>
            )}
            {connEntries.map(([connKey, status]) => {
              const [ex, mk] = connKey.split('|');
              return (
                <span key={connKey} title={`${ex} ${mk}: ${status}`} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', STATUS_COLORS[status] ?? 'bg-gray-500')} />
                  {ex.slice(0, 1).toUpperCase()}
                  {mk === 'spot' ? 'S' : 'F'}
                </span>
              );
            })}
          </div>

          {/* Баннер ошибки соединения */}
          {connEntries.some(([, s]) => s === 'error' || s === 'closed') && (
            <div
              ref={toastRef}
              className="hidden items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive lg:flex"
            >
              Нет соединения — показаны данные из кэша. Идёт переподключение…
              <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => (toastRef.current.style.display = 'none')}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Переключить тему">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Активные биржи для бейджей в футере */
export function Footer() {
  const { exchanges, markets } = useAppSelector((s) => s.settings.value);
  const fmt = (list: (Exchange | MarketType)[]) => list.map((x) => String(x)).join(', ');
  return (
    <footer className="border-t py-3 text-center text-xs text-muted-foreground">
      Данные: {fmt(exchanges)} · {fmt(markets)} · Только клиентская обработка, API-ключи не используются.
    </footer>
  );
}
