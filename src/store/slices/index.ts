import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Exchange, MarketType, TickerData } from '../../types';
import { pairKey } from '../../types';
import type { WsStatus } from '../../services/websocket/base';
import { LS_KEYS, loadJSON, saveJSON } from '../../utils/storage';

/** Нормализованные тикеры по ключу пары */
export interface TickersState {
  items: Record<string, TickerData>;
}

const tickersSlice = createSlice({
  name: 'tickers',
  initialState: { items: {} } as TickersState,
  reducers: {
    updateTicker(state, action: PayloadAction<TickerData>) {
      const t = action.payload;
      state.items[pairKey(t.exchange, t.market, t.symbol)] = t;
    },
  },
});

export { tickersSlice };
export const { updateTicker } = tickersSlice.actions;

/** Статусы WebSocket-соединений */
export interface WsConnInfo {
  status: WsStatus;
  subscribedSymbols: string[];
}

interface WsState {
  connections: Record<string, WsConnInfo>; // key: exchange|market
}

const websocketSlice = createSlice({
  name: 'websocket',
  initialState: { connections: {} } as WsState,
  reducers: {
    connectToExchange(state, action: PayloadAction<{ exchange: Exchange; market: MarketType }>) {
      const key = `${action.payload.exchange}|${action.payload.market}`;
      if (!state.connections[key]) {
        state.connections[key] = { status: 'connecting', subscribedSymbols: [] };
      }
    },
    setConnectionStatus(
      state,
      action: PayloadAction<{ exchange: Exchange; market: MarketType; status: WsStatus }>,
    ) {
      const key = `${action.payload.exchange}|${action.payload.market}`;
      const conn = state.connections[key] ?? { status: 'closed' as WsStatus, subscribedSymbols: [] };
      conn.status = action.payload.status;
      state.connections[key] = conn;
    },
    subscribeToSymbol(
      state,
      action: PayloadAction<{ exchange: Exchange; market: MarketType; symbol: string }>,
    ) {
      const key = `${action.payload.exchange}|${action.payload.market}`;
      const conn = state.connections[key] ?? { status: 'connecting' as WsStatus, subscribedSymbols: [] };
      if (!conn.subscribedSymbols.includes(action.payload.symbol)) {
        conn.subscribedSymbols.push(action.payload.symbol);
      }
      state.connections[key] = conn;
    },
    unsubscribeFromSymbol(
      state,
      action: PayloadAction<{ exchange: Exchange; market: MarketType; symbol: string }>,
    ) {
      const key = `${action.payload.exchange}|${action.payload.market}`;
      const conn = state.connections[key];
      if (conn) {
        conn.subscribedSymbols = conn.subscribedSymbols.filter((s) => s !== action.payload.symbol);
      }
    },
    disconnect(state, action: PayloadAction<{ exchange: Exchange; market: MarketType }>) {
      const key = `${action.payload.exchange}|${action.payload.market}`;
      if (state.connections[key]) state.connections[key].status = 'closed';
    },
  },
});

export { websocketSlice };

export const {
  connectToExchange,
  setConnectionStatus,
  subscribeToSymbol,
  unsubscribeFromSymbol,
  disconnect,
} = websocketSlice.actions;

/** Настройки приложения (персист в localStorage) */
export interface Settings {
  theme: 'dark' | 'light';
  density: 'compact' | 'comfortable';
  fontSize: 'sm' | 'md' | 'lg';
  exchanges: Exchange[]; // активные биржи
  markets: MarketType[]; // spot/futures
  refreshIntervalSec: number; // автообновление REST-данных
  economyMode: boolean; // качество данных: экономия трафика
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  alertThresholdPercent: number; // порог срабатывания алерта по уровню
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  density: 'comfortable',
  fontSize: 'md',
  exchanges: ['binance', 'bybit'],
  markets: ['spot'],
  refreshIntervalSec: 30,
  economyMode: false,
  notificationsEnabled: false,
  soundEnabled: true,
  alertThresholdPercent: 0.3,
};

interface SettingsState {
  value: Settings;
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState: { value: loadJSON<Settings>(LS_KEYS.settings, DEFAULT_SETTINGS) } as SettingsState,
  reducers: {
    setSettings(state, action: PayloadAction<Partial<Settings>>) {
      state.value = { ...state.value, ...action.payload };
      saveJSON(LS_KEYS.settings, state.value);
    },
    resetSettings(state) {
      state.value = DEFAULT_SETTINGS;
      saveJSON(LS_KEYS.settings, state.value);
    },
  },
});

export { settingsSlice };

export const { setSettings, resetSettings } = settingsSlice.actions;

/** Избранные монеты (localStorage) */
interface FavoritesState {
  keys: string[];
}

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState: { keys: loadJSON<string[]>(LS_KEYS.favorites, []) } as FavoritesState,
  reducers: {
    toggleFavorite(state, action: PayloadAction<string>) {
      const key = action.payload;
      state.keys = state.keys.includes(key)
        ? state.keys.filter((k) => k !== key)
        : [...state.keys, key];
      saveJSON(LS_KEYS.favorites, state.keys);
    },
  },
});

export { favoritesSlice };

export const { toggleFavorite } = favoritesSlice.actions;

/** Пользовательские целевые уровни по парам (localStorage) */
export interface ManualLevels {
  [pairKeyStr: string]: number[];
}

const levelsSlice = createSlice({
  name: 'levels',
  initialState: { manual: loadJSON<ManualLevels>(LS_KEYS.levels + 'all', {}) } as { manual: ManualLevels },
  reducers: {
    addLevel(state, action: PayloadAction<{ key: string; value: number }>) {
      const { key, value } = action.payload;
      const list = state.manual[key] ?? [];
      if (!list.some((v) => Math.abs(v - value) < 1e-12)) {
        state.manual[key] = [...list, value].sort((a, b) => a - b);
        saveJSON(LS_KEYS.levels + 'all', state.manual);
      }
    },
    removeLevel(state, action: PayloadAction<{ key: string; value: number }>) {
      const { key, value } = action.payload;
      const list = state.manual[key] ?? [];
      state.manual[key] = list.filter((v) => v !== value);
      saveJSON(LS_KEYS.levels + 'all', state.manual);
    },
    importLevels(state, action: PayloadAction<ManualLevels>) {
      state.manual = { ...state.manual, ...action.payload };
      saveJSON(LS_KEYS.levels + 'all', state.manual);
    },
  },
});

export { levelsSlice };

export const { addLevel, removeLevel, importLevels } = levelsSlice.actions;
