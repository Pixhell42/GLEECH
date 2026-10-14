import { useEffect, useRef } from 'react';
import { GLYPH_EMOJI, EMOJI_TILE_SIZE } from '@gleech/effects';

export function EmojiAtlas({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd(character: string): void;
}) {
  return (
    <details className="emoji-atlas">
      <summary>Atlas — available pixel emoji</summary>
      <p className="quiet">Original GLEECH artwork. Click to add a character to Custom set.</p>
      <div className="emoji-atlas-grid">
        {GLYPH_EMOJI.map((emoji) => (
          <button
            key={emoji.character}
            type="button"
            disabled={disabled}
            aria-label={`Add ${emoji.name} to custom emoji set`}
            title={`${emoji.name} (${emoji.character})`}
            onClick={() => onAdd(emoji.character)}
          >
            <EmojiTile pixels={emoji.pixels} />
          </button>
        ))}
      </div>
    </details>
  );
}
function EmojiTile({ pixels }: { pixels: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    ref.current
      ?.getContext('2d')
      ?.putImageData(
        new ImageData(Uint8ClampedArray.from(pixels), EMOJI_TILE_SIZE, EMOJI_TILE_SIZE),
        0,
        0,
      );
  }, [pixels]);
  return <canvas ref={ref} width={EMOJI_TILE_SIZE} height={EMOJI_TILE_SIZE} aria-hidden="true" />;
}
