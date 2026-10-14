import { BUILTIN_SHADER_WGSL } from './shader-programs';

// Keep only the selected entry point and its helper dependencies. Unrelated
// entry points otherwise incur parser/driver work even with lazy pipelines.
const masked = BUILTIN_SHADER_WGSL.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (text) =>
  text.replace(/[^\n]/g, ' '),
);
const functions = new Map<string, { source: string; calls: string[] }>();
const pieces: string[] = [];
const pattern = /(?:@\w+(?:\([^)]*\))?\s*)*\bfn\s+(\w+)\s*\(/g;
let previous = 0;
let match: RegExpExecArray | null;
while ((match = pattern.exec(masked))) {
  const open = masked.indexOf('{', pattern.lastIndex);
  let end = open + 1;
  let depth = 1;
  while (depth && end < masked.length) {
    if (masked[end] === '{') depth++;
    else if (masked[end] === '}') depth--;
    end++;
  }
  if (depth || open < 0) throw new Error('Invalid built-in shader function.');
  pieces.push(BUILTIN_SHADER_WGSL.slice(previous, match.index));
  functions.set(match[1]!, {
    source: BUILTIN_SHADER_WGSL.slice(match.index, end),
    calls: [...masked.slice(open, end).matchAll(/\b(\w+)\s*\(/g)].map((call) => call[1]!),
  });
  previous = end;
  pattern.lastIndex = end;
}
pieces.push(BUILTIN_SHADER_WGSL.slice(previous));
const declarations = pieces.join('');
const sources = new Map<string, string>();

export function builtinShaderSource(entryPoint: string): string {
  const cached = sources.get(entryPoint);
  if (cached) return cached;
  if (!functions.has(entryPoint)) throw new Error('Unknown built-in shader entry point.');
  const needed = new Set<string>();
  function visit(name: string) {
    const fn = functions.get(name);
    if (!fn || needed.has(name)) return;
    needed.add(name);
    fn.calls.forEach(visit);
  }
  visit(entryPoint);
  const source =
    declarations +
    [...functions]
      .filter(([name]) => needed.has(name))
      .map(([, fn]) => fn.source)
      .join('\n');
  sources.set(entryPoint, source);
  return source;
}
