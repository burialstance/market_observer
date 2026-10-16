/** Безопасная обёртка над localStorage (может быть недоступна/переполнена) */

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded / disabled storage — игнорируем */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export const LS_KEYS = {
  settings: 'cs.settings',
  favorites: 'cs.favorites',
  levels: 'cs.levels.', // + exchange|market|SYMBOL
  history: 'cs.history',
  sessionFilters: 'cs.session.filters',
} as const;

/** История просмотров (последние N пар) */
export function pushViewHistory(key: string, max = 10): void {
  const list = loadJSON<string[]>(LS_KEYS.history, []);
  const next = [key, ...list.filter((k) => k !== key)].slice(0, max);
  saveJSON(LS_KEYS.history, next);
}

/** Временные данные текущей сессии */
export function saveSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

export function loadSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
