export interface Capabilities {
  webgl2: boolean;
  webCodecs: boolean;
  mediaRecorder: boolean;
  /** Best container MediaRecorder can give us on this browser. */
  recorderMime: string | null;
}

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // Safari hands back real MP4
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported can throw on malformed strings in older engines */
    }
  }
  return null;
}

let cached: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
  if (cached) return cached;
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  cached = {
    webgl2,
    webCodecs:
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoDecoder !== 'undefined' &&
      typeof EncodedVideoChunk !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    recorderMime: pickRecorderMime(),
  };
  return cached;
}

/** Ask the browser whether it can actually encode H.264 at this size before we commit. */
export async function canEncodeH264(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  for (const codec of ['avc1.640028', 'avc1.4D0028', 'avc1.42E01E']) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 4_000_000,
        framerate: fps,
      });
      if (supported) return true;
    } catch {
      /* try the next profile */
    }
  }
  return false;
}

export async function pickH264Codec(
  width: number,
  height: number,
  bitrate: number,
  fps: number,
): Promise<string | null> {
  for (const codec of ['avc1.640028', 'avc1.4D0028', 'avc1.42E01E']) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (supported) return codec;
    } catch {
      /* try the next profile */
    }
  }
  return null;
}
