import { useEffect, useMemo, useRef, useState } from 'react';
import type { Adjustments } from '../engine/adjustments';
import type { LoadedMedia } from '../hooks/useMedia';
import { exportImage, type ImageFormat } from '../export/exportImage';
import { exportVideo, planPipeline, ExportAbortError } from '../export/exportVideo';
import type { ExportQuality } from '../export/exportVideoWebCodecs';
import { download, baseName, formatBytes } from '../export/download';
import { IconInfo, IconWarn } from './icons';

interface Props {
  media: LoadedMedia;
  adjustments: Adjustments;
  onClose: () => void;
}

const SCALES = [
  { label: 'Full', value: 1 },
  { label: '½', value: 0.5 },
  { label: '¼', value: 0.25 },
];

const QUALITIES: { label: string; value: ExportQuality }[] = [
  { label: 'High', value: 'high' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Small', value: 'small' },
];

const IMAGE_FORMATS: { label: string; value: ImageFormat }[] = [
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'PNG', value: 'image/png' },
  { label: 'WebP', value: 'image/webp' },
];

export function ExportSheet({ media, adjustments, onClose }: Props) {
  const isVideo = media.kind === 'video';

  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [includeAudio, setIncludeAudio] = useState(true);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const plan = useMemo(
    () => (isVideo ? planPipeline(media.file, 'auto') : null),
    [isVideo, media.file],
  );

  const outW = Math.round(media.width * scale);
  const outH = Math.round(media.height * scale);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setDone(null);
    setWarnings([]);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (isVideo) {
        setMessage('Preparing');
        const result = await exportVideo(media.file, adjustments, {
          scale,
          quality,
          includeAudio,
          signal: controller.signal,
          onProgress: (p, m) => {
            setProgress(p);
            setMessage(m);
          },
        });
        download(result.blob, `${baseName(media.file.name)}-edited.${result.extension}`);
        setWarnings(result.warnings);
        setDone(
          `${result.width}x${result.height} · ${formatBytes(result.blob.size)} · ${
            result.pipeline === 'webcodecs' ? 'H.264 MP4' : 'realtime capture'
          }`,
        );
      } else {
        setMessage('Rendering at full resolution');
        setProgress(0.4);
        const result = await exportImage(
          media.image!,
          media.width,
          media.height,
          adjustments,
          { format, quality: quality === 'high' ? 0.95 : quality === 'balanced' ? 0.85 : 0.7, scale },
        );
        setProgress(1);
        const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
        download(result.blob, `${baseName(media.file.name)}-edited.${ext}`);
        setDone(`${result.width}x${result.height} · ${formatBytes(result.blob.size)}`);
      }
    } catch (err) {
      if (err instanceof ExportAbortError || controller.signal.aborted) setError('Export cancelled.');
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Export">
        <h2 className="sheet__title">Export {isVideo ? 'Video' : 'Image'}</h2>
        <p className="sheet__sub">
          {media.file.name} · {media.width}×{media.height}
          {isVideo && media.duration ? ` · ${media.duration.toFixed(1)}s` : ''}
        </p>

        {!running && !done && (
          <>
            {!isVideo && (
              <div className="field">
                <span className="field__label">Format</span>
                <div className="segmented">
                  {IMAGE_FORMATS.map((f) => (
                    <button
                      key={f.value}
                      className={`segmented__item${format === f.value ? ' segmented__item--active' : ''}`}
                      onClick={() => setFormat(f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {format === 'image/png' && (
                  <p className="field__note">PNG is lossless, so quality has no effect and files run large.</p>
                )}
              </div>
            )}

            <div className="field">
              <span className="field__label">Size</span>
              <div className="segmented">
                {SCALES.map((s) => (
                  <button
                    key={s.value}
                    className={`segmented__item${scale === s.value ? ' segmented__item--active' : ''}`}
                    onClick={() => setScale(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="field__note">
                {outW}×{outH} pixels
              </p>
            </div>

            {(isVideo || format !== 'image/png') && (
              <div className="field">
                <span className="field__label">Quality</span>
                <div className="segmented">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.value}
                      className={`segmented__item${quality === q.value ? ' segmented__item--active' : ''}`}
                      onClick={() => setQuality(q.value)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isVideo && (
              <div className="field">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                  />
                  Keep the original audio
                </label>
              </div>
            )}

            {plan && (
              <div className={`callout${plan.realtime ? ' callout--warn' : ''}`}>
                {plan.realtime ? <IconWarn /> : <IconInfo />}
                <span>
                  <strong>{plan.container}</strong> · {plan.note}
                  {plan.realtime && media.duration
                    ? ` This clip will take roughly ${Math.ceil(media.duration)}s.`
                    : ''}
                </span>
              </div>
            )}
          </>
        )}

        {running && (
          <div className="progress">
            <div className="progress__bar">
              <div className="progress__fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="progress__row">
              <span>{message}</span>
              <span className="progress__pct">{Math.round(progress * 100)}%</span>
            </div>
          </div>
        )}

        {done && (
          <div className="callout">
            <IconInfo />
            <span>Saved to your downloads — {done}</span>
          </div>
        )}

        {warnings.map((w) => (
          <div className="callout callout--warn" key={w}>
            <IconWarn />
            <span>{w}</span>
          </div>
        ))}

        {error && (
          <div className="callout callout--error">
            <IconWarn />
            <span>{error}</span>
          </div>
        )}

        <div className="sheet__actions">
          {running ? (
            <button className="btn-secondary" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={onClose}>
                {done ? 'Done' : 'Cancel'}
              </button>
              <button className="btn-primary" onClick={run}>
                {done ? 'Export Again' : 'Export'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
