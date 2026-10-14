import { CURVE_KEYS, type LevelsCurvesEffect, type ToneCurveParams } from '@gleech/project-model';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function createCurveSampler(
  params: ToneCurveParams & { interpolation: 'smooth' | 'linear' },
): (value: number) => number {
  const values = CURVE_KEYS.map((key) => params[key]);
  const differences = values.slice(1).map((value, i) => value - values[i]!);
  const endpoint = (a: number, b: number) => {
    const slope = (3 * a - b) / 2;
    return slope * a <= 0 ? 0 : a * b <= 0 && Math.abs(slope) > Math.abs(3 * a) ? 3 * a : slope;
  };
  const slopes = [endpoint(differences[0]!, differences[1]!)];
  for (let i = 1; i < 4; i++) {
    const a = differences[i - 1]!,
      b = differences[i]!;
    slopes.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  slopes.push(endpoint(differences[3]!, differences[2]!));
  return (value) => {
    const position = clamp(value) * 4;
    const index = Math.min(3, Math.floor(position)),
      t = position - index;
    const left = values[index]!,
      right = values[index + 1]!;
    const result =
      params.interpolation === 'linear'
        ? left + (right - left) * t
        : (2 * t ** 3 - 3 * t ** 2 + 1) * left +
          (t ** 3 - 2 * t ** 2 + t) * slopes[index]! +
          (-2 * t ** 3 + 3 * t ** 2) * right +
          (t ** 3 - t ** 2) * slopes[index + 1]!;
    return Math.round(clamp(result) * 1e12) / 1e12;
  };
}

export function createToneTable(params: LevelsCurvesEffect['params']): Float64Array {
  const sample =
    params.mode === 'curves'
      ? createCurveSampler(params)
      : (value: number) => {
          const normalized = clamp(
            (value - params.inputBlack) / (params.inputWhite - params.inputBlack),
          );
          return clamp(
            params.outputBlack +
              (params.outputWhite - params.outputBlack) * normalized ** (1 / params.gamma),
          );
        };
  return Float64Array.from(
    { length: 256 },
    (_, value) => Math.round(sample(value / 255) * 255 * 1e9) / 1e9,
  );
}
