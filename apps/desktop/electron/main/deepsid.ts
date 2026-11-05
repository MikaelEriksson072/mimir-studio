/* DeepSID (deepsid.chordian.net), the online SID player, in a window of its own: a music block's .sid goes to its
 * Load SID (the L key: "temporary emulator testing"), which sends the file to DeepSID's server, keeps it there under
 * its name (temp/test/<name>) and lists it; the row is then clicked, which plays it. The page is DeepSID's own,
 * sandboxed, without Mimir's preload, in a session of its own (DeepSID keeps its settings there, the emulator chosen
 * say). Links to other sites open in the browser. When DeepSID does not take the file by itself (its page changed),
 * the window stays open for Load SID by hand, and the file is in a build folder. */
import { BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { DeepSidPlayRequest, DeepSidPlayResult } from '../../shared/ipc';
import { createBuildFolder } from './project-fs';

export const DEEPSID_URL = 'https://deepsid.chordian.net/';
const PARTITION = 'persist:deepsid';

/** the page to open: DeepSID, or a stand-in for it in the tests (MIMIR_DEEPSID_URL) */
const deepSidUrl = () => process.env.MIMIR_DEEPSID_URL || DEEPSID_URL;

let win: BrowserWindow | null = null;
/** the page in the window is loading or loaded (a load that failed, offline say, is tried again the next time), and
 *  why it failed */
let loaded = false;
let loadError: string | null = null;

/** The DeepSID window, if one is open. */
export const deepSidWindow = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);

export function closeDeepSid(): void {
  deepSidWindow()?.close();
}

function openWindow(url: string): BrowserWindow {
  const origin = new URL(url).origin;
  const ses = session.fromPartition(PARTITION);
  // nothing the page could ask for (MIDI, USB, notifications…): the emulators play through Web Audio
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 760, minHeight: 520, autoHideMenuBar: true, title: 'DeepSID', backgroundColor: '#ffffff',
    webPreferences: {
      session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
      // the tune starts without a click in the page
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const external = (u: string) => { if (/^https?:\/\//i.test(u)) void shell.openExternal(u); };
  w.webContents.setWindowOpenHandler(({ url: u }) => { external(u); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, u) => { if (new URL(u).origin !== origin) { e.preventDefault(); external(u); } });
  w.webContents.on('did-fail-load', (_e, code, text, _url, mainFrame) => {
    // (-3: a load replaced by another one, not a failure)
    if (mainFrame && code !== -3) { loaded = false; loadError = `${text || 'error'} ${code}`; }
  });
  w.on('closed', () => { if (win === w) { win = null; loaded = false; } });
  win = w;
  loaded = false;
  return w;
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Run code in the window's page as it is now (its main frame: not waiting for the page to stop loading), giving up
 *  after `ms` with `fallback`. */
async function inPage<T>(w: BrowserWindow, code: string, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      w.webContents.mainFrame.executeJavaScript(code) as Promise<T>,
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** DeepSID's page has bound its Load SID input (jQuery's handlers have run): the file can go in. Not the load event:
 *  DeepSID's page can stay "interactive" for long, with something still loading. */
const READY = `(() => {
  const input = document.getElementById('upload-test');
  if (!input || document.readyState === 'loading') return false;
  const $ = window.jQuery;
  if (!$) return true;
  const events = $._data && $._data(input, 'events');
  return !!(events && events.change);
})()`;

/** The file into DeepSID's Load SID input, as picking it would; then its row, once listed, is clicked. */
const handOver = (name: string, base64: string) => `(async () => {
  const input = document.getElementById('upload-test');
  if (!input) return 'DeepSID has no Load SID input (#upload-test) any more';
  const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0));
  const files = new DataTransfer();
  files.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'application/octet-stream' }));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const want = encodeURIComponent(${JSON.stringify(name)});
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    const row = [...document.querySelectorAll('#songs .entry.file')].find(e => e.getAttribute('data-name') === want);
    if (row) { row.click(); return ''; }
  }
  return 'DeepSID did not list the file within 20 seconds';
})()`;

/** Play the .sid in DeepSID (see the file head). */
export async function playInDeepSid(req: DeepSidPlayRequest): Promise<DeepSidPlayResult> {
  const dir = await createBuildFolder('deepsid');
  const path = join(dir, req.name);
  await writeFile(path, req.sid);
  const url = deepSidUrl();
  const w = deepSidWindow() ?? openWindow(url);
  if (!loaded) {
    // not awaited: loadURL waits for the load event, which DeepSID's page may not get to for long
    loaded = true;
    loadError = null;
    w.loadURL(url).catch((e: unknown) => { if (!loadError && !/ERR_ABORTED/.test(String(e))) { loaded = false; loadError = e instanceof Error ? e.message : String(e); } });
  }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  for (let i = 0; ; i++) {
    if (loadError) return { played: false, path, url, problem: `DeepSID did not open (${loadError}): is the computer online?` };
    if (await inPage(w, READY, 2000, false)) break;
    if (i >= 150) return { played: false, path, url, problem: 'DeepSID\'s page did not get ready for Load SID within 30 seconds' };
    await pause(200);
  }
  const problem = await inPage(w, handOver(req.name, Buffer.from(req.sid).toString('base64')), 25_000, 'the page did not take the file');
  return problem ? { played: false, path, url, problem } : { played: true, path, url };
}
