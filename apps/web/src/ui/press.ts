/**
 * Press feedback, on pointer-down.
 *
 * `:active` is the cheaper way to do this and the codebase already uses it
 * (`active:scale-95` on the shutter and the sticker tiles). That stays. This hook
 * exists for the two cases `:active` cannot cover:
 *
 *  - iOS Safari does not reliably apply `:active` to a non-button element, and the
 *    press target for `PrimaryButton` has to be a wrapper, because the button itself
 *    lives in primitives and is shared with every other screen.
 *  - `pointerdown` is the causal event. The highlight belongs on touch-down and the
 *    commit on touch-up; feedback a browser defers until the tap resolves is
 *    feedback that arrives after the thing it was meant to confirm.
 *
 * Cancel semantics match a native control: sliding off the target drops the
 * highlight, sliding back on re-arms it while the finger is still down, and a
 * release anywhere ends the press. There is 10px of slop around the target, so a
 * press does not flicker at the edge. Only the pointer that started the press can
 * end it, so a second finger cannot leave a control stuck looking held.
 *
 * No pointer capture, deliberately: capture would make `click` fire even when the
 * finger is released well away from the control, and cancel-by-dragging-away is the
 * one escape hatch a press has.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Hit slop, per Apple's ~10px of hysteresis around a tap target. */
const SLOP = 10;

interface PressProps {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerMove: (event: ReactPointerEvent) => void;
  /** Present only while held, so CSS selects on `[data-pressed]`. */
  readonly 'data-pressed': '' | undefined;
}

export function usePress(): PressProps {
  const [pressed, setPressed] = useState(false);
  const holding = useRef<number | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const end = useCallback(() => {
    holding.current = null;
    detach.current?.();
    detach.current = null;
    setPressed(false);
  }, []);

  // A press held across an unmount would otherwise leave listeners behind.
  useEffect(() => () => detach.current?.(), []);

  const down = useCallback(
    (event: ReactPointerEvent) => {
      if (holding.current !== null) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      holding.current = event.pointerId;
      setPressed(true);

      // The release is watched on the window, not the element, because a finger
      // that leaves the control still has to end the press.
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId === holding.current) end();
      };
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
      detach.current = () => {
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };
    },
    [end],
  );

  const move = useCallback((event: ReactPointerEvent) => {
    if (holding.current !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left - SLOP &&
      event.clientX <= box.right + SLOP &&
      event.clientY >= box.top - SLOP &&
      event.clientY <= box.bottom + SLOP;
    setPressed((was) => (was === inside ? was : inside));
  }, []);

  return {
    onPointerDown: down,
    onPointerMove: move,
    'data-pressed': pressed ? '' : undefined,
  };
}
