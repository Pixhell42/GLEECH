import { FRACTAL_DEFAULTS, type MandelbrotEffect } from '@gleech/project-model';

export type FractalView = Pick<
  MandelbrotEffect['params'],
  'centerReal' | 'centerImaginary' | 'zoom' | 'rotation'
>;

export function fractalPoint(
  view: FractalView,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const span = 3.4 / (Math.min(width, height) * view.zoom);
  const angle = (view.rotation * Math.PI) / 180;
  const dx = x - width / 2,
    dy = y - height / 2;
  return {
    real: view.centerReal + (Math.cos(angle) * dx + Math.sin(angle) * dy) * span,
    imaginary: view.centerImaginary + (-Math.sin(angle) * dx + Math.cos(angle) * dy) * span,
  };
}

export function zoomFractalAt(
  view: FractalView,
  x: number,
  y: number,
  width: number,
  height: number,
  factor: number,
) {
  const before = fractalPoint(view, x, y, width, height);
  const zoom = Math.max(0.25, Math.min(100000, view.zoom * factor));
  const after = fractalPoint({ ...view, zoom }, x, y, width, height);
  return {
    zoom,
    centerReal: Math.max(-3, Math.min(3, view.centerReal + before.real - after.real)),
    centerImaginary: Math.max(
      -3,
      Math.min(3, view.centerImaginary + before.imaginary - after.imaginary),
    ),
  };
}

// For Mandelbrot z starts at zero and c is the pixel coordinate. For Julia
// z starts at the pixel coordinate and c is fixed. Preserve legacy escape counts.
export function fractalOrbit(
  real: number,
  imaginary: number,
  params: Pick<
    MandelbrotEffect['params'],
    'iterations' | 'formula' | 'juliaReal' | 'juliaImaginary'
  >,
  needOrbit = false,
  weave = false,
) {
  const julia = params.formula === 'julia';
  const cr = julia ? (params.juliaReal ?? FRACTAL_DEFAULTS.juliaReal) : real;
  const ci = julia ? (params.juliaImaginary ?? FRACTAL_DEFAULTS.juliaImaginary) : imaginary;
  // A fixed Julia c outside radius two needs a larger escape radius. |z| greater
  // than max(2, |c|) guarantees growth; preserve Mandelbrot's legacy radius two.
  const bailoutSquared = julia ? Math.max(4, cr * cr + ci * ci) : 4;
  const q = (real - 0.25) ** 2 + imaginary ** 2;
  if (
    !julia &&
    !needOrbit &&
    !weave &&
    (q * (q + real - 0.25) <= 0.25 * imaginary ** 2 || (real + 1) ** 2 + imaginary ** 2 <= 1 / 16)
  )
    return { inside: true, count: params.iterations, x: 0, y: 0, trapX: 0, trapY: 0, trapStep: 0 };
  let x = julia ? real : 0,
    y = julia ? imaginary : 0,
    count = 0;
  let closest = Infinity,
    trapX = x,
    trapY = y,
    trapStep = 0;
  while (count < params.iterations && x * x + y * y <= bailoutSquared) {
    const nextX = x * x - y * y + cr;
    y = 2 * x * y + ci;
    x = nextX;
    count++;
    if (weave) {
      // Select the orbit point closest to a unit-circle image trap. This creates
      // repeated image domains along fractal branches rather than a silhouette.
      const distance = Math.abs(Math.hypot(x, y) - 1);
      if (distance < closest) {
        closest = distance;
        trapX = x;
        trapY = y;
        trapStep = count;
      }
    }
  }
  return { inside: x * x + y * y <= bailoutSquared, count, x, y, trapX, trapY, trapStep };
}
