import { Platform } from "obsidian";

/** Observe this modal's window only; callers dispose on close. */
export function mobileProviderModal(modal: HTMLElement, content: HTMLElement): () => void {
  if (!Platform.isMobile) return () => {};
  const win = modal.ownerDocument.defaultView;
  if (!win) return () => {};
  const viewport = win.visualViewport;
  let frame = 0;
  modal.classList.add("qa-mobile-provider");
  modal.tabIndex = -1;
  // A non-editable focus target keeps opening settings from summoning a keyboard.
  modal.focus({ preventScroll: true });
  const update = () => {
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      modal.style.setProperty("--qa-visible-height", `${viewport?.height ?? win.innerHeight}px`);
      const active = modal.ownerDocument.activeElement as HTMLElement | null;
      if (active && content.contains(active) && active.matches("input, textarea")) {
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  };
  viewport?.addEventListener("resize", update);
  win.addEventListener("resize", update);
  content.addEventListener("focusin", update);
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", update);
    win.removeEventListener("resize", update);
    content.removeEventListener("focusin", update);
    modal.classList.remove("qa-mobile-provider");
    modal.style.removeProperty("--qa-visible-height");
  };
}
