import { describe, expect, it } from 'vitest';
import { BITCOIN_ADDRESS, SUPPORT_LINKS, supportLink, supportCopyText } from '../shared/support';

describe('support destinations', () => {
  it('uses the supplied payment identities and the decoded plain Bitcoin address', () => {
    expect(supportCopyText('cashapp')).toBe('https://cash.app/$Pixhell');
    expect(supportCopyText('venmo')).toBe('https://venmo.com/pixhell');
    expect(supportCopyText('bitcoin')).toBe('bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p');
    expect(supportLink('bitcoin')).toBe(`bitcoin:${BITCOIN_ADDRESS}`);
    expect(supportLink('bitcoin')).not.toContain('lightning');
    expect(SUPPORT_LINKS.musicX).toBe('https://x.com/mjestichooligan');
    expect(SUPPORT_LINKS.musicYouTube).toBe('https://www.youtube.com/@majestichooligan');
  });
  it('opens only the fixed supplied destinations', () => {
    for (const [id, destination] of Object.entries(SUPPORT_LINKS))
      expect(supportLink(id)).toBe(destination);
  });
  it('rejects arbitrary URLs, inherited properties and unknown destination IDs', () => {
    for (const id of [
      null,
      12,
      {},
      'https://example.com',
      'file:///secret',
      '__proto__',
      'toString',
      'constructor',
      'bug',
      'feature',
    ]) {
      expect(() => supportLink(id)).toThrow('Unknown GLEECH support link');
      expect(() => supportCopyText(id)).toThrow('Unknown GLEECH payment destination');
    }
  });
});
