import { describe, expect, it } from 'vitest';
import { createEffect } from '@gleech/project-model';
import { copySettings, pastedSettings, settingsPasteTarget } from './index';

describe('channel counterpart clipboard targets', () => {
  it('pastes onto matching controls in another channel and labels the actual destination', () => {
    const source = createEffect('channel-transform', 'source');
    for (const [role, value] of [
      ['X', 12],
      ['Y', -7],
      ['Scale', 125],
      ['Rotation', 30],
      ['Mirror', 'both'],
      ['Source', 'blue'],
    ] as const) {
      Object.assign(source.params, { ['red' + role]: value });
      const packet = copySettings(source, { kind: 'parameter', key: 'red' + role })!;
      const destination = createEffect('channel-transform', 'destination');
      const target = { kind: 'parameter' as const, key: 'green' + role };
      expect(pastedSettings(destination, packet, target)!.params).toEqual({
        ...destination.params,
        ['green' + role]: value,
      });
      expect(settingsPasteTarget(destination, packet, target)).toEqual(target);
    }
  });
  it('keeps ordinary key matching for whole filters, unrelated controls and other effects', () => {
    const source = createEffect('channel-transform', 'source');
    Object.assign(source.params, { redX: 12 });
    const packet = copySettings(source, { kind: 'parameter', key: 'redX' })!;
    for (const target of [{ kind: 'effect' }, { kind: 'parameter', key: 'greenScale' }] as const) {
      const destination = createEffect('channel-transform', 'destination');
      expect(pastedSettings(destination, packet, target)!.params).toEqual({
        ...destination.params,
        redX: 12,
      });
      expect(settingsPasteTarget(destination, packet, target)).toEqual({
        kind: 'parameter',
        key: 'redX',
      });
    }
    expect(
      pastedSettings(createEffect('temporal-echo', 'echo'), packet, {
        kind: 'parameter',
        key: 'spacing',
      }),
    ).toBeNull();
  });
});
