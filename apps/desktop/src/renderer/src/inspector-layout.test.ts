import { describe, expect, it } from 'vitest';
import { fitPanelGrowth, readPanelGrowth, readSectionState } from './inspector-layout';

describe('workspace layout preferences', () => {
  it('rejects corrupt width preferences and never shrinks below the responsive minimums', () => {
    expect(readPanelGrowth('broken')).toEqual({ left: 0, right: 0 });
    expect(readPanelGrowth('{"left":-20,"right":"300"}')).toEqual({ left: 0, right: 0 });
    expect(readPanelGrowth('{"left":100,"right":40}')).toEqual({ left: 100, right: 40 });
    expect(fitPanelGrowth({ left: 100, right: 50 }, 60)).toEqual({ left: 40, right: 20 });
    expect(fitPanelGrowth({ left: 100, right: 50 }, -10)).toEqual({ left: 0, right: 0 });
    expect(fitPanelGrowth({ left: 100, right: 50 }, 200)).toEqual({ left: 100, right: 50 });
  });
  it('restores only valid section states, preserving independent effect-section identities', () => {
    expect(readSectionState('null')).toEqual({});
    expect(readSectionState('[]')).toEqual({});
    expect(readSectionState('invalid')).toEqual({});
    expect(
      readSectionState('{"application":true,"effect:blur:settings":false,"tint":"off"}'),
    ).toEqual({ application: true, 'effect:blur:settings': false });
  });
});
