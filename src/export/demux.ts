import MP4Box from 'mp4box';

// mp4box reports unknown boxes at error level while still parsing the file
// correctly, and its own maximum log level is "error", so setLogLevel cannot
// quiet them. Silence its logger directly instead: genuine failures still reach
// us through file.onError and the promise rejection below.
try {
  if (MP4Box.Log) MP4Box.Log.error = () => {};
} catch {
  /* older builds expose no Log */
}

export interface DemuxedAudio {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description: Uint8Array | null;
  chunks: EncodedAudioChunk[];
}

export interface DemuxedVideo {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** Clockwise display rotation from the track's transform matrix. */
  rotation: number;
  timescale: number;
  durationSeconds: number;
  fps: number;
  description: Uint8Array | null;
  chunks: EncodedVideoChunk[];
}

export interface DemuxResult {
  video: DemuxedVideo;
  audio: DemuxedAudio | null;
}

/** Pull the raw avcC / hvcC / av1C payload the decoder needs as its `description`. */
function videoDescription(file: any, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId);
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(stream);
      // Strip the 8-byte box header; the decoder wants the payload only.
      return new Uint8Array(stream.buffer.slice(8));
    }
  }
  return null;
}

/** AAC needs its DecoderSpecificInfo, buried in the esds box, to be passed through. */
function audioDescription(file: any, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId);
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const esds = entry.esds;
    const data = esds?.esd?.descs?.[0]?.descs?.[0]?.data;
    if (data) return new Uint8Array(data);
  }
  return null;
}

/** Derive 0/90/180/270 from the 3x3 fixed-point display matrix. */
function rotationFromMatrix(matrix: ArrayLike<number> | undefined): number {
  if (!matrix || matrix.length < 5) return 0;
  const a = Number(matrix[0]);
  const b = Number(matrix[1]);
  if (!a && !b) return 0;
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/**
 * Parses an MP4/MOV into encoded chunks WebCodecs can consume.
 *
 * Note this holds the whole file plus its sample table in memory, which is the
 * practical ceiling on input size for the client-side path.
 */
export function demux(buffer: ArrayBuffer): Promise<DemuxResult> {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    const videoChunks: EncodedVideoChunk[] = [];
    const audioChunks: EncodedAudioChunk[] = [];
    let info: any = null;
    let videoTrackId = -1;
    let audioTrackId = -1;
    let pending = 0;

    file.onError = (e: unknown) => reject(new Error(`Could not parse this file: ${e}`));

    file.onReady = (parsed: any) => {
      info = parsed;
      if (!parsed.videoTracks?.length) {
        reject(new Error('No video track found in this file.'));
        return;
      }
      videoTrackId = parsed.videoTracks[0].id;
      pending += 1;
      file.setExtractionOptions(videoTrackId, null, { nbSamples: Number.MAX_SAFE_INTEGER });

      const audio = parsed.audioTracks?.[0];
      if (audio && /^mp4a/.test(audio.codec)) {
        audioTrackId = audio.id;
        pending += 1;
        file.setExtractionOptions(audioTrackId, null, { nbSamples: Number.MAX_SAFE_INTEGER });
      }
      file.start();
    };

    file.onSamples = (id: number, _user: unknown, samples: any[]) => {
      for (const s of samples) {
        const micros = (n: number) => Math.round((n * 1_000_000) / s.timescale);
        if (id === videoTrackId) {
          videoChunks.push(
            new EncodedVideoChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: micros(s.cts),
              duration: micros(s.duration),
              data: s.data,
            }),
          );
        } else if (id === audioTrackId) {
          audioChunks.push(
            new EncodedAudioChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: micros(s.cts),
              duration: micros(s.duration),
              data: s.data,
            }),
          );
        }
      }
      // Release mp4box's own copy as we go; the chunks hold what we need.
      file.releaseUsedSamples(id, samples[samples.length - 1].number + 1);
    };

    const finish = () => {
      try {
        if (!info) {
          reject(new Error('This file has no readable MP4 metadata.'));
          return;
        }
        const vt = info.videoTracks[0];
        const durationSeconds = (info.duration ?? 0) / (info.timescale || 1);
        const trackSeconds = vt.duration / (vt.timescale || 1);
        const seconds = trackSeconds || durationSeconds || 0;

        const rotation = rotationFromMatrix(vt.matrix);
        const swapped = rotation === 90 || rotation === 270;
        // The visual sample entry carries coded dimensions, which is what the
        // decoder wants. tkhd's track_width/height are *display* dimensions and
        // already have rotation applied, so only fall back to them with care.
        const codedWidth = vt.video?.width || (swapped ? vt.track_height : vt.track_width) || 0;
        const codedHeight = vt.video?.height || (swapped ? vt.track_width : vt.track_height) || 0;

        const video: DemuxedVideo = {
          codec: vt.codec,
          codedWidth,
          codedHeight,
          rotation,
          timescale: vt.timescale,
          durationSeconds: seconds,
          fps: seconds > 0 ? videoChunks.length / seconds : 30,
          description: videoDescription(file, videoTrackId),
          chunks: videoChunks,
        };

        let audio: DemuxedAudio | null = null;
        const at = info.audioTracks?.[0];
        if (at && audioTrackId >= 0 && audioChunks.length) {
          audio = {
            codec: at.codec,
            sampleRate: at.audio?.sample_rate ?? 48000,
            numberOfChannels: at.audio?.channel_count ?? 2,
            description: audioDescription(file, audioTrackId),
            chunks: audioChunks,
          };
          if (!audio.description) audio = null; // no config = cannot remux safely
        }

        resolve({ video, audio });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    // mp4box signals completion per track via onFlush-style callbacks; we count
    // tracks down and finish once every extraction has drained.
    file.onFlush = () => {
      pending -= 1;
      if (pending <= 0) finish();
    };

    try {
      const buf = buffer as ArrayBuffer & { fileStart: number };
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
      // Some mp4box builds do not emit onFlush per track; fall through safely.
      if (pending > 0) {
        pending = 0;
        finish();
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
