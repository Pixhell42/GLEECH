import { useState } from 'react';
import type { ShaderPackage } from '@gleech/project-model/shader-package';
import { unwrap } from '../../shared/image-api';

export function ShaderCredits({ shader }: { shader: ShaderPackage }) {
  const [error, setError] = useState<string | null>(null);
  const licenseDetails = [
    `License: ${shader.license.expression}`,
    `Version: ${shader.version}`,
    shader.license.text,
  ]
    .filter(Boolean)
    .join('\n');
  const open = async (url: string) => {
    try {
      unwrap(await window.gleech.openCredit(url));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open creator link.');
    }
  };
  return (
    <div className="shader-credits">
      <span>
        By{' '}
        {shader.authors.map((author, index) => {
          const url = author.url ?? shader.sourceUrl;
          const tooltip = url
            ? `${licenseDetails}\n${author.url ? 'Open creator page' : 'Open shader source'}`
            : licenseDetails;
          return (
            <span key={index}>
              {index ? ', ' : ''}
              {url ? (
                <button type="button" onClick={() => void open(url)} title={tooltip}>
                  {author.name}
                </button>
              ) : (
                <span title={tooltip} tabIndex={0}>
                  {author.name}
                </span>
              )}
            </span>
          );
        })}
      </span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
