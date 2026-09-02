/**
 * The single source of truth for what this editor can do.
 * Every control here maps 1:1 to a uniform in the fragment shader,
 * so preview and export can never drift apart.
 */

export type AdjustmentKey =
  | 'exposure'
  | 'brightness'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'vibrance'
  | 'saturation'
  | 'sharpness'
  | 'fade'
  | 'vignette'
  | 'grain';

export type Adjustments = Record<AdjustmentKey, number>;

export type GroupId = 'light' | 'color' | 'effects';

export interface ControlDef {
  key: AdjustmentKey;
  label: string;
  group: GroupId;
  /** Bipolar controls render a fill that grows out from the centre of the track. */
  bipolar: boolean;
  min: number;
  max: number;
  /** Shown in the collapsed state; the rest live behind "More". */
  essential: boolean;
  /** Multiplier used only for the numeric readout, so users see familiar units. */
  displayScale?: number;
  unit?: string;
  hint: string;
}

export const CONTROLS: ControlDef[] = [
  // ---- Light -------------------------------------------------------------
  { key: 'exposure',   label: 'Exposure',   group: 'light',   bipolar: true,  min: -1, max: 1, essential: true,  displayScale: 2, unit: ' EV', hint: 'Overall light, applied in linear space like a camera stop.' },
  { key: 'contrast',   label: 'Contrast',   group: 'light',   bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Separation between light and dark tones.' },
  { key: 'brightness', label: 'Brightness', group: 'light',   bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Lifts midtones while holding black and white points.' },
  { key: 'highlights', label: 'Highlights', group: 'light',   bipolar: true,  min: -1, max: 1, essential: false, hint: 'Recovers or opens up the brightest areas.' },
  { key: 'shadows',    label: 'Shadows',    group: 'light',   bipolar: true,  min: -1, max: 1, essential: false, hint: 'Opens or deepens detail in the darkest areas.' },
  { key: 'whites',     label: 'Whites',     group: 'light',   bipolar: true,  min: -1, max: 1, essential: false, hint: 'Sets where pure white begins.' },
  { key: 'blacks',     label: 'Blacks',     group: 'light',   bipolar: true,  min: -1, max: 1, essential: false, hint: 'Sets where pure black begins.' },

  // ---- Color -------------------------------------------------------------
  { key: 'temperature', label: 'Warmth',    group: 'color',   bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Cool blue through warm amber. Luminance is preserved.' },
  { key: 'vibrance',    label: 'Vibrance',  group: 'color',   bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Saturates muted colours first and protects skin tones.' },
  { key: 'saturation',  label: 'Saturation',group: 'color',   bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Intensity of every colour, equally.' },
  { key: 'tint',        label: 'Tint',      group: 'color',   bipolar: true,  min: -1, max: 1, essential: false, hint: 'Green through magenta, for correcting casts.' },

  // ---- Effects -----------------------------------------------------------
  { key: 'sharpness', label: 'Sharpen',  group: 'effects', bipolar: false, min: 0, max: 1, essential: true,  hint: 'Unsharp mask on local detail.' },
  { key: 'vignette',  label: 'Vignette', group: 'effects', bipolar: true,  min: -1, max: 1, essential: true,  hint: 'Darkens or brightens the frame edges.' },
  { key: 'fade',      label: 'Fade',     group: 'effects', bipolar: false, min: 0, max: 1, essential: false, hint: 'Lifts blacks for a soft matte finish.' },
  { key: 'grain',     label: 'Grain',    group: 'effects', bipolar: false, min: 0, max: 1, essential: false, hint: 'Adds film-like luminance noise.' },
];

export const CONTROLS_BY_KEY: Record<AdjustmentKey, ControlDef> = Object.fromEntries(
  CONTROLS.map((c) => [c.key, c]),
) as Record<AdjustmentKey, ControlDef>;

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
  { id: 'effects', label: 'Effects' },
];

export const DEFAULT_ADJUSTMENTS: Adjustments = Object.fromEntries(
  CONTROLS.map((c) => [c.key, 0]),
) as Adjustments;

export function isNeutral(a: Adjustments): boolean {
  return CONTROLS.every((c) => Math.abs(a[c.key]) < 1e-4);
}

export function countEdits(a: Adjustments, group?: GroupId): number {
  return CONTROLS.filter((c) => (!group || c.group === group) && Math.abs(a[c.key]) > 1e-4).length;
}

// ---- Presets -------------------------------------------------------------

export interface Preset {
  id: string;
  name: string;
  values: Partial<Adjustments>;
}

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Original', values: {} },
  { id: 'vivid',    name: 'Vivid',     values: { vibrance: 0.45, saturation: 0.12, contrast: 0.18, sharpness: 0.2 } },
  { id: 'warm',     name: 'Warm',      values: { temperature: 0.36, exposure: 0.04, vibrance: 0.2, shadows: 0.1 } },
  { id: 'cool',     name: 'Cool',      values: { temperature: -0.36, tint: 0.06, contrast: 0.12, saturation: 0.06 } },
  { id: 'golden',   name: 'Golden',    values: { temperature: 0.46, highlights: -0.16, shadows: 0.22, vibrance: 0.3, fade: 0.12 } },
  { id: 'cinema',   name: 'Cinematic', values: { contrast: 0.22, saturation: -0.12, temperature: -0.14, shadows: 0.2, highlights: -0.22, fade: 0.18, vignette: 0.3 } },
  { id: 'punch',    name: 'Punch',     values: { contrast: 0.3, vibrance: 0.36, sharpness: 0.35, blacks: -0.16, whites: 0.14 } },
  { id: 'faded',    name: 'Faded',     values: { fade: 0.38, contrast: -0.12, saturation: -0.16, blacks: 0.22 } },
  { id: 'noir',     name: 'Noir',      values: { saturation: -1, contrast: 0.36, blacks: -0.26, sharpness: 0.25, grain: 0.28 } },
  { id: 'silver',   name: 'Silver',    values: { saturation: -1, contrast: 0.1, fade: 0.2, brightness: 0.08 } },
];

export function applyPreset(preset: Preset): Adjustments {
  return { ...DEFAULT_ADJUSTMENTS, ...preset.values };
}

/** Which preset (if any) the current state exactly matches. */
export function matchPreset(a: Adjustments): string | null {
  for (const p of PRESETS) {
    const v = applyPreset(p);
    if (CONTROLS.every((c) => Math.abs(v[c.key] - a[c.key]) < 1e-4)) return p.id;
  }
  return null;
}
