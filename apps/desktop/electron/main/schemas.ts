/* zod schemas for everything that crosses the IPC boundary or is read from disk (spec 4.2). */
import { z } from 'zod';
import { extraProblem, isBookmarkColor, LEGACY_PROJECT_FORMAT, MAX_BLANKS, type BlockKind } from '@mimir/core';

const addr = z.number().int().min(0).max(0x10000);
/** an address in the project's work: in a cartridge's bank s, s * $10000 + the address (spec 13.9b) */
const at = z.number().int().min(0).max(4096 * 0x10000);
const record = z.record(z.string().regex(/^\d+$/), z.string());
/** zero-page bytes joined into a 16-bit variable (true) or split from one (false), by the low byte's address */
const zpPairs = z.record(z.string().regex(/^\d{1,3}$/), z.boolean());
/** how many empty lines the user inserted above an address (or under its comment line or block: `below`) */
const blankCount = z.number().int().min(1).max(MAX_BLANKS);
const blanks = z.record(z.string().regex(/^\d+$/), blankCount);
/** comment lines (`//`) and blocks the user inserted above an address */
const notes = z.record(z.string().regex(/^\d+$/), z.object({ text: z.string().max(20000), block: z.boolean().optional(), below: blankCount.optional() }));
/** the user's bookmarks: a title, a note and a colour per address, and where the area of one on an area ends (not
 * written to the source). A colour this version does not know is left out: the bookmark is amber; so is an end that
 * is no address: the bookmark is on its line */
const bookmarks = z.record(z.string().regex(/^\d+$/), z.object({
  title: z.string().max(200), text: z.string().max(20000), color: z.string().max(16).refine(isBookmarkColor).optional().catch(undefined),
  end: z.number().int().min(1).max(4096 * 0x10000).optional().catch(undefined),
}));
/** build.bat / build.sh as the user edited them */
const scripts = z.object({ 'build.bat': z.string().max(65536), 'build.sh': z.string().max(65536) }).partial().strict();
/** how the Pack view packs the project, with Brokkr or Exomizer (spec 13.8) */
const packRange = z.object({ start: addr, end: addr }).refine(r => r.end > r.start, 'empty range');
export const packPrefsSchema = z.object({
  // project files from before Brokkr have neither: they pack with Brokkr now
  packer: z.enum(['brokkr', 'exomizer']).default('brokkr'),
  effort: z.enum(['fast', 'normal', 'max']).default('normal'),
  format: z.enum(['exomizer', 'brokkr', 'fast', 'auto']).default('exomizer'),
  mode: z.enum(['sfx', 'mem']),
  ranges: z.array(packRange).max(4096).nullable(),
  // project files from before it have none: all of the build
  from: z.number().int().min(0).max(0xffff).nullable().default(null),
  start: z.enum(['sys', 'basic', 'jmp']),
  jmp: z.number().int().min(0).max(0xffff).nullable(),
  effect: z.enum(['default', 'none', 'x1', 'x2', 'x3']),
  ramExit: z.number().int().min(0).max(255).nullable(),
  irqExit: z.boolean().nullable(),
  memLoad: z.union([z.enum(['auto', 'none']), z.number().int().min(0).max(0xffff)]),
  forward: z.boolean(),
  compat: z.boolean(),
  fast: z.boolean(),
  extra: z.string().max(1024).refine(e => extraProblem(e) == null, e => ({ message: extraProblem(e) ?? '' })),
  out: z.string().max(128),
  // project files from before it have none: only the app's pack folder
  dir: z.string().max(1024).default(''),
  // project files from before they could be placed have none: Brokkr places the decruncher's working data
  zp: z.number().int().min(2).max(0xff).nullable().default(null),
  decruncherAt: z.number().int().min(0).max(0xffff).nullable().default(null),
  tablesAt: z.number().int().min(0).max(0xffff).nullable().default(null),
  keep: z.array(packRange).max(64).default([]),
  // project files from before them: crunched data in one file, with the decruncher written next to it
  split: z.boolean().default(false),
  decruncher: z.boolean().default(true),
  // project files from before it have none: no limit
  maxSeconds: z.number().positive().max(3600).nullable().default(null),
}).strict();
const blockKinds = ['code', 'data', 'words', 'text', 'table', 'lohi', 'sprite', 'charset', 'bitmap', 'screen', 'music', 'fill', 'basic'] as const satisfies readonly BlockKind[];

