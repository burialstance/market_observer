import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Download, Upload, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { addLevel, removeLevel, importLevels } from '../../store/slices';
import type { TargetLevel } from '../../types';
import { formatPrice } from '../../utils/formatters';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { cn } from '../../utils/cn';

interface Props {
  pairKeyStr: string;
  currentPrice: number;
  autoSupport: number[];
  autoResistance: number[];
  autoEnabled: boolean;
  onToggleAuto: (on: boolean) => void;
  /** Все активные уровни — для алертов родителя */
  onLevelsChange?: (levels: TargetLevel[]) => void;
}

/**
 * Панель целевых уровней: авто-расчёт + ручные уровни (приоритет ручных),
 * сохранение в localStorage, экспорт/импорт JSON.
 */
function LevelsPanelInner({
  pairKeyStr,
  currentPrice,
  autoSupport,
  autoResistance,
  autoEnabled,
  onToggleAuto,
  onLevelsChange,
}: Props) {
  const dispatch = useAppDispatch();
  const manualValues = useAppSelector((s) => s.levels.manual[pairKeyStr]) ?? [];
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const levels: TargetLevel[] = useMemo(() => {
    const manual: TargetLevel[] = manualValues.map((v) => ({
      id: `m-${v}`,
      value: v,
      kind: v < currentPrice ? 'support' : 'resistance',
      manual: true,
    }));
    const auto: TargetLevel[] = autoEnabled
      ? [
          ...autoSupport.map((v, i) => ({ id: `s-${i}-${v}`, value: v, kind: 'support' as const, manual: false })),
          ...autoResistance.map((v, i) => ({ id: `r-${i}-${v}`, value: v, kind: 'resistance' as const, manual: false })),
        ]
      : [];
    // Ручные имеют приоритет: исключаем авто-уровни, совпадающие с ручными (±0.1%)
    const dedupedAuto = auto.filter(
      (a) => !manual.some((m) => Math.abs(m.value - a.value) / (a.value || 1) < 0.001),
    );
    return [...manual, ...dedupedAuto].sort((a, b) => a.value - b.value);
  }, [manualValues, autoSupport, autoResistance, autoEnabled, currentPrice]);

  useEffect(() => {
    onLevelsChange?.(levels);
  }, [levels, onLevelsChange]);

  const handleAdd = useCallback(() => {
    const v = parseFloat(input.replace(',', '.'));
    if (!isFinite(v) || v <= 0) return;
    dispatch(addLevel({ key: pairKeyStr, value: v }));
    setInput('');
  }, [input, dispatch, pairKeyStr]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify({ [pairKeyStr]: manualValues }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `levels-${pairKeyStr.replace(/\|/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [manualValues, pairKeyStr]);

  const handleImport = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as Record<string, number[]>;
          dispatch(importLevels(data));
        } catch {
          /* невалидный файл — игнорируем */
        }
      };
      reader.readAsText(file);
    },
    [dispatch],
  );

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Целевые уровни</h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Авто-расчёт
          <Switch checked={autoEnabled} onCheckedChange={onToggleAuto} />
        </label>
      </div>

      {/* Список уровней */}
      <ul className="max-h-56 space-y-1 overflow-auto pr-1" aria-label="Список целевых уровней">
        {levels.length === 0 && (
          <li className="py-2 text-center text-xs text-muted-foreground">Нет уровней — добавьте вручную или включите авто-расчёт</li>
        )}
        {levels.map((lvl) => (
          <li
            key={lvl.id}
            className={cn(
              'flex items-center justify-between rounded-md px-2 py-1 text-sm tabular-nums',
              lvl.kind === 'support' ? 'bg-success/10' : 'bg-destructive/10',
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', lvl.kind === 'support' ? 'bg-success' : 'bg-destructive')} />
              <span className={lvl.kind === 'support' ? 'text-success' : 'text-destructive'}>{formatPrice(lvl.value)}</span>
              {!lvl.manual && <span className="text-[10px] uppercase text-muted-foreground">auto</span>}
              {currentPrice > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {(((lvl.value - currentPrice) / currentPrice) * 100).toFixed(1)}%
                </span>
              )}
            </span>
            {lvl.manual && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                aria-label={`Удалить уровень ${lvl.value}`}
                onClick={() => dispatch(removeLevel({ key: pairKeyStr, value: lvl.value }))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Добавление */}
      <div className="mt-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Новый уровень, напр. 65000"
          inputMode="decimal"
          aria-label="Значение уровня"
        />
        <Button size="sm" onClick={handleAdd} disabled={!input.trim()}>
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={manualValues.length === 0}>
          <Download className="h-3.5 w-3.5" /> Экспорт
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Импорт
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export const LevelsPanel = memo(LevelsPanelInner);

// Иконка X используется в родительских модалках — реэкспортируем утилиту скрытия
export const CloseIconButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClick} aria-label="Закрыть">
    <X className="h-3.5 w-3.5" />
  </Button>
);
