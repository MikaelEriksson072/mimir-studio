/* Smart attach (the first choice of the File menu): one dialog for every kind of file Mimir opens, where each file's
 * extension says what it is opened as. The main process reads what is opened; the renderer puts it where it goes. */

/** what a file is opened as: a PRG, a VICE snapshot or a cartridge (as Open PRG files… opens them), a disk image to
 *  mount (a .d64 or .g64), a tape image to put in the datasette (a .tap or .t64), a Mimir project, or a Kick Assembler
 *  source that Brokkr packs (Pack a file) */
export type SmartKind = 'prg' | 'vsf' | 'crt' | 'd64' | 'tap' | 'project' | 'asm';

/** each kind's extensions, as the dialog's filter shows them */
export const SMART_EXTENSIONS: Record<SmartKind, string[]> = {
  prg: ['prg'], vsf: ['vsf'], crt: ['crt'], d64: ['d64', 'g64'], tap: ['tap', 't64'], project: ['json'], asm: ['asm'],
};

/** What `name` is opened as, by its extension. Any other file (none, `.bin`, `.p00`…) is read as a PRG, where a
 *  snapshot or a cartridge is still known by its header. */
export function smartKind(name: string): SmartKind {
  const ext = /\.([^.\\/]+)$/.exec(name)?.[1].toLowerCase() ?? '';
  for (const [kind, exts] of Object.entries(SMART_EXTENSIONS) as [SmartKind, string[]][]) if (exts.includes(ext)) return kind;
  return 'prg';
}

/** What is opened of the files picked: a project by itself (it takes the place of the work), else one source to pack,
 *  one disk to mount, one tape for the datasette and every PRG, snapshot and cartridge. `left`: the files not opened, and why. */
export interface SmartPlan {
  project: string | null;
  asm: string | null;
  disk: string | null;
  tape: string | null;
  files: string[];
  left: { path: string; why: string }[];
}

export function smartPlan(paths: string[]): SmartPlan {
  const plan: SmartPlan = { project: null, asm: null, disk: null, tape: null, files: [], left: [] };
  const project = paths.find(p => smartKind(p) === 'project');
  if (project) {
    plan.project = project;
    for (const p of paths) if (p !== project) plan.left.push({ path: p, why: 'a project opens by itself' });
    return plan;
  }
  for (const p of paths) {
    const kind = smartKind(p);
    if (kind === 'asm') {
      if (plan.asm == null) plan.asm = p; else plan.left.push({ path: p, why: 'Brokkr packs one source at a time' });
    } else if (kind === 'd64') {
      if (plan.disk == null) plan.disk = p; else plan.left.push({ path: p, why: 'one disk is mounted at a time' });
    } else if (kind === 'tap') {
      if (plan.tape == null) plan.tape = p; else plan.left.push({ path: p, why: 'one tape is in the datasette at a time' });
    } else plan.files.push(p);
  }
  return plan;
}
