import { useEffect, useRef, useState } from 'react';
import type { ImageExportOptions } from '../../shared/image-api';

export function ExportDialog({
  onClose,
  onExport,
}: {
  onClose(): void;
  onExport(options: ImageExportOptions): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<ImageExportOptions['format']>('png');
  const [quality, setQuality] = useState(90);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog export-dialog"
      aria-labelledby="export-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onExport({ format, ...(format === 'jpeg' || format === 'webp' ? { quality } : {}) });
        }}
      >
        <h2 id="export-title">Export image</h2>
        <label>
          File format
          <select
            aria-label="File format"
            value={format}
            onChange={(event) =>
              setFormat(event.currentTarget.value as ImageExportOptions['format'])
            }
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="tiff">TIFF</option>
          </select>
        </label>
        {(format === 'jpeg' || format === 'webp') && (
          <label>
            Quality <output>{quality}%</output>
            <input
              aria-label="Export quality"
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(event) => setQuality(event.currentTarget.valueAsNumber)}
            />
          </label>
        )}
        <p>
          {format === 'jpeg'
            ? 'Transparency is flattened onto white.'
            : 'Transparency is preserved.'}{' '}
          Export uses the edited image at its original resolution.
        </p>
        <div className="stage-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Export
          </button>
        </div>
      </form>
    </dialog>
  );
}