export const overrideSchema = z.object({
  start: at,
  end: at,
  // older project files wrote 'bytes'; unknown kinds are data, exactly as analyze() treats them
  type: z.string().max(16).transform((t): BlockKind | 'auto' => (t === 'auto' || (blockKinds as readonly string[]).includes(t) ? t as BlockKind | 'auto' : 'data')),
  props: z.object({
    enc: z.enum(['petscii', 'screen', 'petscii-mixed', 'screen-mixed']).optional(),
    row: z.number().int().min(1).max(256).optional(),
    fmt: z.enum(['hex', 'bin', 'dec']).optional(),
    init: at.optional(),
    play: at.optional(),
    sub: z.string().max(16).optional(),
  }).partial().optional(),
});

export const toolchainSettingsSchema = z.object({
  javaPath: z.string().max(1024),
  kickJar: z.string().max(1024),
  vicePath: z.string().max(1024),
  outDir: z.string().max(128).regex(/^[A-Za-z0-9_.-]+$/, 'output folder must be a plain folder name'),
  kickArgs: z.string().max(1024),
  viceArgs: z.string().max(1024),
  unpackerPath: z.string().max(1024),
  unpackerArgs: z.string().max(1024),
  exomizerPath: z.string().max(1024),
  viceQuicksave: z.string().max(1024),
  editorPath: z.string().max(1024),
  editorArgs: z.string().max(1024),
  musicPlayer: z.enum(['vice', 'deepsid']),
  debugger: z.enum(['retro', 'c64d']),
  retroDebuggerPath: z.string().max(1024),
  retroDebuggerArgs: z.string().max(1024),
  c64DebuggerPath: z.string().max(1024),
  c64DebuggerArgs: z.string().max(1024),
  debuggerWait: z.number().int().min(0).max(60000),
});

/** settings:locate: which tool's folder to ask for, and the path in the form (where the dialog opens) */
export const locateSchema = z.object({
  key: z.enum(['javaPath', 'kickJar', 'vicePath', 'viceQuicksave', 'unpackerPath', 'editorPath', 'exomizerPath', 'retroDebuggerPath', 'c64DebuggerPath']),
  current: z.string().max(1024).optional(),
}).strict();

export const settingsSchema = toolchainSettingsSchema.partial().extend({
  illegal: z.boolean(), detectMusic: z.boolean(), detectGfx: z.boolean(), detectText: z.boolean(), bankTracking: z.boolean(), snapshotZeroPage: z.boolean(), codeIslands: z.boolean(), deepAnalysis: z.boolean(),
  mnemonicCase: z.enum(['lower', 'upper']), hexCase: z.enum(['lower', 'upper']),
  bytesPerRow: z.number().int().min(1).max(64), indent: z.number().int().min(0).max(16), commentCol: z.number().int().min(0).max(160),
  basicUpstart: z.boolean(), hwInclude: z.enum(['import', 'inline', 'none']), hwComments: z.boolean(),
  musicAsSid: z.boolean(), gfxBinary: z.boolean(), addrComments: z.boolean(), notesFormat: z.enum(['html', 'txt', 'none']),
  cartOneSource: z.boolean(),
}).partial();

const fileName = z.string().min(1).max(255);
/** a cartridge's CHIP packet (spec 13.9); an EasyFlash has 128 */
const chip = z.number().int().min(0).max(4095);
/** a cartridge image: at most 16 MB (the largest VICE emulates are 16 MB) */
const crtBytes = z.instanceof(Uint8Array).refine(b => b.length >= 0x40 && b.length <= 16 * 1024 * 1024 + 0x10000, 'not a cartridge image');
/** code the user wrote over the loaded bytes (spec 10.2): what it wrote and what was there, as many bytes */
const patchFields = { name: z.string().min(1).max(64), start: at, end: at, source: z.string().max(400000), fill: z.enum(['nop', 'keep']), over: z.boolean(), off: z.boolean().optional(), cycles: z.boolean().optional(), at: at.optional(), script: z.string().max(64).optional() };
const base64 = z.string().max(0x20000).regex(/^[A-Za-z0-9+/]*={0,2}$/);
const serializedPatch = z.object({ ...patchFields, bytes: base64, old: base64 })
  .refine(p => p.bytes.length === p.old.length && p.bytes.length > 0, 'the bytes written and the bytes written over differ in length');
const patch = z.object({ ...patchFields, id: z.string().max(64), bytes: z.instanceof(Uint8Array), old: z.instanceof(Uint8Array) })
  .refine(p => p.bytes.length === p.old.length && p.bytes.length > 0 && p.start + p.bytes.length <= 0x10000, 'the bytes written and the bytes written over differ in length');
