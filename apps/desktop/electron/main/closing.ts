/* Closing an app window (its X, Alt+F4, File → Exit): the page is asked first. It saves the project's last change and
 * may ask the user about work that is in no project; then it answers that the window closes, or that it waits (the
 * question is open). A page that does not answer (it hangs, or never loaded) has its window closed anyway. */
import { CHANNELS } from '../../shared/ipc';

/** how long the page has to answer before its window closes anyway */
export const CLOSE_ANSWER_MS = 2500;

/** what of a BrowserWindow closing needs (a stand-in in the tests) */
export interface ClosingWindow {
  on(event: 'close', fn: (e: { preventDefault(): void }) => void): unknown;
  on(event: 'closed', fn: () => void): unknown;
  close(): void;
  isDestroyed(): boolean;
  webContents: { send(channel: string): void; isCrashed(): boolean };
}

interface Asked {
  /** the page answered that the window closes: the next close goes through */
  ok: boolean;
  /** closes the window if the page does not answer */
  timer?: ReturnType<typeof setTimeout>;
}

const asked = new WeakMap<ClosingWindow, Asked>();

/** `win` asks its page before it closes */
export function askBeforeClose(win: ClosingWindow): void {
  const s: Asked = { ok: false };
  asked.set(win, s);
  win.on('close', e => {
    // a page that crashed has nothing to ask
    if (s.ok || win.webContents.isCrashed()) return;
    e.preventDefault();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => closeNow(win), CLOSE_ANSWER_MS);
    win.webContents.send(CHANNELS.windowClosing);
  });
  win.on('closed', () => clearTimeout(s.timer));
}

/** The page's answer: `close`, the window closes now; else it waits for the page (a question is open), which answers
 *  again once the user did */
export function answerClose(win: ClosingWindow, close: boolean): void {
  const s = asked.get(win);
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = undefined;
  if (close) closeNow(win);
}

function closeNow(win: ClosingWindow): void {
  const s = asked.get(win);
  if (!s || win.isDestroyed()) return;
  s.ok = true;
  win.close();
}
