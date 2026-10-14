import { DEFAULT_GRADIENT_END, gradientStops } from '@gleech/project-model';

type Params = Readonly<Record<string, number | string>>;

const rgb = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

// Reuses its result array: callers consume it before sampling the next pixel.
// UVs describe the output canvas, so moving effect content does not move its tint.
export function createColorSampler(
  params: Params,
  key: string,
  fallback: string,
  reference: { width: number; height: number },
  field = false,
): (u: number, v: number, value?: number) => readonly number[] {
  const start = rgb(String(params[key] ?? fallback));
  if (params[`${key}Mode`] !== 'gradient') return () => start;
  const stops = gradientStops(
    params,
    key,
    String(params[key] ?? fallback),
    String(params[`${key}End`] ?? DEFAULT_GRADIENT_END),
  ).map((stop) => ({ ...stop, rgb: rgb(stop.color) }));
  const angle = (Number(params[`${key}Angle`] ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
  const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
  const x = Number(params[`${key}CenterX`] ?? 50) / 100;
  const y = Number(params[`${key}CenterY`] ?? 50) / 100;
  const span =
    (Number(params[`${key}Span`] ?? 100) / 100) *
    (Math.abs(reference.width * cosine) + Math.abs(reference.height * sine));
  const result = [0, 0, 0];
  return (u, v, value = 0) => {
    const raw = field
      ? value
      : 0.5 + ((u - x) * reference.width * cosine + (v - y) * reference.height * sine) / span;
    const mix = Math.round(Math.max(0, Math.min(1, raw)) * 1e9) / 1e9;
    let index = 0;
    while (index < stops.length - 2 && mix >= stops[index + 1]!.position) index++;
    const a = stops[index]!,
      b = stops[index + 1]!;
    const local =
      b.position === a.position
        ? 1
        : Math.max(0, Math.min(1, (mix - a.position) / (b.position - a.position)));
    for (let c = 0; c < 3; c++) result[c] = a.rgb[c]! * (1 - local) + b.rgb[c]! * local;
    return result;
  };
}