/** a user script (spec 10.3): its code and its scratchpads, what a pad holds after the last run as many bytes as it is big */
const padFields = { name: z.string().min(1).max(64), start: z.number().int().min(0).max(0xffff), size: z.number().int().min(1).max(0x10000), fill: z.number().int().min(0).max(255).optional(),
  src: z.object({ form: z.enum(['asm', 'hex', 'text']), text: z.string().max(400000), screen: z.boolean().optional() }).optional() };
const b64 = z.string().max(0x16000).regex(/^[A-Za-z0-9+/]*={0,2}$/);
const padFits = (p: { start: number; size: number }) => p.start + p.size <= 0x10000;
/** what a script's runs start with: A, X, Y, the status register and zero-page bytes (a word at $00-$fe) */
const reg = z.number().int().min(0).max(255);
const scriptInit = z.object({
  a: reg.optional(), x: reg.optional(), y: reg.optional(), p: reg.optional(),
  zp: z.array(z.object({ at: z.number().int().min(0).max(0xff), value: z.number().int().min(0).max(0xffff), word: z.boolean().optional() })
    .refine(e => (e.word ? e.at <= 0xfe : e.value <= 0xff), 'a zero-page word past $ff, or a byte with a word\'s value')).max(256).optional(),
});
const scriptFields = { name: z.string().min(1).max(64), lang: z.literal('kickass'), source: z.string().max(262144), links: z.array(at).max(256).optional(), safe: z.boolean().optional(), init: scriptInit.optional() };
const serializedScript = z.object({ ...scriptFields, id: z.string().max(64).optional(), pads: z.array(z.object({ ...padFields, bytes: b64.optional(), data: b64.optional() }).refine(padFits, 'a scratchpad past $ffff')).max(64) });
const userScript = z.object({ ...scriptFields, id: z.string().max(64), pads: z.array(z.object({ ...padFields, bytes: z.instanceof(Uint8Array).optional(), data: z.instanceof(Uint8Array).refine(d => d.length <= 0x10000).optional() }).refine(p => padFits(p) && (!p.bytes || p.bytes.length === p.size), 'a scratchpad past $ffff, or its bytes not as many as it holds')).max(64) });
/** memory configuration / VIC bank the code in a range runs with (null: back to detection) */
const bankZone = z.object({ start: at, end: at, port: z.number().int().min(0).max(255).nullable().optional(), vicBank: z.number().int().min(0).max(3).nullable().optional() });
/** bytes the program copies elsewhere to run there (spec 8.1b): loaded at start-end (end excluded), run at `to` */
const reloc = z.object({ start: at, end: at, to: at }).refine(r => r.start < r.end && r.end - r.start <= 0x10000, 'a relocated block needs at least one byte');
/** bytes the user called junk (spec 11.7): start-end, end excluded */
const junk = z.array(z.object({ start: at, end: at }).refine(j => j.start < j.end && j.end - j.start <= 0x10000, 'a junk area needs at least one byte')).max(65536);
/** bytes the listing shows at another address (spec 10.4): loaded at start-end (end excluded), shown at `to` */
const viewOffsets = z.array(z.object({ start: at, end: at, to: at }).refine(o => o.start < o.end && o.end - o.start <= 0x10000, 'a view offset needs at least one byte')).max(4096);

