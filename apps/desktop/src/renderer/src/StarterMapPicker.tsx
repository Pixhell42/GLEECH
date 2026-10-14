import { useEffect, useRef, useState } from 'react';
import { unwrap, type StarterMapItem } from '../../shared/image-api';

export function StarterMapPicker({
  kind = 'depth',
  onChoose,
  onClose,
}: {
  kind?: 'depth' | 'vector';
  onChoose(id: string): void;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [maps, setMaps] = useState<readonly StarterMapItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  useEffect(() => {
    modal.current?.showModal();
    let active = true;
    void (kind === 'vector' ? window.gleech.listVectorMaps() : window.gleech.listDepthMaps())
      .then(unwrap)
      .then((maps) => {
        if (active) setMaps(maps);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Could not load maps.');
      });
    return () => {
      active = false;
    };
  }, [kind]);
  const visible = maps.filter(
    (map) =>
      (category === 'All' || map.category === category) &&
      `${map.name} ${map.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <dialog
      className="effect-picker depth-map-picker"
      ref={modal}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-label={`Starter ${kind} maps`}
    >
      <div className="effect-picker-heading">
        <div>
          <h2>Starter {kind} maps</h2>
          <p>
            {kind === 'vector'
              ? '2048 × 2048 · Red = horizontal, green = vertical. Arrows show motion; gray means still.'
              : '2048 × 2048 · White is high/near, black is low/far.'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={`Close ${kind} maps`}>
          Close
        </button>
      </div>
      <div className="depth-map-search">
        <input
          autoFocus
          aria-label={`Search ${kind} maps`}
          placeholder={`Search ${kind} maps`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={`${kind === 'vector' ? 'Vector' : 'Depth'} map category`}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {['All', ...new Set(maps.map((map) => map.category))].map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {!maps.length && !error && <p>Loading maps…</p>}
      {!!maps.length && !visible.length && <p>No matching maps.</p>}
      <div className="depth-map-grid">
        {visible.map((map) => (
          <button
            type="button"
            key={map.id}
            title={map.description}
            onClick={() => onChoose(map.id)}
          >
            <img src={map.thumbnail} alt="" />
            <strong>{map.name}</strong>
            <span>{map.category}</span>
          </button>
        ))}
      </div>
    </dialog>
  );
}
