export const SUPPORT_REPOSITORY_SLUG = 'Pixhell42/GLEECH';
export const SUPPORT_REPOSITORY = `https://github.com/${SUPPORT_REPOSITORY_SLUG}`;
export const BITCOIN_ADDRESS = 'bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p';

export const SUPPORT_LINKS = {
  cashapp: 'https://cash.app/$Pixhell',
  venmo: 'https://venmo.com/pixhell',
  bitcoin: `bitcoin:${BITCOIN_ADDRESS}`,
  x: 'https://x.com/pixhell',
  github: 'https://github.com/Pixhell42',
  repository: SUPPORT_REPOSITORY,
  releases: `${SUPPORT_REPOSITORY}/releases`,
  discord: 'https://discord.gg/b7Mq8fjvk',
  bugReport: `${SUPPORT_REPOSITORY}/issues/new?template=bug.yml`,
  featureRequest: `${SUPPORT_REPOSITORY}/issues/new?template=feature.yml`,
  musicX: 'https://x.com/mjestichooligan',
  musicYouTube: 'https://www.youtube.com/@majestichooligan',
  slopcannon: 'https://slop.cc',
} as const;

export type SupportLinkId = keyof typeof SUPPORT_LINKS;
export type PaymentId = 'cashapp' | 'venmo' | 'bitcoin';

export function supportLink(id: unknown): string {
  if (typeof id !== 'string' || !Object.hasOwn(SUPPORT_LINKS, id))
    throw new Error('Unknown GLEECH support link.');
  return SUPPORT_LINKS[id as keyof typeof SUPPORT_LINKS];
}

export function supportCopyText(id: unknown): string {
  if (id === 'bitcoin') return BITCOIN_ADDRESS;
  if (id === 'cashapp' || id === 'venmo') return SUPPORT_LINKS[id];
  throw new Error('Unknown GLEECH payment destination.');
}
