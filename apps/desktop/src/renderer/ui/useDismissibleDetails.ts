import { useEffect, type RefObject } from "react";

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const closeFromPointer = (event: PointerEvent) => {
      const element = ref.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      const element = ref.current;
      if (event.key !== "Escape" || !element?.open) return;
      event.preventDefault();
      element.open = false;
      element.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard, true);
    };
  }, [ref]);
}
