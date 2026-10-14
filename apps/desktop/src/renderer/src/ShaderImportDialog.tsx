import { useEffect, useRef, useState } from 'react';
import type { ShaderPackage } from '@gleech/project-model/shader-package';

export type ShaderImportRequest =
  { kind: 'file' } | { kind: 'url'; url: string } | { kind: 'code'; code: string };
export interface ShaderImportPreview {
  pkg: ShaderPackage;
  thumbnail: string;
}

const tabs = ['Local File', 'URL', 'Paste Code'] as const;

export function ShaderImportDialog({
  busy,
  error,
  preview,
  onClose,
  onBack,
  onPrepare,
  onImport,
}: {
  busy: boolean;
  error: string | null;
  preview: ShaderImportPreview | null;
  onClose(): void;
  onBack(): void;
  onPrepare(request: ShaderImportRequest): void;
  onImport(pkg: ShaderPackage): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Local File');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    if (preview) modal.current?.querySelector<HTMLHeadingElement>('h2')?.focus();
    else
      modal.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
  }, [preview]);
  return (
    <dialog
      ref={modal}
      className="stage-dialog shader-import-dialog"
      aria-labelledby="shader-import-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id="shader-import-title" tabIndex={-1}>
        {preview ? 'Preview Shader' : 'Add Shader'}
      </h2>
      {preview ? (
        <ShaderImportReview
          key={preview.pkg.id}
          preview={preview}
          busy={busy}
          error={error}
          onBack={onBack}
          onClose={onClose}
          onImport={onImport}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (tab === 'URL' && url.trim()) onPrepare({ kind: 'url', url: url.trim() });
            if (tab === 'Paste Code' && code.trim()) onPrepare({ kind: 'code', code });
          }}
        >
          <p>Import a GLEECH package, WGSL function, or compatible single-pass ISF shader.</p>
          <div className="shader-import-tabs" role="tablist" aria-label="Shader import method">
            {tabs.map((name, index) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`shader-import-tab-${index}`}
                aria-controls="shader-import-source"
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                disabled={busy}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                  else if (event.key === 'ArrowLeft')
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setTab(tabs[next]!);
                  modal.current
                    ?.querySelector<HTMLButtonElement>(`#shader-import-tab-${next}`)
                    ?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            id="shader-import-source"
            role="tabpanel"
            aria-labelledby={`shader-import-tab-${tabs.indexOf(tab)}`}
          >
            {tab === 'Local File' && (
              <div className="shader-import-file">
                <p>Choose a shader to preview before adding it to your library.</p>
                <button type="button" disabled={busy} onClick={() => onPrepare({ kind: 'file' })}>
                  Choose Local File…
                </button>
              </div>
            )}
            {tab === 'URL' && (
              <label>
                Direct HTTPS URL
                <input
                  type="url"
                  aria-label="Shader URL"
                  placeholder="https://…/shader.fs"
                  value={url}
                  disabled={busy}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
                <span className="quiet">
                  Use a direct file or GitHub file link. For gallery pages, copy the shader into
                  Paste Code.
                </span>
              </label>
            )}
            {tab === 'Paste Code' && (
              <label>
                Shader source
                <textarea
                  aria-label="Shader source"
                  placeholder="Paste the complete shader, including its metadata header when available…"
                  value={code}
                  disabled={busy}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => setCode(event.currentTarget.value)}
                />
                <span className="quiet">
                  Include credits and input definitions. Unsupported shader formats show an
                  explanation before import.
                </span>
              </label>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="stage-dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            {tab !== 'Local File' && (
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !(tab === 'URL' ? url.trim() : code.trim())}
              >
                {busy ? 'Preparing…' : 'Preview Shader'}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}

function ShaderImportReview({
  preview,
  busy,
  error,
  onBack,
  onClose,
  onImport,
}: {
  preview: ShaderImportPreview;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onClose(): void;
  onImport(pkg: ShaderPackage): void;
}) {
  const { pkg, thumbnail } = preview;
  const [name, setName] = useState(pkg.name);
  const [authors, setAuthors] = useState(
    pkg.authors.map((author) => ({
      name: author.name === 'Unknown author' ? '' : author.name,
      url: author.url ?? '',
    })),
  );
  const [sourceUrl, setSourceUrl] = useState(pkg.sourceUrl ?? '');
  const [license, setLicense] = useState(
    pkg.license.expression === 'LicenseRef-Unspecified' ? '' : pkg.license.expression,
  );
  return (
    <form
      className="shader-import-review"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !name.trim()) return;
        const source = sourceUrl.trim();
        const draft = { ...pkg };
        delete draft.sourceUrl;
        onImport({
          ...draft,
          name: name.trim(),
          authors: authors.map((author) => ({
            name: author.name.trim() || 'Unknown author',
            ...(author.url.trim() ? { url: author.url.trim() } : {}),
          })),
          ...(source ? { sourceUrl: source } : {}),
          license: { ...pkg.license, expression: license.trim() || 'LicenseRef-Unspecified' },
        });
      }}
    >
      <div className="shader-import-review-body">
        <div className="shader-import-preview">
          <img src={thumbnail} alt={`${pkg.name} rendered on the sample statue`} />
          <div>
            <p className="shader-compatible">
              Compatible · {pkg.language === 'isf' ? 'ISF / WebGL2' : 'WGSL / WebGPU'}
            </p>
            <p>{pkg.description}</p>
            <p>
              {pkg.controls.length} shader {pkg.controls.length === 1 ? 'control' : 'controls'} ·{' '}
              {pkg.kind === 'image' ? 'Image effect' : 'Generator'}
            </p>
          </div>
        </div>
        <p className="quiet">
          Rendered successfully with default settings. Check the name and credits before adding it.
        </p>
        <div className="shader-import-metadata">
          <label className="shader-import-wide">
            Shader name
            <input
              aria-label="Shader name"
              value={name}
              maxLength={120}
              required
              disabled={busy}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {authors.map((author, index) => (
            <div className="shader-import-author shader-import-wide" key={index}>
              <label>
                Creator{authors.length > 1 ? ` ${index + 1}` : ''}
                <input
                  aria-label={`Shader creator ${index + 1}`}
                  value={author.name}
                  maxLength={120}
                  placeholder="Unknown author"
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setAuthors(
                      authors.map((entry, i) => (i === index ? { ...entry, name: value } : entry)),
                    );
                  }}
                />
              </label>
              <label>
                Creator link
                <input
                  aria-label={`Shader creator link ${index + 1}`}
                  type="url"
                  value={author.url}
                  maxLength={2048}
                  placeholder="https://…"
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setAuthors(
                      authors.map((entry, i) => (i === index ? { ...entry, url: value } : entry)),
                    );
                  }}
                />
              </label>
            </div>
          ))}
          <label>
            Source URL
            <input
              aria-label="Shader source URL"
              type="url"
              value={sourceUrl}
              maxLength={2048}
              placeholder="https://…"
              disabled={busy}
              onChange={(event) => setSourceUrl(event.currentTarget.value)}
            />
          </label>
          <label>
            License
            <input
              aria-label="Shader license"
              value={license}
              maxLength={256}
              placeholder="Unspecified"
              disabled={busy}
              onChange={(event) => setLicense(event.currentTarget.value)}
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="stage-dialog-actions">
        <button type="button" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Importing…' : 'Add to Library'}
        </button>
      </div>
    </form>
  );
}
