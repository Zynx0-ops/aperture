import { useRef, useState } from 'react';
import { IconUpload } from './icons';

interface Props {
  onFile: (file: File) => void;
  error: string | null;
}

export function Dropzone({ onFile, error }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <div className="dropzone__inner">
        <IconUpload />
        <h1 className="dropzone__title">Drop a photo or video</h1>
        <p className="dropzone__sub">
          Everything happens on this device. Your media is never uploaded anywhere.
        </p>
        <button className="btn-primary" onClick={() => inputRef.current?.click()}>
          Choose File
        </button>
        <span className="dropzone__formats">JPEG · PNG · WebP · HEIC-free MP4 · MOV · WebM</span>
        {error && <p className="dropzone__error">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
