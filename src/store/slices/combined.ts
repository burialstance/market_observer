// Ре-экспорт редьюсеров всех слайсов для store
import { tickersSlice, websocketSlice, settingsSlice, favoritesSlice, levelsSlice } from './index';

export const tickersReducer = tickersSlice.reducer;
export const websocketReducer = websocketSlice.reducer;
export const settingsReducer = settingsSlice.reducer;
export const favoritesReducer = favoritesSlice.reducer;
export const levelsReducer = levelsSlice.reducer;
