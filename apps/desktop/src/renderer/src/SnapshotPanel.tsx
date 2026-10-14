import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '@gleech/project-model';
import { InfoTooltip } from './InfoTooltip';
import { StagesIcon, CameraIcon, BakeIcon } from './Icons';

interface Props {
  project: ProjectState;
  thumbnails: ReadonlyMap<string, string>;
  disabled: boolean;
  onCapture(bake: boolean): void;
  onRestore(id: string | null, mode: 'recipe' | 'source'): void;
  onRename(id: string, name: string): void;
}
export function SnapshotPanel({
  project,
  thumbnails,
  disabled,
  onCapture,
  onRestore,
  onRename,
}: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('gleech.stages.collapsed') !== 'false';
    } catch {
      return true;
    }
  });
  if (!project.source) return null;
  const parent = project.snapshots.find((entry) => entry.id === project.sourceSnapshotId);
  // Lineage identifies the input image, not the saved recipe being edited.
  // Derive the recipe from workspace content so undo and reopened projects agree.
  const effects = JSON.stringify(project.effects);
  const currentRecipe = [...project.snapshots]
    .reverse()
    .find(
      (snapshot) =>
        snapshot.source.id === project.source!.id &&
        snapshot.masterSeed === project.masterSeed &&
        JSON.stringify(snapshot.effects) === effects,
    );
  const originIsSource = project.origin?.id === project.source.id;
  return (
    <section className="snapshot-panel" aria-label="Snapshots" data-collapsed={collapsed}>
      <div className="snapshot-heading">
        <div className="stage-label-group">
          <button
            className="stage-toggle"
            aria-expanded={!collapsed}
            aria-controls="stage-snapshots"
            aria-label={collapsed ? 'Expand stages' : 'Collapse stages'}
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              try {
                localStorage.setItem('gleech.stages.collapsed', String(next));
              } catch {
                /* Preferences may be unavailable. */
              }
            }}
          >
            <StagesIcon /> <span>Stages</span>
            <strong>{parent ? 'From ' + parent.name : 'From image'}</strong>
            <span className="stage-chevron" aria-hidden="true">
              {collapsed ? '⌃' : '⌄'}
            </span>
          </button>
          <InfoTooltip
            label="Stages"
            text="Capture snapshot keeps the full-resolution result and its editable effects. Bake and continue saves a stage, uses its rendered image as the new source, and starts an empty effect stack. Click a thumbnail to restore its recipe, or Use as source to start from its rendered image. Earlier stages stay intact; working from an earlier source creates a new branch."
          />
        </div>
        <div className="snapshot-actions">
          <button
            disabled={disabled}
            onClick={() => onCapture(false)}
            aria-label="Capture snapshot"
            title="Keep a full-resolution image and its recipe. Continue editing the current stack."
          >
            <CameraIcon />
            <span>Snapshot</span>
          </button>
          <button
            disabled={disabled}
            onClick={() => onCapture(true)}
            aria-label="Bake and continue"
            title="Capture this stage, then use its rendered image with an empty effect stack."
          >
            <BakeIcon />
            <span>Bake &amp; Continue</span>
          </button>
        </div>
      </div>
      <div className="snapshot-strip" id="stage-snapshots" hidden={collapsed}>
        {project.origin && (
          <div
            className="snapshot-card origin-card"
            data-active-source={originIsSource}
            data-selected={!currentRecipe && originIsSource && !project.effects.length}
          >
            {originIsSource && (
              <span
                className="snapshot-source-badge"
                title="Input image for the current effect stack"
              >
                Source
              </span>
            )}
            <button
              className="snapshot-preview"
              disabled={disabled}
              onClick={() => onRestore(null, 'source')}
              aria-label="Restore origin"
              aria-pressed={!currentRecipe && originIsSource && !project.effects.length}
            >
              <img src={thumbnails.get(project.origin.id)} alt="" />
              <span>Origin</span>
            </button>
            <small>Imported image</small>
          </div>
        )}
        {project.snapshots.map((snapshot, index) => {
          const parent = project.snapshots.find((entry) => entry.id === snapshot.parentId);
          const isSource = project.sourceSnapshotId === snapshot.id;
          const isRecipe = currentRecipe?.id === snapshot.id;
          return (
            <div
              className="snapshot-card"
              key={snapshot.id}
              data-snapshot-id={snapshot.id}
              data-parent-id={snapshot.parentId ?? ''}
              data-source-id={snapshot.source.id}
              data-rendered-id={snapshot.rendered.id}
              data-active-source={isSource}
              data-selected={isRecipe || (!currentRecipe && !project.effects.length && isSource)}
            >
              {isSource && (
                <span
                  className="snapshot-source-badge"
                  title="Input image for the current effect stack"
                >
                  Source
                </span>
              )}
              <button
                className="snapshot-preview"
                disabled={disabled}
                aria-label={'Restore recipe ' + snapshot.name}
                aria-pressed={isRecipe}
                onClick={() => onRestore(snapshot.id, 'recipe')}
                title={'Restore the editable recipe for ' + snapshot.name}
              >
                <img src={thumbnails.get(snapshot.rendered.id)} alt="" />
                <span title={snapshot.name}>
                  {String(index + 1).padStart(2, '0')} · {snapshot.name}
                </span>
              </button>
              <small title={parent ? 'Branch from ' + parent.name : 'Branch from imported image'}>
                ↳ {parent?.name ?? 'Image'}
              </small>
              <div className="snapshot-card-actions">
                <button
                  disabled={disabled}
                  onClick={() => onRestore(snapshot.id, 'source')}
                  aria-label={'Use ' + snapshot.name + ' as source'}
                  aria-pressed={isSource}
                >
                  Use as source
                </button>
                <button
                  disabled={disabled}
                  onClick={() => onRename(snapshot.id, snapshot.name)}
                  aria-label={'Rename ' + snapshot.name}
                  title="Rename snapshot"
                >
                  ✎
                </button>
              </div>
            </div>
          );
        })}
        {!project.snapshots.length && (
          <p className="snapshot-hint">
            Keep a stage, then build on it.
            <br />
            Earlier stages stay available here.
          </p>
        )}
      </div>
    </section>
  );
}

export function StageDialog({
  name,
  bake,
  rename,
  onClose,
  onSubmit,
}: {
  name: string;
  bake: boolean;
  rename: boolean;
  onClose(): void;
  onSubmit(name: string): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  useEffect(() => {
    const dialog = modal.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    input.current?.select();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog"
      aria-labelledby="stage-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h2 id="stage-dialog-title">
          {rename ? 'Rename snapshot' : bake ? 'Bake and continue' : 'Capture snapshot'}
        </h2>
        {!rename && (
          <p>
            {bake
              ? 'Save this stage and start a new effect stack from its full-resolution image.'
              : 'Keep the full-resolution result and everything needed to restore its recipe.'}
          </p>
        )}
        <label>
          Snapshot name
          <input
            ref={input}
            aria-label="Snapshot name"
            value={value}
            maxLength={120}
            required
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <div className="stage-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!value.trim()} type="submit">
            {rename ? 'Rename' : bake ? 'Bake stage' : 'Capture stage'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
