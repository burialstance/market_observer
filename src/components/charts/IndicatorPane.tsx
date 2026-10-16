import { memo, useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Time } from 'lightweight-charts';
import { useAppSelector } from '../../store/hooks';

interface Props {
  data: { time: Time; value: number; color?: string }[];
  height?: number;
  /** Часы-суперпозиция (для RSI) */
  bands?: { from: number; to: number; color: string }[];
  isHistogram?: boolean;
  label: string;
}

/** Вспомогательная панель индикатора (RSI / MACD) */
function IndicatorPaneInner({ data, height = 120, bands, isHistogram, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null>(null);
  const theme = useAppSelector((s) => s.settings.value.theme);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isDark = theme === 'dark';
    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#9ca3af' : '#6b7280',
      },
      grid: { vertLines: { visible: false }, horzLines: { color: isDark ? '#1f2937' : '#e5e7eb' } },
      rightPriceScale: { borderColor: isDark ? '#374151' : '#d1d5db' },
      timeScale: { borderColor: isDark ? '#374151' : '#d1d5db', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 /* Normal */ as never },
      autoSize: false,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme, height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    if (isHistogram) {
      const s = chart.addHistogramSeries({ priceLineVisible: false });
      s.setData(data as { time: UTCTimestamp; value: number; color: string }[]);
      seriesRef.current = s;
    } else {
      const s = chart.addLineSeries({ color: '#eab308', lineWidth: 1, priceLineVisible: false });
      s.setData(data);
      for (const b of bands ?? []) {
        s.createPriceLine({ price: b.from, color: b.color, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '' });
      }
      seriesRef.current = s;
    }
    const mainTime = chart.timeScale();
    mainTime.fitContent();
  }, [data, isHistogram, bands]);

  // Синхронизация времени с основным графиком выполняется родителем через ref — упрощаем: автоподгонка
  return (
    <div className="relative">
      <span className="absolute left-2 top-1 z-10 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

export const IndicatorPane = memo(IndicatorPaneInner);
