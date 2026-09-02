import { useEffect, useRef, useState } from 'react';
import { PRESETS, applyPreset, type Preset } from '../engine/adjustments';
import { Renderer } from '../engine/renderer';

interface Props {
  /** A small still to render each preset against. */
  thumbSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null;
  sourceWidth: number;
  sourceHeight: number;
  activeId: string | null;
  onPick: (preset: Preset) => void;
}

const THUMB = 108; // 54px at 2x

/**
 * Renders every preset against the user's own frame. Generic swatches tell you
 * nothing; seeing your photo in Noir tells you everything.
 */
export function Presets({ thumbSource, sourceWidth, sourceHeight, activeId, onPick }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!thumbSource || !sourceWidth || !sourceHeight) return;
    let cancelled = false;
    const created: string[] = [];

    // Square centre-crop keeps the strip tidy regardless of aspect ratio.
    const side = Math.min(sourceWidth, sourceHeight);
    const crop = document.createElement('canvas');
    crop.width = THUMB;
    crop.height = THUMB;
    const ctx = crop.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      thumbSource as CanvasImageSource,
      (sourceWidth - side) / 2,
      (sourceHeight - side) / 2,
      side,
      side,
      0,
      0,
      THUMB,
      THUMB,
    );

    let renderer: Renderer | null = null;
    (async () => {
      try {
        renderer = new Renderer();
        renderer.resize(THUMB, THUMB);
        const next: Record<string, string> = {};
        for (const preset of PRESETS) {
          if (cancelled) break;
          renderer.upload(crop, THUMB, THUMB);
          renderer.render(applyPreset(preset), { split: null });
          const blob = await new Promise<Blob | null>((r) =>
            renderer!.canvas.toBlob(r, 'image/jpeg', 0.82),
          );
          if (blob) {
            const url = URL.createObjectURL(blob);
            created.push(url);
            next[preset.id] = url;
          }
        }
        if (!cancelled) {
          urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
          urlsRef.current = created;
          setThumbs(next);
        } else {
          created.forEach((u) => URL.revokeObjectURL(u));
        }
      } catch {
        /* thumbnails are a nicety; the editor works without them */
      } finally {
        renderer?.dispose();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [thumbSource, sourceWidth, sourceHeight]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    },
    [],
  );

  return (
    <div className="presets">
      <span className="section-label">Presets</span>
      <div className="presets__row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`preset${activeId === p.id ? ' preset--active' : ''}`}
            onClick={() => onPick(p)}
            aria-pressed={activeId === p.id}
          >
            <span className="preset__thumb">
              {thumbs[p.id] && <img src={thumbs[p.id]} alt="" draggable={false} />}
            </span>
            <span className="preset__name">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
