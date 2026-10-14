import { APP_VERSION } from '../shared/branding';
import { SUPPORT_LINKS } from '../shared/support';

// Identifies the software that last wrote the file, rather than the artwork's author.
export const FILE_APPLICATION = {
  name: 'GLEECH',
  version: APP_VERSION,
  developerUrl: SUPPORT_LINKS.x,
  repositoryUrl: SUPPORT_LINKS.repository,
} as const;

const xmlText = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );

export function fileMetadataXmp(): string {
  const { name, version, developerUrl, repositoryUrl } = FILE_APPLICATION;
  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:gleech="https://github.com/Pixhell42/GLEECH/ns/1.0/">
      <xmp:CreatorTool>${xmlText(`${name} ${version}`)}</xmp:CreatorTool>
      <gleech:Application>${xmlText(name)}</gleech:Application>
      <gleech:Version>${xmlText(version)}</gleech:Version>
      <gleech:DeveloperURL>${xmlText(developerUrl)}</gleech:DeveloperURL>
      <gleech:RepositoryURL>${xmlText(repositoryUrl)}</gleech:RepositoryURL>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
}
