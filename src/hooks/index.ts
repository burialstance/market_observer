import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSettings, toggleFavorite } from '../store/slices';
import { wsManager } from '../services/websocket/manager';
import type { Exchange, MarketType } from '../types';

/** Тема приложения: класс `dark` на <html> + синхронизация с настройками */
export function useTheme(): void {
  const theme = useAppSelector((s) => s.settings.value.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);
}

/** Плотность и размер шрифта через CSS-переменные на корне */
export function useAppearanceVars(): void {
  const { density, fontSize } = useAppSelector((s) => s.settings.value);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--row-pad', density === 'compact' ? '0.25rem' : '0.625rem');
    root.style.setProperty('--base-font-size', fontSize === 'sm' ? '14px' : fontSize === 'lg' ? '18px' : '16px');
    document.body.style.fontSize = 'var(--base-font-size)';
  }, [density, fontSize]);
}

/** Диспетчер соединений: держит WS-клиенты активными только для выбранных бирж/рынков */
export function useConnectionBootstrap(): void {
  const { exchanges, markets, economyMode } = useAppSelector((s) => s.settings.value);
  useEffect(() => {
    wsManager.setEconomyMode(economyMode);
  }, [economyMode]);
  // Менеджер создаёт соединения лениво при первой подписке; здесь лишь логируем состав.
  const comboKey = useMemo(() => [...exchanges].sort().join(',') + '|' + [...markets].sort().join(','), [exchanges, markets]);
  useEffect(() => {
    // При смене конфигурации неиспользуемые соединения закроются garbage-collection'ом подписок
    void comboKey;
  }, [comboKey]);
}

export interface FilterState {
  search: string;
  exchange: 'all' | Exchange;
  market: 'all' | MarketType;
  sortBy: 'price' | 'change' | 'volume' | 'alpha';
  sortDir: 'asc' | 'desc';
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  exchange: 'all',
  market: 'all',
  sortBy: 'volume',
  sortDir: 'desc',
};

/** Фильтры главной страницы с сохранением активной конфигурации в sessionStorage */
export function useFilters() {
  const stored = useRef<FilterState | null>(null);
  if (stored.current === null) {
    try {
      const raw = sessionStorage.getItem('cs.session.filters');
      stored.current = raw ? { ...DEFAULT_FILTERS, ...JSON.parse(raw) } : DEFAULT_FILTERS;
    } catch {
      stored.current = DEFAULT_FILTERS;
    }
  }
  const [filters, setFilters] = useState<FilterState>(stored.current);

  const update = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      try {
        sessionStorage.setItem('cs.session.filters', JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return { filters, update };
}

/** Навигация на детальную страницу пары */
export function useGoToCoin() {
  const navigate = useNavigate();
  return useCallback(
    (key: string) => navigate(`/coin/${encodeURIComponent(key)}`),
    [navigate],
  );
}

export function useFavorites() {
  const keys = useAppSelector((s) => s.favorites.keys);
  const dispatch = useAppDispatch();
  const toggle = useCallback((key: string) => dispatch(toggleFavorite(key)), [dispatch]);
  return { favorites: keys, toggleFavorite: toggle };
}

export function useSettings() {
  const settings = useAppSelector((s) => s.settings.value);
  const dispatch = useAppDispatch();
  const patch = useCallback((p: Partial<typeof settings>) => dispatch(setSettings(p)), [dispatch]);
  return { settings, patch };
}
