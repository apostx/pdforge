import { useEffect, useRef, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import { useElementSize } from '../ui/useElementSize';
import { drawStrokes, type Stroke } from './imaging';

export const PAD_LINE_WIDTH = 2.5;

interface SignaturePadProps {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  color: string;
}

/** A drawing surface for mouse, pen or finger. Strokes are kept in CSS pixels. */
export function SignaturePad({ strokes, onChange, color }: SignaturePadProps) {
  const { t } = useI18n();
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapper);
  const current = useRef<Stroke | null>(null);

  // full redraw when strokes, colour or size change; while drawing only the new segment is added
  useEffect(() => {
    const element = canvas.current;
    if (!element || size.width === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    const context = element.getContext('2d')!;
    context.scale(ratio, ratio);
    drawStrokes(context, strokes, color, PAD_LINE_WIDTH);
  }, [strokes, color, size]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div ref={wrapper} className="signature-pad doc-surface">
      <canvas
        ref={canvas}
        role="img"
        aria-label={t.drawHere}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          current.current = [point(event)];
        }}
        onPointerMove={(event) => {
          const stroke = current.current;
          if (!stroke) return;
          const context = event.currentTarget.getContext('2d')!;
          // coalesced events give the full-rate path even when frames are dropped (slow devices)
          for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
            const rect = event.currentTarget.getBoundingClientRect();
            const next = { x: sample.clientX - rect.left, y: sample.clientY - rect.top };
            drawStrokes(context, [[stroke[stroke.length - 1], next]], color, PAD_LINE_WIDTH);
            stroke.push(next);
          }
        }}
        onPointerUp={() => {
          if (current.current) onChange([...strokes, current.current]);
          current.current = null;
        }}
        onPointerCancel={() => {
          current.current = null;
          onChange([...strokes]); // redraw without the half stroke
        }}
      />
      {strokes.length === 0 && <span className="signature-pad__hint">{t.drawHere}</span>}
    </div>
  );
}
