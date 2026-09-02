import { Renderer } from '../engine/renderer';
import type { Adjustments } from '../engine/adjustments';
import { pickRecorderMime } from './capabilities';
import { ExportAbortError } from './exportVideoWebCodecs';
import type { VideoExportOptions, VideoExportResult, ExportQuality } from './exportVideoWebCodecs';

const BITS_PER_PIXEL: Record<ExportQuality, number> = {
  high: 0.18,
  balanced: 0.11,
  small: 0.06,
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Taps the element's audio into a MediaStream without routing it to the
 * speakers, so an export does not blast sound at the user.
 */
function tapAudio(el: HTMLVideoElement): { track: MediaStreamTrack | null; close: () => void } {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return { track: null, close: () => {} };
    const ctx: AudioContext = new Ctx();
    const source = ctx.createMediaElementSource(el);
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest); // deliberately NOT connected to ctx.destination
    void ctx.resume();
    return {
      track: dest.stream.getAudioTracks()[0] ?? null,
      close: () => void ctx.close().catch(() => {}),
    };
  } catch {
    return { track: null, close: () => {} };
  }
}

/**
 * The compatibility path: play the clip once, render every frame through the
 * same shader, and record the canvas.
 *
 * Bound to realtime by construction — MediaRecorder timestamps frames against
 * the wall clock, so a 60-second clip takes 60 seconds and playing it faster
 * would simply produce a fast-motion file.
 */
export async function exportVideoRecorder(
  file: File,
  adj: Adjustments,
  opts: VideoExportOptions,
): Promise<VideoExportResult> {
  const { scale, quality, includeAudio, onProgress, signal } = opts;
  const warnings: string[] = [];
  const mime = pickRecorderMime();
  if (!mime) throw new Error('This browser cannot record video from a canvas.');

  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.src = url;
  // A muted element is exempt from autoplay restrictions, so only unmute when
  // we actually need the audio tap to carry signal.
  el.muted = !includeAudio;
  el.playsInline = true;
  el.preload = 'auto';

  const renderer = new Renderer();
  let audioTap: { track: MediaStreamTrack | null; close: () => void } = { track: null, close: () => {} };
  let raf = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('This video could not be decoded for playback.'));
    });

    // videoWidth/Height already reflect any container rotation for an element.
    const outW = even(el.videoWidth * scale);
    const outH = even(el.videoHeight * scale);
    if (!outW || !outH) throw new Error('Could not determine the video dimensions.');
    renderer.resize(outW, outH);

    const fps = 30;
    const stream = renderer.canvas.captureStream(fps);

    if (includeAudio) {
      audioTap = tapAudio(el);
      if (audioTap.track) stream.addTrack(audioTap.track);
      else warnings.push('Audio could not be captured on this browser, so the export is silent.');
    }

    const bitrate = Math.round(
      Math.min(40_000_000, Math.max(500_000, outW * outH * fps * BITS_PER_PIXEL[quality])),
    );
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 128_000,
    });

    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };

    const finished = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Recording failed part-way through.'));
    });

    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    let frameIndex = 0;
    let stopped = false;
    let stalled = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    /**
     * Realtime capture depends on the element actually playing. Browsers pause
     * background media to save power, and rAF stops firing in a hidden tab, so
     * without this the export would wait forever on a clip that never advances.
     */
    let lastTime = -1;
    let lastAdvance = performance.now();
    watchdog = setInterval(() => {
      if (stopped) return;
      if (el.currentTime !== lastTime) {
        lastTime = el.currentTime;
        lastAdvance = performance.now();
        return;
      }
      if (performance.now() - lastAdvance > 6000) {
        stalled = true;
        stop();
      }
    }, 500);

    const draw = () => {
      if (stopped) return;
      if (signal?.aborted) {
        stop();
        return;
      }
      if (el.readyState >= 2) {
        renderer.upload(el, el.videoWidth, el.videoHeight);
        renderer.render(adj, { split: null, rotation: 0, seed: frameIndex * 7.13 });
        frameIndex += 1;
      }
      if (duration) {
        onProgress?.(
          Math.min(0.98, el.currentTime / duration),
          `Recording ${el.currentTime.toFixed(1)}s of ${duration.toFixed(1)}s`,
        );
      }
      raf = requestAnimationFrame(draw);
    };

    el.onended = stop;
    el.currentTime = 0;
    onProgress?.(0, 'Starting playback');

    recorder.start(1000);
    try {
      await el.play();
    } catch (err) {
      stop();
      throw new Error(
        'Playback could not start, which realtime recording depends on. Keep this tab ' +
          `in the foreground and try again. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    draw();

    await finished;
    if (signal?.aborted) throw new ExportAbortError();
    if (stalled) {
      throw new Error(
        'Playback stalled, so the recording was cut short. Realtime export needs this tab ' +
          'to stay visible and in the foreground for the whole clip.',
      );
    }

    onProgress?.(0.99, 'Finalizing');
    const blob = new Blob(parts, { type: mime });
    if (!blob.size) throw new Error('The recording came back empty.');

    return {
      blob,
      width: outW,
      height: outH,
      extension: mime.includes('mp4') ? 'mp4' : 'webm',
      hasAudio: includeAudio && !!audioTap.track,
      warnings,
    };
  } finally {
    cancelAnimationFrame(raf);
    clearInterval(watchdog);
    try {
      el.pause();
    } catch { /* nothing playing */ }
    audioTap.close();
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
    renderer.dispose();
  }
}
