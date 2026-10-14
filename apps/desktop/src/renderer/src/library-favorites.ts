import { EFFECT_DEFINITIONS } from '@gleech/project-model';

export const FAVORITES_STORAGE_KEY = 'gleech.library.favorites.v1';
export type FavoriteKind = 'effect' | 'preset' | 'shader';
export const favoriteKey = (kind: FavoriteKind, id: string) => `${kind}:${id}`;

// Library preferences belong to this installation, never to exported recipes.
export function parseFavorites(value: string | null): ReadonlySet<string> {
  try {
    const keys: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(keys) || keys.length > 10000) return new Set();
    return new Set(
      keys.filter(
        (key): key is string =>
          typeof key === 'string' &&
          key.length <= 1031 &&
          ((key.startsWith('effect:') && Object.hasOwn(EFFECT_DEFINITIONS, key.slice(7))) ||
            (key.startsWith('preset:') && key.length > 7) ||
            (key.startsWith('shader:') && key.length > 7)),
      ),
    );
  } catch {
    return new Set();
  }
}

export function orderFavorites<T>(
  items: readonly T[],
  favorites: ReadonlySet<string>,
  key: (item: T) => string,
  name: (item: T) => string,
): T[] {
  return [...items].sort(
    (a, b) =>
      Number(favorites.has(key(b))) - Number(favorites.has(key(a))) ||
      name(a).localeCompare(name(b), 'en', { sensitivity: 'base', numeric: true }) ||
      key(a).localeCompare(key(b), 'en'),
  );
}
