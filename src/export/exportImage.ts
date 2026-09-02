import { Renderer } from '../engine/renderer';
import type { Adjustments } from '../engine/adjustments';

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageExportOptions {
  format: ImageFormat;
  /** 0..1, ignored for PNG. */
  quality: number;
  /** 1 = full resolution. */
  scale: number;
}

export interface ImageExportResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Renders the source at full resolution through the same shader the preview
 * uses, then encodes. The preview canvas is deliberately not reused: it is
 * downscaled for performance and would export soft.
 */
export async function exportImage(
  source: HTMLImageElement | ImageBitmap,
  naturalWidth: number,
  naturalHeight: number,
  adj: Adjustments,
  opts: ImageExportOptions,
): Promise<ImageExportResult> {
  const renderer = new Renderer();
  try {
    const max = renderer.maxTextureSize;
    if (naturalWidth > max || naturalHeight > max) {
      throw new Error(
        `Image is ${naturalWidth}x${naturalHeight}, larger than this GPU's ${max}px texture limit.`,
      );
    }

    const width = Math.max(1, Math.round(naturalWidth * opts.scale));
    const height = Math.max(1, Math.round(naturalHeight * opts.scale));

    renderer.resize(width, height);
    renderer.upload(source, naturalWidth, naturalHeight);
    renderer.render(adj, { split: null });

    const blob = await new Promise<Blob | null>((resolve) =>
      renderer.canvas.toBlob(
        resolve,
        opts.format,
        opts.format === 'image/png' ? undefined : opts.quality,
      ),
    );
    if (!blob) throw new Error('The browser refused to encode this image.');
    return { blob, width, height };
  } finally {
    renderer.dispose();
  }
}
