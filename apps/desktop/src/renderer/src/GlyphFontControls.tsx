import { useEffect, useMemo, useRef, useState } from 'react';
import {
  decodeFontCoverage,
  FONT_TILE_WIDTH,
  FONT_TILE_HEIGHT,
  type GlyphEffect,
  type GlyphFontAtlas,
} from '@gleech/project-model';
import { atlasCharacters, listLocalFonts, rasterizeFont, type LocalFont } from './local-fonts';
import { InfoTooltip } from './InfoTooltip';

export function GlyphFontControls({
  effect,
  disabled,
  onApply,
}: {
  effect: GlyphEffect;
  disabled: boolean;
  onApply(atlas: GlyphFontAtlas): void;
}) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<readonly LocalFont[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const needed = atlasCharacters(effect.params);
  const incomplete =
    effect.glyphFont &&
    Array.from(needed).some((character) => !effect.glyphFont!.characters.includes(character));
  const choose = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setFonts(await listLocalFonts());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read installed fonts.');
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="glyph-font-controls" aria-label="Installed glyph font">
      <div className="glyph-font-heading">
        <span>
          Font{' '}
          <InfoTooltip
            label="Installed font"
            text="Choose a Windows-installed font. Character images are saved with projects and presets. Update characters after adding new text. Characters the font does not support appear as outlined diamonds."
          />
        </span>
      </div>
      <button
        className="glyph-font-selector"
        role="combobox"
        aria-label="Installed font"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'glyph-font-picker' : undefined}
        disabled={disabled}
        title={
          effect.glyphFont
            ? `${effect.glyphFont.family} · ${effect.glyphFont.style}`
            : 'Choose a Windows-installed font'
        }
        onClick={() => void choose()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            void choose();
          }
        }}
      >
        <span>
          {effect.glyphFont
            ? `${effect.glyphFont.family} · ${effect.glyphFont.style}`
            : 'Choose font…'}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {effect.glyphFont ? (
        <>
          <FontPreview atlas={effect.glyphFont} />
          {incomplete && <p className="quiet">New characters need an updated character sheet.</p>}
        </>
      ) : (
        <p className="quiet">Choose a font to replace the built-in character shapes.</p>
      )}
      {incomplete && (
        <button disabled={disabled} onClick={() => void choose()}>
          Update characters
        </button>
      )}
      {open && (
        <FontPicker
          fonts={fonts}
          loading={loading}
          error={error}
          characters={needed}
          current={effect.glyphFont?.postscriptName}
          onRetry={() => void choose()}
          onClose={() => setOpen(false)}
          onApply={(atlas) => {
            onApply(atlas);
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function FontPicker({
  fonts,
  loading,
  error,
  characters,
  current,
  onRetry,
  onClose,
  onApply,
}: {
  fonts: readonly LocalFont[];
  loading: boolean;
  error: string | null;
  characters: string;
  current: string | undefined;
  onRetry(): void;
  onClose(): void;
  onApply(atlas: GlyphFontAtlas): void;
}) {
  const modal = useRef<HTMLDialogElement>(null),
    sequence = useRef({ value: 0 });
  const [search, setSearch] = useState('');
  const [atlas, setAtlas] = useState<GlyphFontAtlas | null>(null);
  const [selected, setSelected] = useState(current ?? '');
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      fonts.filter((font) =>
        `${font.family} ${font.style} ${font.fullName}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [fonts, search],
  );
  useEffect(() => {
    const dialog = modal.current!,
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const request = sequence.current;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      request.value++;
      dialog.close();
      opener?.focus();
    };
  }, []);
  const select = async (font: LocalFont) => {
    const id = ++sequence.current.value;
    setSelected(font.postscriptName);
    setWorking(true);
    setFailure(null);
    setAtlas(null);
    try {
      const sheet = await rasterizeFont(font, characters);
      if (id === sequence.current.value) setAtlas(sheet);
    } catch (problem) {
      if (id === sequence.current.value)
        setFailure(problem instanceof Error ? problem.message : 'Could not draw this font.');
    } finally {
      if (id === sequence.current.value) setWorking(false);
    }
  };
  return (
    <dialog
      ref={modal}
      id="glyph-font-picker"
      className="glyph-font-picker"
      aria-labelledby="glyph-font-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <h2 id="glyph-font-title">Choose glyph font</h2>
        <button aria-label="Close font picker" onClick={onClose}>
          ×
        </button>
      </header>
      <label>
        Installed fonts
        <input
          type="search"
          aria-label="Search installed fonts"
          placeholder="Search families and styles…"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>
      <div className="glyph-font-picker-body">
        <div className="glyph-font-list" aria-label="Font faces">
          {loading ? (
            <p role="status">Reading installed fonts…</p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button onClick={onRetry}>Retry fonts</button>
            </div>
          ) : filtered.length ? (
            filtered.map((font) => (
              <button
                key={font.postscriptName}
                aria-pressed={selected === font.postscriptName}
                onClick={() => void select(font)}
              >
                <strong>{font.family}</strong>
                <span>{font.style}</span>
              </button>
            ))
          ) : (
            <p>No matching fonts.</p>
          )}
        </div>
        <div className="glyph-font-preview-panel">
          {working ? (
            <p role="status">Drawing character preview…</p>
          ) : atlas ? (
            <>
              <h3>{atlas.family}</h3>
              <p>{atlas.style}</p>
              <FontPreview atlas={atlas} expanded />
              {atlas.missing && (
                <p className="quiet">Unsupported characters appear as outlined diamonds.</p>
              )}
              <p className="quiet">This character sheet is saved with your projects and presets.</p>
            </>
          ) : (
            <p className="quiet">Select a font face to preview its actual glyphs.</p>
          )}
          {failure && <p role="alert">{failure}</p>}
        </div>
      </div>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary-button"
          disabled={!atlas || working || loading || Boolean(error)}
          onClick={() => {
            if (atlas) onApply(atlas);
          }}
        >
          Use font
        </button>
      </footer>
    </dialog>
  );
}
function FontPreview({ atlas, expanded = false }: { atlas: GlyphFontAtlas; expanded?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const chars = Array.from(atlas.characters),
      coverage = decodeFontCoverage(atlas.data, chars.length);
    const sample = Array.from(expanded ? 'GLEECHAa0123#@ .:+*' : 'Aa012#@');
    const context = canvas.current!.getContext('2d')!;
    context.clearRect(0, 0, canvas.current!.width, canvas.current!.height);
    for (let index = 0; index < sample.length; index++) {
      const slot = chars.indexOf(sample[index]!);
      if (slot < 0) continue;
      const pixels = new Uint8ClampedArray(FONT_TILE_WIDTH * FONT_TILE_HEIGHT * 4);
      for (let i = 0; i < pixels.length / 4; i++) {
        pixels.set([235, 211, 152], i * 4);
        pixels[i * 4 + 3] = coverage[slot * FONT_TILE_WIDTH * FONT_TILE_HEIGHT + i]!;
      }
      context.putImageData(
        new ImageData(pixels, FONT_TILE_WIDTH, FONT_TILE_HEIGHT),
        (index % (expanded ? 6 : 7)) * FONT_TILE_WIDTH,
        Math.floor(index / (expanded ? 6 : 7)) * FONT_TILE_HEIGHT,
      );
    }
  }, [atlas, expanded]);
  return (
    <canvas
      ref={canvas}
      className="glyph-font-preview"
      width={FONT_TILE_WIDTH * (expanded ? 6 : 7)}
      height={FONT_TILE_HEIGHT * (expanded ? 3 : 1)}
      role="img"
      aria-label={`${atlas.family} ${atlas.style} glyph preview`}
    />
  );
}
