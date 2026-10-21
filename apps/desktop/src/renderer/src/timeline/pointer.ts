/**
 * Follow one pointer until it is released or cancelled. Listening on the window
 * keeps a drag alive even when the pressed element re-renders or unmounts
 * (a dragged key remounts as its time changes).
 */
export function trackPointer(
  pointerId: number,
  move: (event: PointerEvent) => void,
  end: () => void,
): void {
  const onMove = (event: PointerEvent) => {
    if (event.pointerId === pointerId) move(event);
  };
  const onEnd = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    end();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}
