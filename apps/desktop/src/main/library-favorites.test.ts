import { describe, expect, it } from 'vitest';
import { favoriteKey, parseFavorites, orderFavorites } from '../renderer/src/library-favorites';

describe('library favorite preferences', () => {
  it('recovers invalid storage and keeps effect and preset identities separate', () => {
    for (const value of [null, '{', '{}', 'null', '42']) expect(parseFavorites(value).size).toBe(0);
    expect([
      ...parseFavorites(
        JSON.stringify([
          'effect:blur',
          'preset:blur',
          'effect:missing',
          1,
          '',
          'preset:',
          'effect:blur',
        ]),
      ),
    ]).toEqual(['effect:blur', 'preset:blur']);
    expect(parseFavorites(JSON.stringify(Array(10001).fill('effect:blur'))).size).toBe(0);
  });
  it('places favorites first and sorts both groups alphabetically without changing input order', () => {
    const items = [
      { id: 'z', name: 'Zoom' },
      { id: 'c', name: 'CRT' },
      { id: 'b', name: 'Blur' },
      { id: 'a', name: 'ASCII' },
    ];
    const keys = parseFavorites('["preset:z","preset:a"]');
    const sorted = orderFavorites(
      items,
      keys,
      (p) => favoriteKey('preset', p.id),
      (p) => p.name,
    );
    expect(sorted.map((p) => p.id)).toEqual(['a', 'z', 'b', 'c']);
    expect(items[0]?.id).toBe('z');
    expect(
      orderFavorites(
        items,
        new Set(),
        (p) => p.id,
        (p) => p.name,
      ).map((p) => p.id),
    ).toEqual(['a', 'b', 'c', 'z']);
    // A rename changes alphabetical placement while retaining the star's ID.
    expect(
      orderFavorites(
        [{ id: 'z', name: 'AAA' }, items[3]!],
        keys,
        (p) => favoriteKey('preset', p.id),
        (p) => p.name,
      )[0]?.id,
    ).toBe('z');
  });
});
