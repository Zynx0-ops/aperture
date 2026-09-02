import { useCallback, useRef, useState } from 'react';
import type { ControlDef } from '../engine/adjustments';

interface Props {
  control: ControlDef;
  value: number;
  onChange: (value: number) => void;
  /** Called once when a drag ends, so undo/history can coalesce a gesture. */
  onCommit?: () => void;
}

/**
 * A pointer-driven slider rather than <input type="range">, because bipolar
 * controls need the fill to grow out from the centre and the whole thing has to
 * stay silent under the cursor.
 */
export function Slider({ control, value, onChange, onCommit }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { min, max, bipolar, label, displayScale = 1, unit = '' } = control;
  const modified = Math.abs(value) > 1e-4;

  const valueFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + t * (max - min);
      // Magnetise to the neutral point so it is easy to land back on zero.
      return Math.abs(raw) < (max - min) * 0.02 ? 0 : Math.round(raw * 1000) / 1000;
    },
    [min, max, value],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(valueFromEvent(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(valueFromEvent(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onCommit?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(min, Math.round((value - step) * 1000) / 1000));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(max, Math.round((value + step) * 1000) / 1000));
    } else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault();
      onChange(0);
    }
  };

  const pct = ((value - min) / (max - min)) * 100;
  const zeroPct = ((0 - min) / (max - min)) * 100;
  const fill = bipolar
    ? { left: `${Math.min(pct, zeroPct)}%`, width: `${Math.abs(pct - zeroPct)}%` }
    : { left: '0%', width: `${pct}%` };

  // Percentages for most controls; camera stops for exposure.
  const display = value * displayScale;
  const sign = display > 1e-4 && bipolar ? '+' : '';
  const readout =
    Math.abs(display) < 1e-4
      ? '0'
      : unit
        ? `${sign}${display.toFixed(2)}${unit}`
        : `${sign}${Math.round(display * 100)}`;

  return (
    <div className={`slider${modified ? ' slider--modified' : ''}${dragging ? ' slider--dragging' : ''}`}>
      <div className="slider__top">
        <span className="slider__label">{label}</span>
        <span className="slider__value">{readout}</span>
      </div>
      <div
        ref={trackRef}
        className="slider__track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${label} ${readout}`}
        title={`${control.hint} — double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          onChange(0);
          onCommit?.();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="slider__rail">
          <div className="slider__fill" style={fill} />
        </div>
        {bipolar && <div className="slider__center" />}
        <div className="slider__thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}
