import type { Adjustments } from '../engine/adjustments';
import { detectCapabilities } from './capabilities';
import {
  exportVideoWebCodecs,
  ExportAbortError,
  type VideoExportOptions,
  type VideoExportResult,
} from './exportVideoWebCodecs';
import { exportVideoRecorder } from './exportVideoRecorder';

export type VideoPipeline = 'webcodecs' | 'recorder';

export interface PipelinePlan {
  pipeline: VideoPipeline;
  container: 'MP4' | 'WebM';
  realtime: boolean;
  note: string;
}

const MP4ISH = /\.(mp4|m4v|mov)$/i;

/** What we intend to do, so the UI can be honest before the user commits. */
export function planPipeline(file: File | null, prefer: VideoPipeline | 'auto'): PipelinePlan {
  const caps = detectCapabilities();
  const demuxable = !!file && (MP4ISH.test(file.name) || /mp4|quicktime/.test(file.type));

  const canUseWebCodecs = caps.webCodecs && demuxable && prefer !== 'recorder';
  if (canUseWebCodecs) {
    return {
      pipeline: 'webcodecs',
      container: 'MP4',
      realtime: false,
      note: 'Full resolution H.264, faster than realtime, original audio preserved.',
    };
  }

  const container = caps.recorderMime?.includes('mp4') ? 'MP4' : 'WebM';
  const why = !caps.webCodecs
    ? 'WebCodecs is unavailable in this browser'
    : 'this container cannot be demuxed in-browser';
  const note =
    `Because ${why}, the canvas is recorded in realtime as ${container}. ` +
    'Keep this tab visible and in the foreground until it finishes.';
  return { pipeline: 'recorder', container, realtime: true, note };
}

/**
 * Runs the preferred pipeline and quietly falls back if it fails part-way.
 * A failed WebCodecs run is recoverable — a realtime recording still gets the
 * user a finished file.
 */
export async function exportVideo(
  file: File,
  adj: Adjustments,
  opts: VideoExportOptions & { prefer?: VideoPipeline | 'auto' },
): Promise<VideoExportResult & { pipeline: VideoPipeline }> {
  const plan = planPipeline(file, opts.prefer ?? 'auto');

  if (plan.pipeline === 'webcodecs') {
    try {
      const result = await exportVideoWebCodecs(file, adj, opts);
      return { ...result, pipeline: 'webcodecs' };
    } catch (err) {
      if (err instanceof ExportAbortError || opts.signal?.aborted) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      opts.onProgress?.(0, 'Falling back to realtime recording');
      const result = await exportVideoRecorder(file, adj, opts);
      return {
        ...result,
        pipeline: 'recorder',
        warnings: [
          `The fast MP4 pipeline failed (${reason}), so this was recorded in realtime instead.`,
          ...result.warnings,
        ],
      };
    }
  }

  const result = await exportVideoRecorder(file, adj, opts);
  return { ...result, pipeline: 'recorder' };
}

export { ExportAbortError };
export type { VideoExportOptions, VideoExportResult };
