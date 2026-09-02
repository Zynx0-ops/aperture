import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONTROLS,
  DEFAULT_ADJUSTMENTS,
  GROUPS,
  applyPreset,
  countEdits,
  isNeutral,
  matchPreset,
  type Adjustments,
  type AdjustmentKey,
  type Preset,
} from './engine/adjustments';
import { detectCapabilities } from './export/capabilities';
import { useMedia, classify } from './hooks/useMedia';
import { Dropzone } from './components/Dropzone';
import { Stage } from './components/Stage';
import { Group } from './components/Group';
import { Presets } from './components/Presets';
import { ExportSheet } from './components/ExportSheet';
import {
  IconAperture,
  IconCompare,
  IconExport,
  IconNew,
  IconReset,
  IconMoon,
  IconSun,
} from './components/icons';
import { formatBytes } from './export/download';

type Theme = 'dark' | 'light';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [compareMode, setCompareMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('aperture:theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [fatal, setFatal] = useState<string | null>(null);

  const { media, error, setError } = useMedia(file);
  const caps = useMemo(() => detectCapabilities(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aperture:theme', theme);
  }, [theme]);

  const onFile = useCallback(
    (next: File) => {
      if (!classify(next)) {
        setError('That file type is not supported. Try a JPEG, PNG, MP4 or MOV.');
        return;
      }
      setError(null);
      setFatal(null);
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setCompareMode(false);
      setFile(next);
    },
    [setError],
  );

  // Drag and drop works anywhere in the window once media is loaded.
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) onFile(dropped);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [onFile]);

  const setValue = useCallback((key: AdjustmentKey, value: number) => {
    setAdjustments((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const resetAll = useCallback(() => setAdjustments(DEFAULT_ADJUSTMENTS), []);

  const resetGroup = useCallback((groupId: string) => {
    setAdjustments((prev) => {
      const next = { ...prev };
      for (const c of CONTROLS) if (c.group === groupId) next[c.key] = 0;
      return next;
    });
  }, []);

  const pickPreset = useCallback((preset: Preset) => setAdjustments(applyPreset(preset)), []);

  const neutral = isNeutral(adjustments);
  const activePreset = useMemo(() => matchPreset(adjustments), [adjustments]);
  const totalEdits = countEdits(adjustments);

  // ---- Shortcuts ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === '\\') {
        e.preventDefault();
        setCompareMode((v) => !v);
      } else if (e.key.toLowerCase() === 'r' && media) {
        e.preventDefault();
        resetAll();
      } else if (e.key.toLowerCase() === 'e' && media) {
        e.preventDefault();
        setExporting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media, resetAll]);

  if (!caps.webgl2) {
    return (
      <div className="dropzone">
        <div className="dropzone__inner">
          <h1 className="dropzone__title">WebGL2 is required</h1>
          <p className="dropzone__sub">
            This editor renders every adjustment on the GPU. Enable hardware acceleration or try
            Chrome, Edge, Safari 15+ or Firefox.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__brand">
          <IconAperture />
          Aperture
        </div>

        {media && (
          <div className="toolbar__file">
            <span className="toolbar__filename" title={media.file.name}>
              {media.file.name}
            </span>
            <span className="toolbar__meta">
              {media.width}×{media.height} · {formatBytes(media.file.size)}
            </span>
          </div>
        )}

        <div className="toolbar__spacer" />

        <div className="toolbar__group">
          <button
            className="tool-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} appearance`}
            aria-label="Toggle appearance"
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>

          <button
            className={`tool-btn${compareMode ? ' tool-btn--active' : ''}`}
            onClick={() => setCompareMode((v) => !v)}
            disabled={!media}
            title="Compare with original  (\\)"
            aria-pressed={compareMode}
          >
            <IconCompare />
          </button>

          <button
            className="tool-btn"
            onClick={resetAll}
            disabled={!media || neutral}
            title="Reset all adjustments  (R)"
          >
            <IconReset />
          </button>

          <button className="tool-btn" onClick={() => setFile(null)} disabled={!media} title="Open another file">
            <IconNew />
          </button>
        </div>

        <button className="btn-primary" onClick={() => setExporting(true)} disabled={!media} title="Export  (E)">
          <IconExport />
          Export
        </button>
      </header>

      <div className={`app__body${media ? '' : ' app__body--empty'}`}>
        {media ? (
          <Stage
            media={media}
            adjustments={adjustments}
            compareMode={compareMode}
            onRendererError={setFatal}
          />
        ) : (
          <Dropzone onFile={onFile} error={fatal ?? error} />
        )}

        {media && (
          <aside className="inspector">
            <div className="inspector__scroll">
              <Presets
                thumbSource={media.kind === 'image' ? media.image : media.video}
                sourceWidth={media.width}
                sourceHeight={media.height}
                activeId={activePreset}
                onPick={pickPreset}
              />

              {GROUPS.map((g, i) => (
                <Group
                  key={g.id}
                  title={g.label}
                  controls={CONTROLS.filter((c) => c.group === g.id)}
                  adjustments={adjustments}
                  editCount={countEdits(adjustments, g.id)}
                  defaultOpen={i < 2}
                  onChange={setValue}
                  onResetGroup={() => resetGroup(g.id)}
                />
              ))}
            </div>

            <div className="inspector__footer">
              <span className="inspector__count">
                {totalEdits === 0
                  ? 'No adjustments'
                  : `${totalEdits} adjustment${totalEdits === 1 ? '' : 's'}`}
              </span>
              <button className="tool-btn" onClick={resetAll} disabled={neutral}>
                Reset
              </button>
            </div>
          </aside>
        )}
      </div>

      {exporting && media && (
        <ExportSheet media={media} adjustments={adjustments} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}
