/* The window is to close (its X, Alt+F4, File → Exit): the main process asks the page first (electron/main/closing.ts).
 * The workspace saves the project's last change and asks about work in no project; elsewhere (the start screen, the
 * workspace not there yet) the window closes at once. */
const kr = typeof window !== 'undefined' ? window.kr : undefined;

let handler: (() => void) | null = null;

/** `h` runs when the window is to close, in place of closing it, until the function returned is called. It answers
 *  with `holdClose` at once, and with `closeWindow` once the window may close */
export function whenClosing(h: () => void): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

/** the window closes now */
export function closeWindow(): void {
  void kr?.answerClose({ close: true }).catch(() => null);
}

/** the window waits: the page saves, or asks the user, and answers again */
export function holdClose(): void {
  void kr?.answerClose({ close: false }).catch(() => null);
}

kr?.onCloseAsked(() => {
  if (!handler) { closeWindow(); return; }
  try { handler(); } catch { closeWindow(); }
});
