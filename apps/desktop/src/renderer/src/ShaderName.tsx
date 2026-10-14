import { useId } from 'react';

/** A transparent, gold shader mark with the offset cuts of GLEECH's G logo. */
export function ShaderName({
  name,
  shader,
  preset = false,
}: {
  name: string;
  shader: boolean;
  preset?: boolean;
}) {
  const cutout = useId();
  return (
    <span className="shader-name">
      <span className="shader-name-text">{name}</span>
      {shader && (
        <span
          className="shader-mark"
          title={preset ? 'Contains shaders' : 'Shader effect'}
          aria-hidden="true"
        >
          <svg viewBox="0 0 32 32" width="9.6" height="9.6" focusable="false">
            <defs>
              <mask id={cutout} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
                <rect width="32" height="32" fill="white" />
                <path d="M0 10h12l-1 2H0zM20 22h12v2H19z" fill="black" />
              </mask>
            </defs>
            <path
              fill="currentColor"
              mask={`url(#${cutout})`}
              d="M28.3 10.5h-6.7c-1-2-2.8-3.3-5.9-3.3-3.1 0-5.2 1-5.2 2.6 0 1.4 1.3 2.1 4 2.7l5 1.1c6.1 1.4 9.2 3.8 9.2 8 0 5.3-4.9 8.4-12.4 8.4-8 0-12.4-2.9-13.6-9h6.7c1 2.6 3.5 4 7 4 3.2 0 5.4-.8 5.4-2.5 0-1.5-1.3-2.2-3.6-2.7l-4.5-1C7.5 17.4 4 15.4 4 11.1 4 5.8 8.5 2 16 2c6.9 0 11 2.8 12.3 8.5Z"
            />
          </svg>
        </span>
      )}
    </span>
  );
}
