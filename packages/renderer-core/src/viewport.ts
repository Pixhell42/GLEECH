export interface Size {
  width: number;
  height: number;
}
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export function fitImage(image: Size, viewport: Size): ViewTransform {
  const scale = Math.min(
    1,
    Math.max(1, viewport.width - 80) / image.width,
    Math.max(1, viewport.height - 80) / image.height,
  );
  return {
    scale,
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
  };
}

export function zoomAt(
  view: ViewTransform,
  scale: number,
  point: { x: number; y: number },
): ViewTransform {
  const nextScale = Math.max(1 / 128, Math.min(16, scale));
  const ratio = nextScale / view.scale;
  return {
    scale: nextScale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}
