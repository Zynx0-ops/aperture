import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Renderer } from '../engine/renderer';
import type { Adjustments } from '../engine/adjustments';
import type { LoadedMedia } from '../hooks/useMedia';
import { IconPlay, IconPause } from './icons';
import { formatDuration } from '../export/download';

interface Props {
  media: LoadedMedia;
  adjustments: Adjustments;
  compareMode: boolean;
  onRendererError: (message: string) => void;
}

/** Cap the preview buffer; a 48MP still does not need 48MP of preview. */
const MAX_PREVIEW_EDGE = 2400;

export function Stage({ media, adjustments, compareMode, onRendererError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const frameRef = useRef(0);
  const rafRef = useRef(0);
  const adjRef = useRef(adjustments);
  const splitRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [split, setSplit] = useState(0.5);
  const [box, setBox] = useState({ width: 0, height: 0 });

  adjRef.current = adjustments;
  splitRef.current = compareMode ? split : null;

  const stageRef = useRef<HTMLDivElement>(null);

  // ---- Renderer lifecycle -------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      rendererRef.current = new Renderer(canvasRef.current);
    } catch (err) {
      onRendererError(err instanceof Error ? err.message : String(err));
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [onRendererError]);

  // ---- Fit the frame into the stage --------------------------------------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const padding = 80;
      const availW = Math.max(120, rect.width - padding);
      const availH = Math.max(120, rect.height - padding);
      const scale = Math.min(availW / media.width, availH / media.height, 1);
      setBox({
        width: Math.round(media.width * scale),
        height: Math.round(media.height * scale),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [media.width, media.height]);

  // ---- Draw ---------------------------------------------------------------
  const draw = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !box.width) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(
      dpr,
      MAX_PREVIEW_EDGE / Math.max(box.width, box.height),
      media.width / box.width, // never upscale past the source
    );
    renderer.resize(box.width * Math.max(scale, 0.5), box.height * Math.max(scale, 0.5));

    const source = media.kind === 'image' ? media.image : media.video;
    if (!source) return;
    const w = media.kind === 'image' ? media.width : (source as HTMLVideoElement).videoWidth;
    const h = media.kind === 'image' ? media.height : (source as HTMLVideoElement).videoHeight;
    if (!w || !h) return;

    renderer.upload(source, w, h);
    renderer.render(adjRef.current, {
      split: splitRef.current,
      rotation: 0, // the <video> element applies container rotation for us
      seed: (frameRef.current += 1) * 7.13,
    });
  }, [box.width, box.height, media]);

  // Still images redraw only when something actually changed.
  useEffect(() => {
    if (media.kind === 'image') draw();
  }, [draw, adjustments, compareMode, split, media.kind]);

  // Video runs a loop while playing, and paints one frame when parked.
  useEffect(() => {
    if (media.kind !== 'video') return;
    const video = media.video!;
    if (playing) {
      const tick = () => {
        draw();
        setTime(video.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
    draw();
  }, [playing, draw, adjustments, compareMode, split, media]);

  useEffect(() => {
    if (media.kind !== 'video') return;
    const video = media.video!;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(video.currentTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('seeked', onTime);
    };
  }, [media]);

  const togglePlay = useCallback(() => {
    const video = media.video;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [media.video]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && media.kind === 'video') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, media.kind]);

  // ---- Compare wipe -------------------------------------------------------
  const onFramePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!compareMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  // ---- Scrubbing ----------------------------------------------------------
  const scrubRef = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const el = scrubRef.current;
    const video = media.video;
    if (!el || !video || !media.duration) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = t * media.duration;
    setTime(video.currentTime);
    if (video.paused) requestAnimationFrame(() => draw());
  };

  const progress = media.duration ? Math.min(1, time / media.duration) : 0;

  return (
    <div className="stage" ref={stageRef}>
      <div
        className="stage__frame"
        style={{ width: box.width || undefined, height: box.height || undefined }}
        onPointerMove={onFramePointer}
        onPointerDown={onFramePointer}
      >
        <canvas
          ref={canvasRef}
          className="stage__canvas"
          style={{ width: box.width || undefined, height: box.height || undefined }}
        />
        {compareMode && (
          <>
            <div className="stage__badge" style={{ left: 12 }}>
              Original
            </div>
            <div className="stage__badge" style={{ left: 'auto', right: 12 }}>
              Edited
            </div>
          </>
        )}
      </div>

      {compareMode && <div className="stage__hint">Move the pointer across the image to compare</div>}

      {media.kind === 'video' && (
        <div className="transport">
          <button className="transport__play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <span className="transport__time">{formatDuration(time)}</span>
          <div
            className="transport__scrub"
            ref={scrubRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seekTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) seekTo(e.clientX);
            }}
          >
            <div className="transport__rail">
              <div className="transport__fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="transport__knob" style={{ left: `${progress * 100}%` }} />
          </div>
          <span className="transport__time">{formatDuration(media.duration)}</span>
        </div>
      )}
    </div>
  );
}
