import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Renderer } from '../engine/renderer';
import type { Adjustments } from '../engine/adjustments';
import { demux } from './demux';
import { pickH264Codec } from './capabilities';

export type ExportQuality = 'high' | 'balanced' | 'small';

export interface VideoExportOptions {
  scale: number;
  quality: ExportQuality;
  includeAudio: boolean;
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  width: number;
  height: number;
  extension: string;
  hasAudio: boolean;
  /** Surfaced to the user when we had to drop something, e.g. an exotic audio codec. */
  warnings: string[];
}

const BITS_PER_PIXEL: Record<ExportQuality, number> = {
  high: 0.15,
  balanced: 0.09,
  small: 0.05,
};

export class ExportAbortError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'ExportAbortError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAbortError();
}

/**
 * Wait until a codec's queue drains, so we never buffer the whole clip in RAM.
 *
 * Driven by the `dequeue` event rather than a polling timer: background tabs
 * clamp setTimeout to roughly one second, which would turn a fast export into a
 * multi-minute crawl the moment the user switches away. The interval is only a
 * safety net for engines that do not fire the event.
 */
function drainTo(
  codec: VideoDecoder | VideoEncoder,
  getSize: () => number,
  max: number,
  getFatal: () => Error | null,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      codec.removeEventListener('dequeue', check);
      clearInterval(timer);
    };
    function check() {
      if (settled) return;
      if (signal?.aborted) {
        cleanup();
        reject(new ExportAbortError());
        return;
      }
      const fatal = getFatal();
      if (fatal) {
        cleanup();
        reject(fatal);
        return;
      }
      if (getSize() <= max) {
        cleanup();
        resolve();
      }
    }
    const timer = setInterval(check, 200);
    codec.addEventListener('dequeue', check);
    check();
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The high-quality path: demux -> VideoDecoder -> WebGL -> VideoEncoder -> MP4.
 *
 * Runs as fast as the hardware allows rather than in realtime, keeps full
 * resolution, and passes the original AAC audio through without re-encoding it.
 */
export async function exportVideoWebCodecs(
  file: File,
  adj: Adjustments,
  opts: VideoExportOptions,
): Promise<VideoExportResult> {
  const { scale, quality, includeAudio, onProgress, signal } = opts;
  const warnings: string[] = [];
  const report = (p: number, m: string) => onProgress?.(Math.min(1, Math.max(0, p)), m);

  report(0, 'Reading file');
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);

  report(0.04, 'Analyzing video');
  const { video, audio } = await demux(buffer);
  throwIfAborted(signal);

  if (!video.chunks.length) throw new Error('No decodable video frames were found.');
  if (!video.description) {
    throw new Error(`This file's video codec (${video.codec}) cannot be re-encoded in the browser.`);
  }

  // Display dimensions: rotation swaps the axes.
  const rotated = video.rotation === 90 || video.rotation === 270;
  const displayW = rotated ? video.codedHeight : video.codedWidth;
  const displayH = rotated ? video.codedWidth : video.codedHeight;
  if (!displayW || !displayH) throw new Error('Could not determine the video dimensions.');

  const outW = even(displayW * scale);
  const outH = even(displayH * scale);
  const fps = Math.min(120, Math.max(1, Math.round(video.fps || 30)));
  const bitrate = Math.round(
    Math.min(40_000_000, Math.max(500_000, outW * outH * fps * BITS_PER_PIXEL[quality])),
  );

  const codec = await pickH264Codec(outW, outH, bitrate, fps);
  if (!codec) throw new Error(`This browser cannot encode H.264 at ${outW}x${outH}.`);

  const useAudio = includeAudio && !!audio;
  if (includeAudio && !audio) {
    warnings.push('Audio was not carried over: the source track is missing or uses a codec we cannot copy.');
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: outW, height: outH },
    ...(useAudio && audio
      ? {
          audio: {
            codec: 'aac',
            numberOfChannels: audio.numberOfChannels,
            sampleRate: audio.sampleRate,
          },
        }
      : {}),
  });

  const renderer = new Renderer();
  renderer.resize(outW, outH);

  let fatal: Error | null = null;
  let encodedCount = 0;
  let decodedCount = 0;
  const total = video.chunks.length;
  const keyInterval = Math.max(1, Math.round(fps * 2));

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      encodedCount += 1;
    },
    error: (e) => {
      fatal ??= new Error(`Encoder failed: ${e.message}`);
    },
  });
  encoder.configure({
    codec,
    width: outW,
    height: outH,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        if (fatal) return;
        renderer.upload(frame, frame.codedWidth, frame.codedHeight);
        renderer.render(adj, { split: null, rotation: video.rotation, seed: decodedCount * 7.13 });
        const processed = new VideoFrame(renderer.canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? undefined,
        });
        encoder.encode(processed, { keyFrame: decodedCount % keyInterval === 0 });
        processed.close();
        decodedCount += 1;
        if (decodedCount % 4 === 0 || decodedCount === total) {
          report(0.08 + 0.86 * (decodedCount / total), `Processing frame ${decodedCount} of ${total}`);
        }
      } catch (err) {
        fatal ??= err instanceof Error ? err : new Error(String(err));
      } finally {
        frame.close();
      }
    },
    error: (e) => {
      fatal ??= new Error(`Decoder failed: ${e.message}`);
    },
  });
  decoder.configure({
    codec: video.codec,
    description: video.description,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
  });

  try {
    // Audio is a straight copy, so push it up front and let the muxer interleave.
    if (useAudio && audio) {
      const meta: EncodedAudioChunkMetadata = {
        decoderConfig: {
          codec: audio.codec,
          sampleRate: audio.sampleRate,
          numberOfChannels: audio.numberOfChannels,
          description: audio.description ?? undefined,
        },
      };
      audio.chunks.forEach((chunk, i) => muxer.addAudioChunk(chunk, i === 0 ? meta : undefined));
    }

    report(0.08, `Processing ${total} frames`);
    for (const chunk of video.chunks) {
      throwIfAborted(signal);
      if (fatal) throw fatal;
      await drainTo(decoder, () => decoder.decodeQueueSize, 12, () => fatal, signal);
      await drainTo(encoder, () => encoder.encodeQueueSize, 12, () => fatal, signal);
      decoder.decode(chunk);
    }

    await decoder.flush();
    if (fatal) throw fatal;
    await encoder.flush();
    if (fatal) throw fatal;

    report(0.97, 'Writing MP4');
    muxer.finalize();

    if (encodedCount === 0) throw new Error('No frames made it through the encoder.');

    report(1, 'Done');
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      width: outW,
      height: outH,
      extension: 'mp4',
      hasAudio: useAudio,
      warnings,
    };
  } finally {
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch { /* already torn down */ }
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch { /* already torn down */ }
    renderer.dispose();
  }
}
