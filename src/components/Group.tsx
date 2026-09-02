import { useState } from 'react';
import { Slider } from './Slider';
import { IconChevron, IconCaret } from './icons';
import type { Adjustments, AdjustmentKey, ControlDef } from '../engine/adjustments';

interface Props {
  title: string;
  controls: ControlDef[];
  adjustments: Adjustments;
  editCount: number;
  defaultOpen: boolean;
  onChange: (key: AdjustmentKey, value: number) => void;
  onResetGroup: () => void;
}

/**
 * Progressive disclosure lives here: the three or so controls people reach for
 * are visible, the rest sit one click away, and the group itself collapses.
 */
export function Group({
  title,
  controls,
  adjustments,
  editCount,
  defaultOpen,
  onChange,
  onResetGroup,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);

  const essential = controls.filter((c) => c.essential);
  const extra = controls.filter((c) => !c.essential);
  // If an advanced control is already in play, do not hide it away.
  const extraTouched = extra.some((c) => Math.abs(adjustments[c.key]) > 1e-4);
  const showExtra = expanded || extraTouched;
  const visible = showExtra ? [...essential, ...extra] : essential;

  return (
    <section className={`group${open ? ' group--open' : ''}`}>
      <button
        className="group__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconChevron className="group__chevron" />
        <span className="group__title">{title}</span>
        {editCount > 0 && <span className="group__dot" title={`${editCount} adjusted`} />}
        {editCount > 0 && (
          <span
            className="group__reset"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onResetGroup();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onResetGroup();
              }
            }}
          >
            Reset
          </span>
        )}
      </button>

      <div className="group__body">
        <div className="group__inner">
          <div className="group__content">
            {visible.map((c) => (
              <Slider
                key={c.key}
                control={c}
                value={adjustments[c.key]}
                onChange={(v) => onChange(c.key, v)}
              />
            ))}
            {extra.length > 0 && !extraTouched && (
              <button
                className={`group__more${expanded ? ' group__more--open' : ''}`}
                onClick={() => setExpanded((v) => !v)}
              >
                <IconCaret />
                {expanded ? 'Fewer options' : `${extra.length} more`}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
