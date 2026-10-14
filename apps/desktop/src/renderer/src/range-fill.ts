// Range inputs draw their filled track from a --range-fill custom property.
// React keeps each slider's value attribute in sync, so one observer covers
// drags, keyboard steps, undo and newly mounted panels without per-slider code.
function sync(input: HTMLInputElement) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const next = `${Math.min(100, Math.max(0, fill))}%`;
  if (input.style.getPropertyValue('--range-fill') !== next)
    input.style.setProperty('--range-fill', next);
}

function syncWithin(node: Node) {
  if (node instanceof HTMLInputElement) {
    if (node.type === 'range') sync(node);
    return;
  }
  if (node instanceof Element)
    node.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(sync);
}

export function installRangeFill(root: HTMLElement = document.body) {
  syncWithin(root);
  // Focusing a partly visible range otherwise scrolls it away from the pointer.
  // Capture covers every range, including masks, dialogs and future controls,
  // before their gesture handlers or Chromium's default focus run.
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (
        event.button === 0 &&
        event.target instanceof HTMLInputElement &&
        event.target.type === 'range' &&
        !event.target.disabled
      )
        event.target.focus({ preventScroll: true });
    },
    { capture: true },
  );
  root.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range')
      sync(event.target);
  });
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') syncWithin(record.target);
      else record.addedNodes.forEach(syncWithin);
    }
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['value', 'min', 'max'],
  });
}