/** .mimir.json on disk (and a .krproj.json saved before the rename) */
export const serializedProjectSchema = z.object({
  format: z.enum(['mimir-project', LEGACY_PROJECT_FORMAT]),
  version: z.literal(1),
  name: z.string().max(255).default('project'),
  // project files from before snapshots were kept have no vsf; a chip of the cartridge says which; a new project has
  // no files until one is opened in it
  files: z.array(z.object({ name: fileName, load: addr, data: z.string(), vsf: z.string().optional(), chip: chip.optional() })).max(1024),
  overrides: z.array(overrideSchema).max(100000).default([]),
  entries: z.array(at).max(65536).default([]),
  // project files from before the program start could be set have none
  entryPoint: at.nullable().default(null),
  // $01 at the program start, when Sindri saw another than $37 there; project files from before it, and others, have none
  entryPort: z.number().int().min(0).max(0xff).nullable().optional(),
  labels: record.default({}),
  comments: record.default({}),
  blockComments: record.default({}),
  // project files from before comment lines and blocks existed have none
  notes: notes.default({}),
  // project files from before empty lines could be inserted, and those without one, have none
  blanks: blanks.optional(),
  // project files from before bookmarks have none
  bookmarks: bookmarks.default({}),
  // project files from before zero-page pairs, and those without one, have none
  zpPairs: zpPairs.optional(),
  // project files from before the build scripts could be edited have none
  scripts: scripts.default({}),
  // project files from before packing with Exomizer have none
  pack: packPrefsSchema.nullable().default(null),
  // project files from before patches have none
  patches: z.array(serializedPatch).max(4096).default([]),
  // project files from before user scripts, and those without one, have none
  userScripts: z.array(serializedScript).max(256).optional(),
  bankZones: z.array(bankZone).max(100000).default([]),
  // project files from before blocks could be relocated have none
  relocs: z.array(reloc).max(4096).default([]),
  // project files from before blocks could be excluded have none
  excluded: z.array(at).max(65536).default([]),
  // project files from before blocks could be saved as binary files have none
  binary: z.array(at).max(65536).default([]),
  // project files from before junk, and those without any, have none
  junk: junk.optional(),
  // project files from before view offsets, and those without any, have none
  viewOffsets: viewOffsets.optional(),
  // project files from before cartridges, and those without one, have none
  cart: z.object({ name: fileName, data: z.string() }).optional(),
  settings: settingsSchema.default({}),
});

/** Project as sent by the renderer (bytes as Uint8Array). */
export const projectSchema = z.object({
  format: z.literal('mimir-project'),
  version: z.literal(1),
  name: z.string().max(255),
  files: z.array(z.object({ id: z.string().max(64), name: fileName, load: addr, bytes: z.instanceof(Uint8Array), vsf: z.instanceof(Uint8Array).optional(), chip: chip.optional() })).max(1024),
  overrides: z.array(overrideSchema).max(100000),
  entries: z.array(at).max(65536),
  entryPoint: at.nullable(),
  entryPort: z.number().int().min(0).max(0xff).nullable().optional(),
  labels: record,
  comments: record,
  blockComments: record,
  notes,
  blanks: blanks.optional(),
  bookmarks,
  zpPairs: zpPairs.optional(),
  scripts,
  pack: packPrefsSchema.nullable().optional(),
  patches: z.array(patch).max(4096),
  userScripts: z.array(userScript).max(256).optional(),
  bankZones: z.array(bankZone).max(100000),
  relocs: z.array(reloc).max(4096),
  excluded: z.array(at).max(65536),
  binary: z.array(at).max(65536),
  junk: junk.optional(),
  viewOffsets: viewOffsets.optional(),
  cart: z.object({ name: fileName, crt: crtBytes }).nullable().optional(),
  settings: settingsSchema,
});

