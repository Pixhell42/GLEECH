import type {
  CelShadingEffect,
  ContourWavesEffect,
  WindowFragmentsEffect,
  EdgeHandling,
  PixelDissolveEffect,
  NeonPrintEffect,
  SignalWeaveEffect,
  DataWeaveEffect,
  MicroCollageEffect,
  SystemCrashEffect,
  TerminalWireframeEffect,
} from '@gleech/project-model';
import { bitmapRows } from './glyph-alphabet';
import type { HeightField } from './depth-field';
import { sampleHeight } from './depth-field';

type Sampler = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
interface Pixels {
  width: number;
  height: number;
  pixels: ArrayBuffer;
}
const tau = Math.PI * 2;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
export function* celShadingPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: CelShadingEffect,
  seedReference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(seedReference.width, seedReference.height);
  const smoothX = (((shorter * p.smoothing) / 100) * width) / seedReference.width,
    smoothY = (((shorter * p.smoothing) / 100) * height) / seedReference.height,
    edgeX = (((shorter * p.outlineWidth) / 100) * width) / seedReference.width,
    edgeY = (((shorter * p.outlineWidth) / 100) * height) / seedReference.height;
  const ink = rgb(p.outlineColor),
    color = new Float64Array(4),
    adjacent = new Float64Array(4);
  const luma = (c: ArrayLike<number>) => (c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722) / 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      color.set(input.subarray(i, i + 4));
      const originalLuma = luma(color);
      if (p.smoothing > 0 && color[3]! > 0) {
        const sum = [color[0]!, color[1]!, color[2]!];
        let weights = 1;
        for (const [dx, dy] of [
          [-smoothX, 0],
          [smoothX, 0],
          [0, -smoothY],
          [0, smoothY],
        ]) {
          sample(input, width, height, x + dx!, y + dy!, adjacent, 'extend');
          const weight =
            (Math.exp(-Math.abs(luma(adjacent) - originalLuma) * 12) * adjacent[3]!) / 255;
          for (let k = 0; k < 3; k++) sum[k] = sum[k]! + adjacent[k]! * weight;
          weights += weight;
        }
        for (let k = 0; k < 3; k++) color[k] = sum[k]! / weights;
      }
      const tone = luma(color),
        adjusted = clamp((tone - 0.5) * p.contrast + 0.5),
        band = Math.round(adjusted * (p.shadeBands - 1)) / (p.shadeBands - 1),
        ratio = band / Math.max(tone, 1 / 255);
      let edge = 0;
      if (p.outlineWidth > 0 && p.outlineStrength > 0) {
        for (const [dx, dy] of [
          [-edgeX, 0],
          [edgeX, 0],
          [0, -edgeY],
          [0, edgeY],
        ]) {
          sample(input, width, height, x + dx!, y + dy!, adjacent, 'extend');
          let distance = 0;
          for (let k = 0; k < 3; k++)
            distance = Math.max(distance, Math.abs(adjacent[k]! - input[i + k]!) / 255);
          edge = Math.max(edge, (distance * adjacent[3]!) / 255);
        }
        edge =
          clamp((edge - p.outlineThreshold) / Math.max(0.02, 1 - p.outlineThreshold)) *
          p.outlineStrength;
      }
      for (let k = 0; k < 3; k++) {
        const saturated = Math.max(
          0,
          Math.min(255, tone * 255 + (color[k]! - tone * 255) * p.saturation),
        );
        const shaded = clamp((saturated / 255) * ratio);
        const flat = (Math.round(shaded * (p.colorBands - 1)) / (p.colorBands - 1)) * 255;
        output[i + k] = Math.round(flat * (1 - edge) + ink[k]! * edge);
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
function random(seed: number, cell: number, lane: number) {
  let h = (seed ^ Math.imul(cell + 1, 0x8da6b343) ^ Math.imul(lane + 1, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function cellHash(seed: number, x: number, y: number, lane: number) {
  return random(seed, Math.imul(x, 73856093) ^ Math.imul(y, 19349663), lane);
}
// Integrating periodic coverage keeps thin threads visible in draft previews,
// while final exports still use the same original-image coordinates.
function pulse(value: number, fill: number, footprint: number) {
  const integral = (t: number) => Math.floor(t) * fill + Math.min(t - Math.floor(t), fill);
  const aa = Math.max(1e-6, footprint);
  return clamp((integral(value + aa / 2) - integral(value - aa / 2)) / aa);
}
function characterCoverage(character: string, x: number, y: number, ax: number, ay: number) {
  const rows = bitmapRows(character);
  const left = x - ax / 2,
    right = x + ax / 2,
    top = y - ay / 2,
    bottom = y + ay / 2;
  let coverage = 0;
  for (let gy = Math.max(0, Math.floor(top * 7)); gy <= Math.min(6, Math.floor(bottom * 7)); gy++)
    for (
      let gx = Math.max(0, Math.floor(left * 5));
      gx <= Math.min(4, Math.floor(right * 5));
      gx++
    ) {
      if ((rows[gy]! & (1 << (4 - gx))) === 0) continue;
      coverage +=
        Math.max(0, Math.min(right, (gx + 1) / 5) - Math.max(left, gx / 5)) *
        Math.max(0, Math.min(bottom, (gy + 1) / 7) - Math.max(top, gy / 7));
    }
  return clamp(coverage / Math.max(ax * ay, 1e-12));
}
export function* systemCrashPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: SystemCrashEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    size = (Math.min(reference.width, reference.height) * p.textSize) / 100;
  const text = Array.from(p.text.toUpperCase().replace(/[\r\n\t]/g, ' ') || ' ');
  const columns = Math.ceil(reference.width / size),
    bg = rgb(p.backgroundColor),
    fg = rgb(p.textColor),
    color = new Float64Array(4);
  const drift = Math.sin((p.phase % 1) * tau) * 0.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        px = ((x + 0.5) * reference.width) / width / size,
        py = ((y + 0.5) * reference.height) / height / size / 1.6 + drift;
      const cx = Math.floor(px),
        cy = Math.floor(py),
        cell = cy * columns + cx;
      sample(
        input,
        width,
        height,
        (((cx + 0.5) * size) / reference.width) * width - 0.5,
        (((cy + 0.5 - drift) * size * 1.6) / reference.height) * height - 0.5,
        color,
        'extend',
      );
      const luma = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
      const tone = clamp((luma - p.threshold) / Math.max(1 - p.threshold, 0.00001));
      const index =
        (((cell + Math.floor(cellHash(seed, 0, cy, 0) * text.length)) % text.length) +
          text.length) %
        text.length;
      const coverage =
        cellHash(seed, cx, cy, 1) < p.textDensity
          ? characterCoverage(
              text[index]!,
              px - cx,
              py - cy,
              reference.width / width / size,
              reference.height / height / size / 1.6,
            ) * tone
          : 0;
      for (let k = 0; k < 3; k++) {
        const screen = bg[k]! * (1 - coverage) + fg[k]! * coverage;
        output[i + k] = Math.round(screen * (1 - p.sourceMix) + input[i + k]! * p.sourceMix);
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
  if (p.windowCount > 0) {
    const windows: WindowFragmentsEffect = {
      ...effect,
      type: 'window-fragments',
      params: {
        ...p,
        count: p.windowCount,
        width: p.windowSize,
        height: p.windowSize * 0.7,
        sizeVariation: 0.6,
        travel: p.windowTravel,
        zoom: 1.1,
        colorShift: 0,
        borderWidth: 0.12,
        borderColor: p.textColor,
        decorations: 'on',
        edgeHandling: 'extend',
      },
    };
    yield* windowFragmentPixels(
      input,
      output,
      width,
      height,
      windows,
      seed,
      reference,
      sample,
      undefined,
      output,
      {
        placement: p.windowPlacement ?? 'random',
        spreadX: p.windowSpreadX ?? 84,
        spreadY: p.windowSpreadY ?? 84,
        centerX: p.windowCenterX ?? 50,
        centerY: p.windowCenterY ?? 50,
      },
    );
  }
  if (p.annotations === 'on') {
    const shorter = Math.min(reference.width, reference.height),
      stroke = Math.max(0.6, ((p.overlayWidth ?? 0.12) / 100) * shorter);
    const labels = (p.labelText ?? 'SIGNAL / TRACE / NODE / INPUT / GLEECH')
      .split('/')
      .map((s) => Array.from(s.trim().toUpperCase()))
      .filter((s) => s.length);
    const anchors: Array<{ x: number; y: number; label: readonly string[] }> = [];
    for (let cy = 0; cy < 4; cy++)
      for (let cx = 0; cx < 4; cx++)
        if (cellHash(seed, cx, cy, 60) < (p.anchorDensity ?? 0.55))
          anchors.push({
            x: ((cx + 0.2 + cellHash(seed, cx, cy, 61) * 0.6) / 4) * reference.width,
            y: ((cy + 0.2 + cellHash(seed, cx, cy, 62) * 0.6) / 4) * reference.height,
            label: labels[(cx + cy * 4) % Math.max(1, labels.length)] ?? [],
          });
    const paint = (x: number, y: number, alpha: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++)
        output[i + ch] = Math.round(output[i + ch]! * (1 - alpha) + fg[ch]! * alpha);
    };
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const aa = Math.max(reference.width / width, reference.height / height),
        radius = stroke + aa * 0.5;
      const dx = bx - ax,
        dy = by - ay,
        len = dx * dx + dy * dy;
      for (
        let y = Math.max(0, Math.floor(((Math.min(ay, by) - radius) * height) / reference.height));
        y <=
        Math.min(height - 1, Math.ceil(((Math.max(ay, by) + radius) * height) / reference.height));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(((Math.min(ax, bx) - radius) * width) / reference.width));
          x <=
          Math.min(width - 1, Math.ceil(((Math.max(ax, bx) + radius) * width) / reference.width));
          x++
        ) {
          const px = ((x + 0.5) * reference.width) / width,
            py = ((y + 0.5) * reference.height) / height,
            t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len) : 0;
          const dist = Math.hypot(px - ax - dx * t, py - ay - dy * t);
          paint(x, y, clamp((radius - dist) / aa));
        }
    };
    const text = (letters: readonly string[], ax: number, ay: number) => {
      const glyph = Math.max(3, ((shorter * p.textSize) / 100) * 0.65),
        gw = (glyph * width) / reference.width,
        gh = (glyph * 1.4 * height) / reference.height;
      for (let k = 0; k < letters.length; k++)
        for (
          let y = Math.max(0, Math.floor((ay * height) / reference.height));
          y < Math.min(height, Math.ceil((ay * height) / reference.height + gh));
          y++
        )
          for (
            let x = Math.max(0, Math.floor((ax * width) / reference.width + k * gw));
            x < Math.min(width, Math.ceil((ax * width) / reference.width + (k + 1) * gw));
            x++
          )
            paint(
              x,
              y,
              characterCoverage(
                letters[k]!,
                (x + 0.5 - (ax * width) / reference.width - k * gw) / gw,
                (y + 0.5 - (ay * height) / reference.height) / gh,
                1 / gw,
                1 / gh,
              ),
            );
    };
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!,
        b = anchors[(i + 1) % anchors.length]!;
      line(a.x - stroke * 3, a.y, a.x + stroke * 3, a.y);
      line(a.x, a.y - stroke * 3, a.x, a.y + stroke * 3);
      if (p.connectorStyle !== 'off') {
        if (p.connectorStyle === 'straight') line(a.x, a.y, b.x, b.y);
        else {
          line(a.x, a.y, b.x, a.y);
          line(b.x, a.y, b.x, b.y);
        }
      }
      if (p.annotationLabels !== 'off') text(a.label, a.x + stroke * 5, a.y - shorter * 0.018);
      if (p.overlayFrames !== 'off') {
        const w = shorter * 0.12,
          h = shorter * 0.08,
          x = a.x + stroke * 5,
          y = a.y + stroke * 5;
        line(x, y, x + w, y);
        line(x + w, y, x + w, y + h);
        line(x + w, y + h, x, y + h);
        line(x, y + h, x, y);
        line(x, y + shorter * 0.01, x + w, y + shorter * 0.01);
      }
      yield;
    }
  }
}
export function* terminalWireframePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: TerminalWireframeEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height),
    size = (shorter * p.cellSize) / 100;
  const bg = rgb(p.backgroundColor),
    fg = rgb(p.lineColor),
    accent = rgb(p.accentColor);
  const color = new Float64Array(4),
    near = new Float64Array(4),
    far = new Float64Array(4);
  const luma = (c: Float64Array) =>
    ((c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722) * c[3]!) / 65025;
  const drift = Math.sin((p.phase % 1) * tau) * 0.35;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height,
      py = (v * reference.height) / size / 1.5 + drift,
      cy = Math.floor(py);
    const compress = 1 + p.perspective * (1 - v) * 2;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        px = ((u - 0.5) * reference.width) / size + (0.5 * reference.width) / size,
        cx = Math.floor(px);
      const su = (((cx + 0.5) * size) / reference.width - 0.5) * compress + 0.5,
        sv = ((cy + 0.5 - drift) * size * 1.5) / reference.height;
      sample(input, width, height, su * width - 0.5, sv * height - 0.5, color, 'extend');
      const ex = (size / reference.width) * width,
        ey = (size / reference.height) * height;
      sample(input, width, height, su * width - 0.5 - ex, sv * height - 0.5, near, 'extend');
      sample(input, width, height, su * width - 0.5 + ex, sv * height - 0.5, far, 'extend');
      const dx = luma(far) - luma(near);
      sample(input, width, height, su * width - 0.5, sv * height - 0.5 - ey, near, 'extend');
      sample(input, width, height, su * width - 0.5, sv * height - 0.5 + ey, far, 'extend');
      const dy = luma(far) - luma(near),
        edge = clamp(Math.hypot(dx, dy) * p.edgeStrength);
      const glyph =
        Math.abs(dx) > Math.abs(dy) * 1.5
          ? '|'
          : Math.abs(dy) > Math.abs(dx) * 1.5
            ? '_'
            : dx * dy >= 0
              ? '/'
              : '\\';
      const chosen = edge > 0.15 ? glyph : '+';
      let coverage = characterCoverage(
        chosen,
        px - cx,
        py - cy,
        reference.width / width / size,
        reference.height / height / size / 1.5,
      );
      const circuit = (localX: number, localY: number) => {
        const aa = Math.max(reference.width / width / size, reference.height / height / size / 1.5);
        const targetX = dx >= 0 ? 1 : 0,
          targetY = dy >= 0 ? 1 : 0;
        const segment = (ax: number, ay: number, bx: number, by: number) => {
          const xx = bx - ax,
            yy = by - ay,
            len = xx * xx + yy * yy,
            t = len ? clamp(((localX - ax) * xx + (localY - ay) * yy) / len) : 0;
          return Math.hypot(localX - ax - xx * t, localY - ay - yy * t);
        };
        const straight = segment(0.5, 0.5, targetX, targetY);
        const elbow = Math.min(
          segment(0.5, 0.5, targetX, 0.5),
          segment(targetX, 0.5, targetX, targetY),
        );
        const dist = cellHash(seed, cx, cy, 11) < (p.rightAngleBias ?? 0.85) ? elbow : straight;
        return clamp((0.08 - dist) / Math.max(aa, 0.001) + 0.5);
      };
      if (p.traceStyle === 'circuit') {
        coverage = circuit(px - cx, py - cy);
      }
      const gate = cellHash(seed, cx, cy, 0) < p.density * (0.15 + 0.85 * edge) ? 1 : 0;
      coverage *= gate * (0.3 + 0.7 * edge);
      const dash = pulse(px + py, 0.2 + 0.8 * p.continuity, reference.width / width / size);
      coverage *= dash;
      const distance = Math.min(
        Math.abs(u - 0.025) * reference.width,
        Math.abs(0.975 - u) * reference.width,
        Math.abs(v - 0.035) * reference.height,
        Math.abs(0.965 - v) * reference.height,
      );
      const aa = Math.max(reference.width / width, reference.height / height);
      const inFrame =
        u >= 0.025 - aa / reference.width &&
        u <= 0.975 + aa / reference.width &&
        v >= 0.035 - aa / reference.height &&
        v <= 0.965 + aa / reference.height;
      const frame =
        p.frame === 'on' && inFrame ? clamp((shorter * 0.004 + aa / 2 - distance) / aa) : 0;
      for (let k = 0; k < 3; k++) {
        const base = bg[k]! * (1 - p.sourceMix) + input[i + k]! * p.sourceMix;
        const ink =
          p.colorSource === 'source' ? color[k]! : fg[k]! * (1 - edge) + accent[k]! * edge;
        const separation = p.traceStyle === 'circuit' ? (p.channelSeparation ?? 0) : 0;
        const separated =
          separation > 0
            ? circuit(px - cx + (k - 1) * separation, py - cy) * gate * (0.3 + 0.7 * edge) * dash
            : coverage;
        output[i + k] = Math.round(
          (base * (1 - separated) + ink * separated) * (1 - frame) + accent[k]! * frame,
        );
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
export function* signalWeavePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: SignalWeaveEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height);
  const spacing = (shorter * p.rasterSpacing) / 100,
    bg = rgb(p.backgroundColor),
    color = new Float64Array(4);
  const phase = (p.phase % 1) * tau;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height,
      row = Math.floor(v * p.bands);
    const offset =
      (((cellHash(seed, 0, row, 0) * 2 - 1) * p.distortion) / 100) *
      shorter *
      Math.cos(phase + row);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        thread = (u * reference.width) / spacing;
      const block = Math.floor(thread / 4);
      const gate = cellHash(seed, block, row, 1) < p.dropouts ? 0 : 1;
      const coverage = pulse(thread, p.rasterWidth, reference.width / width / spacing) * gate;
      sample(
        input,
        width,
        height,
        x + (offset * width) / reference.width,
        y,
        color,
        p.edgeHandling,
      );
      const luma = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
      const bandHue = (row / p.bands) * tau * 2 + phase + cellHash(seed, 0, row, 2) * 0.6;
      for (let c = 0; c < 3; c++) {
        const spectral =
          (0.5 + 0.5 * Math.cos(bandHue + (c * tau) / 3)) * (0.15 + 0.85 * luma) * 255;
        output[i + c] = Math.round(
          bg[c]! * (1 - coverage) +
            (color[c]! * (1 - p.colorMix) + spectral * p.colorMix) * coverage,
        );
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
export function* dataWeavePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: DataWeaveEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height);
  const period = (shorter * (p.dashLength + p.spacing)) / 100,
    rows = (shorter * p.rowSpacing) / 100;
  const bg = rgb(p.backgroundColor),
    fg = rgb(p.lineColor),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height,
      row = Math.floor((v * reference.height) / rows);
    const drift = cellHash(seed, 0, row, 0) + (p.phase % 1) * 4;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        px = (u * reference.width) / period + drift,
        cell = Math.floor(px);
      const cx = (((cell + 0.5 - drift) * period) / reference.width) * width - 0.5,
        cy = (((row + 0.5) * rows) / reference.height) * height - 0.5;
      sample(input, width, height, cx, cy, color, 'extend');
      const brightness = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
      const length =
        (p.dashLength / (p.dashLength + p.spacing)) *
        (1 - p.disruption * cellHash(seed, cell, row, 2) * 0.75);
      const gate = cellHash(seed, cell, row, 1) < p.disruption * 0.65 ? 0 : 1;
      const coverage =
        pulse(px, length, reference.width / width / period) *
        pulse((v * reference.height) / rows, p.thickness, reference.height / height / rows) *
        gate;
      for (let c = 0; c < 3; c++) {
        const base = bg[c]! * (1 - p.sourceMix) + input[i + c]! * p.sourceMix;
        const ink = p.colorSource === 'source' ? color[c]! : fg[c]! * (0.15 + 0.85 * brightness);
        output[i + c] = Math.round(base * (1 - coverage) + ink * coverage);
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
export function* microCollagePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: MicroCollageEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
  imported?: Pixels,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height),
    size = (shorter * p.fragmentSize) / 100;
  const bg = rgb(p.backgroundColor),
    source = imported ? new Uint8Array(imported.pixels) : input;
  const sw = imported?.width ?? width,
    sh = imported?.height ?? height,
    color = new Float64Array(4),
    phase = (p.phase % 1) * tau;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        rx = ((x + 0.5) * reference.width) / width,
        ry = ((y + 0.5) * reference.height) / height;
      const cx = Math.floor(rx / size),
        cy = Math.floor(ry / size),
        lx = rx / size - cx - 0.5,
        ly = ry / size - cy - 0.5;
      const visible = Math.abs(lx) < (1 - p.spacing) / 2 && Math.abs(ly) < (1 - p.spacing) / 2;
      const angle = (((cellHash(seed, cx, cy, 0) * 2 - 1) * p.rotation) / 180) * Math.PI;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const dx =
        (((cellHash(seed, cx, cy, 1) * 2 - 1) * p.travel) / 100) *
        shorter *
        (1 + 0.3 * Math.sin(phase));
      const dy =
        (((cellHash(seed, cx, cy, 2) * 2 - 1) * p.travel) / 100) *
        shorter *
        (1 + 0.3 * (Math.cos(phase) - 1));
      if (visible)
        sample(
          source,
          sw,
          sh,
          (((cx + 0.5) * size + ((lx * c - ly * s) * size) / p.zoom + dx) / reference.width) * sw -
            0.5,
          (((cy + 0.5) * size + ((lx * s + ly * c) * size) / p.zoom + dy) / reference.height) * sh -
            0.5,
          color,
          p.edgeHandling,
        );
      const alpha = visible ? color[3]! / 255 : input[i + 3]! / 255;
      const finalAlpha = alpha * (1 - p.sourceMix) + (input[i + 3]! / 255) * p.sourceMix;
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(
          finalAlpha > 0
            ? ((visible ? color[k]! : bg[k]!) * alpha * (1 - p.sourceMix) +
                ((input[i + k]! * input[i + 3]!) / 255) * p.sourceMix) /
                finalAlpha
            : 0,
        );
      output[i + 3] = Math.round(finalAlpha * 255);
    }
    yield;
  }
}
export function* pixelDissolvePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: PixelDissolveEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height),
    cell = (shorter * p.cellSize) / 100;
  const color = new Float64Array(4),
    center = new Float64Array(4),
    background = rgb(p.backgroundColor),
    angle = (p.direction / 180) * Math.PI,
    c = Math.cos(angle),
    s = Math.sin(angle),
    time = (p.phase % 1) * tau;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        rx = ((x + 0.5) * reference.width) / width,
        ry = ((y + 0.5) * reference.height) / height,
        cx = Math.floor(rx / cell),
        cy = Math.floor(ry / cell);
      sample(
        input,
        width,
        height,
        (((cx + 0.5) * cell) / reference.width) * width - 0.5,
        (((cy + 0.5) * cell) / reference.height) * height - 0.5,
        center,
        p.edgeHandling,
      );
      const luma = (center[0]! * 0.2126 + center[1]! * 0.7152 + center[2]! * 0.0722) / 255;
      const noise = cellHash(seed, cx, cy, 0),
        bias = p.bias === 'dark' ? luma : p.bias === 'bright' ? 1 - luma : noise;
      const gate = p.bias === 'uniform' ? noise : noise * 0.4 + bias * 0.6;
      const threshold = clamp(
        p.dissolve + 0.08 * Math.sin(time) * (cellHash(seed, cx, cy, 5) * 2 - 1),
      );
      const survive =
        threshold <= 0
          ? 1
          : threshold >= 1
            ? 0
            : p.softness === 0
              ? gate >= threshold
                ? 1
                : 0
              : clamp((gate - threshold) / p.softness + 0.5);
      if (cellHash(seed, cx, cy, 1) < p.breakup) {
        const dx =
          (((cellHash(seed, cx, cy, 2) * 2 - 1) * p.scatter) / 100) *
          shorter *
          (1 + 0.3 * Math.sin(time));
        const dy =
          (((cellHash(seed, cx, cy, 3) * 2 - 1) * p.scatter) / 100) *
          shorter *
          0.35 *
          (1 + 0.3 * (Math.cos(time) - 1));
        sample(
          input,
          width,
          height,
          x + ((c * dx - s * dy) * width) / reference.width,
          y + ((s * dx + c * dy) * height) / reference.height,
          color,
          p.edgeHandling,
        );
      } else color.set(input.subarray(i, i + 4));
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(
          p.fill === 'background'
            ? background[k]! * (1 - survive) + color[k]! * survive
            : color[k]!,
        );
      output[i + 3] = Math.round(p.fill === 'background' ? input[i + 3]! : color[3]! * survive);
    }
    yield;
  }
}
export function* neonPrintPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: NeonPrintEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height),
    cell = (shorter * p.cellSize) / 100;
  const palette = [p.backgroundColor, p.inkColor1, p.inkColor2, p.inkColor3, p.paperColor].map(rgb),
    dark = palette[0]!;
  const sampled = new Float64Array(4),
    near = new Float64Array(4),
    far = new Float64Array(4);
  const edgeX = (((shorter * p.outlineWidth) / 100) * width) / reference.width,
    edgeY = (((shorter * p.outlineWidth) / 100) * height) / reference.height;
  const luminance = (color: Float64Array) =>
    ((color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) * color[3]!) / 65025;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        cx = Math.floor(((x + 0.5) * reference.width) / width / cell),
        cy = Math.floor(((y + 0.5) * reference.height) / height / cell);
      sample(
        input,
        width,
        height,
        (((cx + 0.5) * cell) / reference.width) * width - 0.5,
        (((cy + 0.5) * cell) / reference.height) * height - 0.5,
        sampled,
        'extend',
      );
      const jitter = (cellHash(seed, cx, cy, 0) - 0.5) * p.grain * 130;
      const target = [0, 1, 2].map(
        (k) => clamp((sampled[k]! / 255 - 0.5) * p.contrast + 0.5 + jitter / 255) * 255,
      );
      let best = 0,
        score = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const ink = palette[k]!;
        const distance =
          (target[0]! - ink[0]!) ** 2 * 0.3 +
          (target[1]! - ink[1]!) ** 2 * 0.59 +
          (target[2]! - ink[2]!) ** 2 * 0.11;
        if (distance < score) {
          best = k;
          score = distance;
        }
      }
      if (cellHash(seed, cx, cy, 1) < p.grain * 0.14) best = 4;
      let edge = 0;
      if (p.outlines > 0) {
        sample(input, width, height, x - edgeX, y, near, 'extend');
        sample(input, width, height, x + edgeX, y, far, 'extend');
        const dx = luminance(near) - luminance(far);
        sample(input, width, height, x, y - edgeY, near, 'extend');
        sample(input, width, height, x, y + edgeY, far, 'extend');
        const dy = luminance(near) - luminance(far);
        edge = clamp(Math.hypot(dx, dy) * 3) * p.outlines;
      }
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(palette[best]![k]! * (1 - edge) + dark[k]! * edge);
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
// Fragments use premultiplied compositing: transparent reference pixels reveal
// the source, rather than making arbitrary RGB under alpha visible.
function over(output: Uint8Array, index: number, color: Float64Array) {
  const a = clamp(color[3]! / 255),
    b = output[index + 3]! / 255,
    alpha = a + b * (1 - a);
  for (let c = 0; c < 3; c++)
    output[index + c] =
      alpha > 0 ? Math.round((color[c]! * a + output[index + c]! * b * (1 - a)) / alpha) : 0;
  output[index + 3] = Math.round(alpha * 255);
}
export function* windowFragmentPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: WindowFragmentsEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
  imported?: Pixels,
  initial?: Uint8Array,
  layout?: {
    placement: 'random' | 'grid' | 'horizontal' | 'vertical';
    spreadX: number;
    spreadY: number;
    centerX: number;
    centerY: number;
  },
): Generator<void> {
  output.set(initial ?? input);
  const p = effect.params,
    source = imported ? new Uint8Array(imported.pixels) : input;
  const sw = imported?.width ?? width,
    sh = imported?.height ?? height;
  const border = rgb(p.borderColor),
    color = new Float64Array(4),
    original = new Float64Array(4);
  const time = (p.phase % 1) * tau,
    shorter = Math.min(reference.width, reference.height);
  const borderX = ((p.borderWidth / 100) * shorter) / reference.width,
    borderY = ((p.borderWidth / 100) * shorter) / reference.height;
  for (let j = 0; j < p.count; j++) {
    const factor = 1 + p.sizeVariation * (random(seed, j, 0) * 1.6 - 0.8);
    const bw = (p.width / 100) * factor,
      bh = (p.height / 100) * factor;
    let cx =
      0.08 +
      0.84 * random(seed, j, 1) +
      0.035 * (Math.cos(time + random(seed, j, 8) * tau) - Math.cos(random(seed, j, 8) * tau));
    let cy =
      0.08 +
      0.84 * random(seed, j, 2) +
      0.035 * (Math.sin(time + random(seed, j, 8) * tau) - Math.sin(random(seed, j, 8) * tau));
    if (layout) {
      let x = random(seed, j, 1) - 0.5,
        y = random(seed, j, 2) - 0.5;
      if (layout.placement === 'grid') {
        const columns = Math.ceil(Math.sqrt(p.count)),
          rows = Math.ceil(p.count / columns);
        x = ((j % columns) + 0.5) / columns - 0.5;
        y = (Math.floor(j / columns) + 0.5) / rows - 0.5;
      } else if (layout.placement === 'horizontal') {
        x = (j + 0.5) / p.count - 0.5;
        y *= 0.35;
      } else if (layout.placement === 'vertical') {
        x *= 0.35;
        y = (j + 0.5) / p.count - 0.5;
      }
      cx =
        layout.centerX / 100 +
        (x * layout.spreadX) / 100 +
        0.035 * (Math.cos(time + random(seed, j, 8) * tau) - Math.cos(random(seed, j, 8) * tau));
      cy =
        layout.centerY / 100 +
        (y * layout.spreadY) / 100 +
        0.035 * (Math.sin(time + random(seed, j, 8) * tau) - Math.sin(random(seed, j, 8) * tau));
    }
    const left = cx - bw / 2,
      top = cy - bh / 2;
    const dx = ((random(seed, j, 3) * 2 - 1) * p.travel) / 100,
      dy = ((random(seed, j, 4) * 2 - 1) * p.travel) / 100;
    const channel = Math.floor(random(seed, j, 5) * 3);
    for (
      let y = Math.max(0, Math.floor(top * height));
      y < Math.min(height, Math.ceil((top + bh) * height));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(left * width));
        x < Math.min(width, Math.ceil((left + bw) * width));
        x++
      ) {
        const u = (x + 0.5) / width,
          v = (y + 0.5) / height;
        if (u < left || u > left + bw || v < top || v > top + bh) continue;
        const index = (y * width + x) * 4;
        const edge =
          u - left < borderX ||
          left + bw - u < borderX ||
          v - top < borderY ||
          top + bh - v < borderY;
        const detail =
          p.decorations === 'on' &&
          (v - top < Math.max(borderY, bh * 0.055) ||
            (Math.min(u - left, left + bw - u) < bw * 0.08 &&
              Math.min(v - top, top + bh - v) < bh * 0.1));
        if (edge || detail) {
          color.set([...border, 255]);
        } else {
          sample(
            source,
            sw,
            sh,
            (cx + (u - cx) / p.zoom + dx) * sw - 0.5,
            (cy + (v - cy) / p.zoom + dy) * sh - 0.5,
            original,
            p.edgeHandling,
          );
          for (let c = 0; c < 3; c++)
            color[c] =
              original[c]! * (1 - p.colorShift) + original[(c + channel) % 3]! * p.colorShift;
          color[3] = original[3]!;
        }
        over(output, index, color);
      }
      yield;
    }
  }
}
export function* contourWavePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: ContourWavesEffect,
  field: HeightField,
  reference: { width: number; height: number },
  seed = 0,
): Generator<void> {
  const p = effect.params,
    bg = rgb(p.backgroundColor),
    fg = rgb(p.lineColor);
  for (let i = 0; i < input.length; i += 4) {
    for (let c = 0; c < 3; c++)
      output[i + c] = Math.round(bg[c]! * (1 - p.sourceMix) + input[i + c]! * p.sourceMix);
    output[i + 3] = input[i + 3]!;
  }
  const coverage = new Float32Array(width * height);
  const angle = (p.rotation / 180) * Math.PI,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const shorter = Math.min(reference.width, reference.height),
    sx = width / reference.width,
    sy = height / reference.height;
  const radius = ((p.lineWidth / 100) * shorter * Math.min(sx, sy)) / 2;
  const time = (p.phase % 1) * tau,
    shift = Math.sin(time) / p.lines;
  const point = (u: number, base: number) => {
    const level = sampleHeight(field, u, base);
    let v = base - ((level - 0.5) * p.amplitude) / 100 + shift;
    if ((p.stepSize ?? 0) > 0) {
      const step = (p.stepSize ?? 0) / 100;
      v = base + Math.round((v - base) / step) * step;
    }
    const tear =
      ((p.tearStrength ?? 0) / 100) *
      (cellHash(seed, Math.floor(u * 32), Math.floor(base * p.lines), 35) * 2 - 1);
    const px = (u + tear - 0.5) * reference.width,
      py = (v - 0.5) * reference.height;
    return {
      x: (c * px - s * py) * sx + width / 2 - 0.5,
      y: (s * px + c * py) * sy + height / 2 - 0.5,
    };
  };
  // Draw forward curves, so tall waves can overlap without folding the sampled
  // field into a screen-space threshold pattern. Segment bounds limit work.
  for (let row = 0; row < p.lines; row++) {
    const base = (row + 0.5) / p.lines;
    let a = point(0, base);
    for (let col = 1; col <= width; col++) {
      const b = point(col / width, base),
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      if (cellHash(seed, row, Math.floor((col / width) * 64), 36) < (p.breakup ?? 0)) {
        a = b;
        continue;
      }
      for (
        let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
        y <= Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
          x <= Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
          x++
        ) {
          const t = length === 0 ? 0 : clamp(((x - a.x) * dx + (y - a.y) * dy) / length);
          const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
          const k = y * width + x;
          coverage[k] = Math.max(coverage[k]!, clamp(radius + 0.5 - distance));
        }
      a = b;
    }
    yield;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        w = coverage[y * width + x]!;
      for (let c = 0; c < 3; c++)
        output[i + c] = Math.round(
          output[i + c]! * (1 - w) + (p.colorSource === 'source' ? input[i + c]! : fg[c]!) * w,
        );
    }
    yield;
  }
}
