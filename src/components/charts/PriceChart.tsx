import { memo, useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
  LineType,
} from 'lightweight-charts';
import type { Candle, ChartType } from '../../types';
import { useAppSelector } from '../../store/hooks';

export interface IndicatorSeries {
  id: string;
  data: { time: Time; value: number }[];
  color: string;
  /** Линия на основной панели (price scale right) */
  priceLine?: boolean;
}

export interface LevelLine {
  price: number;
  kind: 'support' | 'resistance' | 'manual';
}

interface Props {
  candles: Candle[];
  chartType: ChartType;
  indicators: IndicatorSeries[];
  levels: LevelLine[];
  onCrosshairPrice?: (price: number | null) => void;
}

const UP = '#22c55e';
const DOWN = '#ef4444';

/** Интерактивный график на TradingView Lightweight Charts с overlay-уровнями и индикаторами */
function PriceChartInner({ candles, chartType, indicators, levels, onCrosshairPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>[]>>(new Map());
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const theme = useAppSelector((s) => s.settings.value.theme);

  // Создание графика — один раз + при смене темы
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isDark = theme === 'dark';
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#0b0f19' : '#ffffff' },
        textColor: isDark ? '#d1d5db' : '#374151',
      },
      grid: {
        vertLines: { color: isDark ? '#1f2937' : '#e5e7eb' },
        horzLines: { color: isDark ? '#1f2937' : '#e5e7eb' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: isDark ? '#374151' : '#d1d5db' },
      timeScale: {
        borderColor: isDark ? '#374151' : '#d1d5db',
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });
    chartRef.current = chart;

    if (onCrosshairPrice) {
      chart.subscribeCrosshairMove((param) => {
        if (!param.point || !param.seriesData.size) {
          onCrosshairPrice(null);
          return;
        }
        for (const [, value] of param.seriesData) {
          const v = value as { close?: number; value?: number };
          if (v.close != null) onCrosshairPrice(v.close);
          else if (v.value != null) onCrosshairPrice(v.value);
        }
      });
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeRef.current = null;
      indicatorSeriesRef.current.clear();
      priceLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Основная серия — пересоздаётся при смене типа графика
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainSeriesRef.current) chart.removeSeries(mainSeriesRef.current);
    if (volumeRef.current) chart.removeSeries(volumeRef.current);

    if (chartType === 'candles') {
      const series = chart.addCandlestickSeries({
        upColor: UP,
        downColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        borderVisible: false,
      });
      mainSeriesRef.current = series;
    } else if (chartType === 'line') {
      const series = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
      mainSeriesRef.current = series;
    } else {
      const series = chart.addAreaSeries({
        lineType: LineType.Baseline,
        lineColor: '#3b82f6',
        topColor: 'rgba(59,130,246,0.35)',
        bottomColor: 'rgba(59,130,246,0.02)',
      });
      mainSeriesRef.current = series;
    }

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }, [chartType, theme]);

  // Данные основных свечей + объём
  useEffect(() => {
    const main = mainSeriesRef.current;
    const vol = volumeRef.current;
    if (!main || candles.length === 0) return;
    if (mainSeriesRef.current && 'setData' in main) {
      if (chartType === 'candles') {
        (main as ISeriesApi<'Candlestick'>).setData(
          candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
      } else {
        (main as ISeriesApi<'Line'>).setData(
          candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
        );
      }
    }
    vol?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
      })),
    );
  }, [candles, chartType]);

  // Индикаторы (overlay-линии на основной шкале)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Очистка старых серий индикаторов
    for (const [, seriesList] of indicatorSeriesRef.current) {
      for (const s of seriesList) chart.removeSeries(s);
    }
    indicatorSeriesRef.current.clear();

    for (const ind of indicators) {
      if (ind.data.length === 0) continue;
      const series = chart.addLineSeries({
        color: ind.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
      series.setData(ind.data);
      indicatorSeriesRef.current.set(ind.id, [series]);
    }
  }, [indicators]);

  // Целевые уровни как горизонтальные линии цены
  useEffect(() => {
    const main = mainSeriesRef.current;
    if (!main) return;
    for (const pl of priceLinesRef.current) main.removePriceLine(pl);
    priceLinesRef.current = [];
    for (const lvl of levels) {
      const color = lvl.kind === 'support' ? '#22c55e' : lvl.kind === 'resistance' ? '#ef4444' : '#a855f7';
      const pl = main.createPriceLine({
        price: lvl.price,
        color,
        lineWidth: 1,
        lineStyle: lvl.kind === 'manual' ? 2 /* dashed */ : 3 /* large dashed */,
        axisLabelVisible: true,
        title: lvl.kind === 'support' ? 'S' : lvl.kind === 'resistance' ? 'R' : 'U',
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels, chartType, theme]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export const PriceChart = memo(PriceChartInner);
