import * as React from 'react';
import { cn } from '../../utils/cn';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Цвет задаётся автоматически по направлению изменения */
}

/** Мини-график цены на canvas — дёшево рендерится даже для сотен строк */
export function Sparkline({ data, width = 110, height = 32, className }: SparklineProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const rising = data[data.length - 1] >= data[0];
    const color = rising ? '#22c55e' : '#ef4444';

    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [data, width, height]);

  if (data.length < 2) {
    return <div style={{ width, height }} className={cn('rounded bg-muted/40', className)} />;
  }
  return <canvas ref={canvasRef} style={{ width, height }} className={className} aria-hidden="true" />;
}
