import { configureStore } from '@reduxjs/toolkit';
import cryptoApi from './api/cryptoApi';
import {
  favoritesReducer,
  levelsReducer,
  settingsReducer,
  tickersReducer,
  websocketReducer,
} from './slices/combined';

export const store = configureStore({
  reducer: {
    [cryptoApi.reducerPath]: cryptoApi.reducer,
    tickers: tickersReducer,
    websocket: websocketReducer,
    settings: settingsReducer,
    favorites: favoritesReducer,
    levels: levelsReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(cryptoApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