export const projectOpenSchema = z.object({ path: z.string().max(4096).optional() }).default({});
export const projectSaveSchema = z.object({ project: projectSchema, path: z.string().max(4096).optional() });
/** a new project's folder (its name is checked again where the folder is made) and the work that moves into it */
export const projectCreateSchema = z.object({
  name: z.string().min(1).max(80),
  parent: z.string().min(1).max(4096),
  project: projectSchema,
  gather: z.object({ exportDir: z.string().max(4096), buildDir: z.string().max(4096), packed: z.string().max(4096) }).partial().strict().optional(),
  git: z.boolean().optional(),
});
export const projectForgetSchema = z.object({ file: z.string().min(1).max(4096) }).strict();
/** the page's answer when its window is to close (closing.ts) */
export const windowCloseSchema = z.object({ close: z.boolean() }).strict();
/** `zeroPage`: VICE snapshots open from $0002 (zero page and stack included); `kind`: what the dialog asks for */
export const prgOpenSchema = z.object({ paths: z.array(z.string().max(4096)).max(64).optional(), zeroPage: z.boolean().optional(), kind: z.enum(['prg', 'crt', 'vsf', 'add']).optional() }).default({});
export const diskOpenSchema = z.object({ path: z.string().max(4096).optional() }).default({});
export const tapeOpenSchema = z.object({ path: z.string().max(4096).optional() }).default({});
export const smartAttachSchema = z.object({ zeroPage: z.boolean().optional() }).strict().default({});
export const terminalOpenSchema = z.object({ dir: z.string().min(1).max(4096).optional() }).default({});
/** the folder of the export (one of this session) and its first source, a plain .asm name */
export const editorOpenSchema = z.object({ dir: z.string().min(1).max(4096).optional(), file: z.string().min(1).max(255) }).strict();
/** a packed PRG (load address first) for the external unpacker */
export const unpackSchema = z.object({ name: fileName, prg: z.instanceof(Uint8Array).refine(b => b.length >= 3 && b.length <= 0x10002, 'not a PRG') });
export const exportWriteSchema = z.object({
  dir: z.string().max(4096).optional(),
  target: z.enum(['pick', 'temp', 'project', 'build']).optional(),
  name: z.string().max(64).regex(/^[A-Za-z0-9_-]*$/).optional(),
  files: z.record(z.string().min(1).max(512), z.union([z.string(), z.instanceof(Uint8Array)])),
}).refine(r => !!r.dir !== !!r.target, 'give either dir or target');
/** the sources to assemble: one per project file, and a cartridge's own source after them */
export const buildSchema = z.object({ dir: z.string().min(1).max(4096), entries: z.array(z.string().max(255)).min(1).max(1025) });
/** `cart`: prgPath is a cartridge image VICE attaches (-cartcrt) */
export const runSchema = z.object({ prgPath: z.string().min(1).max(4096), labelsPath: z.string().max(4096).optional(), start: z.number().int().min(0).max(0xffff).optional(), port: z.number().int().min(0).max(0xff).optional(), disk: z.string().min(1).max(4096).optional(), tape: z.string().min(1).max(4096).optional(), cart: z.boolean().optional(), debugger: z.boolean().optional() });
const prg = z.instanceof(Uint8Array).refine(b => b.length >= 3 && b.length <= 0x10002, 'not a PRG');
/** the built PRGs (one per project file, in order) and how to pack them */
export const packSchema = z.object({ files: z.array(z.object({ name: fileName, prg })).min(1).max(64), prefs: packPrefsSchema });
/** the folder for the packed file: `dir` is kept if this session may write there, else a dialog asks (always with `ask`) */
export const packFolderSchema = z.object({ dir: z.string().min(1).max(1024).optional(), ask: z.boolean().optional() }).strict();
/** a file to save with a dialog (the packed PRG, graphics, .byte source): its suggested name and bytes */
/** a music block's .sid for DeepSID: a plain file name (DeepSID keeps it under that name) and a PSID/RSID file */
export const deepSidPlaySchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,60}\.sid$/, 'not a plain .sid file name'),
  sid: z.instanceof(Uint8Array).refine(b => b.length > 0x7c && b.length <= 0x10000 + 0x7e && (b[0] === 0x50 || b[0] === 0x52) && b[1] === 0x53 && b[2] === 0x49 && b[3] === 0x44, 'not a PSID or RSID file'),
});

export const fileSaveSchema = z.object({ name: fileName, bytes: z.instanceof(Uint8Array).refine(b => b.length > 0 && b.length <= 4 * 1024 * 1024, 'empty or larger than 4 MB'), title: z.string().max(200).optional() });
/** VICE's quicksave snapshot: `zeroPage` opens it from $0002 */
export const quicksaveSchema = z.object({ zeroPage: z.boolean().optional() }).strict().default({});
/** one of the kept quicksaves, by the id the list gave (13.7b) */
const quicksaveId = z.string().regex(/^[a-z0-9]{1,32}$/);
export const quicksaveEntrySchema = z.object({ id: quicksaveId, zeroPage: z.boolean().optional() }).strict();
export const quicksaveRenameSchema = z.object({ id: quicksaveId, name: z.string().trim().min(1).max(80) }).strict();
export const quicksaveSaveSchema = z.object({ id: quicksaveId }).strict();
export const quicksaveFavouriteSchema = z.object({ id: quicksaveId, on: z.boolean() }).strict();
export const viceAttachSchema = z.object({ host: z.string().max(255).optional(), port: z.number().int().min(1).max(65535).optional() }).default({});
export const viceCommandSchema = z.object({ command: z.string().max(4096) });

/* Git (spec 13.10b): files of the project's repository, from its root; the folder and the remote's branch come from
 * the main process */
const gitPath = z.string().min(1).max(4096);
export const gitPathsSchema = z.object({ paths: z.array(gitPath).min(1).max(20000).optional() }).strict();
export const gitCommitSchema = z.object({ message: z.string().min(1).max(64 * 1024) }).strict();
export const gitRemoteSchema = z.object({ url: z.string().min(1).max(2048) }).strict();
export const gitDiffSchema = z.object({ path: gitPath, from: gitPath.optional(), staged: z.boolean() }).strict();
