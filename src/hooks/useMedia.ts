import { useEffect, useState } from 'react';

export type MediaKind = 'image' | 'video';

export interface LoadedMedia {
  kind: MediaKind;
  file: File;
  url: string;
  width: number;
  height: number;
  /** Video only. */
  duration: number;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm|ogv|avi|mkv)$/i;

export function classify(file: File): MediaKind | null {
  if (file.type.startsWith('image/') || IMAGE_RE.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || VIDEO_RE.test(file.name)) return 'video';
  return null;
}

/** Loads a file into a decoded <img> or a metadata-ready <video>. */
export function useMedia(file: File | null) {
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) {
      setMedia(null);
      setError(null);
      return;
    }

    const kind = classify(file);
    if (!kind) {
      setError('That file type is not supported. Try a JPEG, PNG, MP4 or MOV.');
      setMedia(null);
      return;
    }

    let cancelled = false;
    const url = URL.createObjectURL(file);
    setLoading(true);
    setError(null);

    const fail = (message: string) => {
      if (cancelled) return;
      URL.revokeObjectURL(url);
      setError(message);
      setMedia(null);
      setLoading(false);
    };

    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setMedia({
          kind,
          file,
          url,
          width: img.naturalWidth,
          height: img.naturalHeight,
          duration: 0,
          image: img,
          video: null,
        });
        setLoading(false);
      };
      img.onerror = () => fail('That image could not be decoded.');
      img.src = url;
    } else {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.loop = true;
      video.crossOrigin = 'anonymous';
      video.onloadeddata = () => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setMedia({
          kind,
          file,
          url,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
          image: null,
          video,
        });
        setLoading(false);
      };
      video.onerror = () =>
        fail('That video could not be decoded by this browser. MP4 (H.264) is the safest bet.');
    }

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Tear down the previous element whenever we move on.
  useEffect(
    () => () => {
      if (media?.video) {
        media.video.pause();
        media.video.removeAttribute('src');
        media.video.load();
      }
    },
    [media],
  );

  return { media, error, loading, setError };
}
