/* The mounted disk's directory as a C64 shows it after LOAD"$",8 and LIST (Settings → General → As on a C64): the
 * screen core's directoryScreen prints, on C64Screen, the cursor blinking after READY. A file's rows open it, as in
 * Mimir's list. A file the directory's own control codes leave off the screen is listed under it. */
import { useMemo, type KeyboardEvent } from 'react';
import { directoryScreen, type D64File } from '@mimir/core';
import type { MountedDisk } from '../lib/types';
import { C64Screen, screenItems } from './C64Screen';

interface DiskScreenProps {
  disk: MountedDisk;
  /** the disk's files that are in the project */
  open: ReadonlySet<D64File>;
  /** the lower case character set (Commodore+Shift); null: as the listing leaves it */
  lower: boolean | null;
  onOpenFromDisk: (f: D64File, add: boolean) => void;
  /** ↑ ↓ Home End from file to file (the Explorer's lists share it): true when the key was one of them */
  listKeys: (e: KeyboardEvent<HTMLElement>) => boolean;
  /** a file's tooltip, as Mimir's list has it */
  titleOf: (f: D64File) => string;
  /** the type as the directory writes it: `*PRG`, `PRG<` */
  kindOf: (f: D64File) => string;
}

export function DiskScreen({ disk, open, lower, onOpenFromDisk, listKeys, titleOf, kindOf }: DiskScreenProps) {
  const screen = useMemo(() => directoryScreen(disk.bytes), [disk.bytes]);
  const items = useMemo(() => screenItems<D64File>(screen.rows, part => {
    const p = screen.parts[part];
    return p.kind === 'entry' && p.file != null ? disk.img.files[p.file] ?? null : null;
  }, f => f.type === 'PRG'), [screen, disk.img]);
  // the files whose rows the directory's own control codes (HOME, DEL) printed over
  const hidden = useMemo(() => { const shown = new Set(items.map(i => i.file)); return disk.img.files.filter(f => !shown.has(f)); }, [items, disk.img]);
  return (
    <>
      <C64Screen rows={screen.rows} lower={lower ?? screen.lower} cursor={screen.cursor} items={items} label={`Files on ${disk.name}, as a C64 lists them`}
        open={open} onOpen={onOpenFromDisk} listKeys={listKeys} titleOf={titleOf} labelOf={f => `${f.blocks} "${f.name}" ${kindOf(f)}`} nameOf={f => f.name} />
      {hidden.length > 0 && (
        <div className="side-hint c64-hidden">Not on the screen, printed over by the directory's own control codes:{' '}
          {hidden.map((f, i) => f.type === 'PRG'
            ? <button key={i} className="btn tiny ghost mono" title={titleOf(f)} onClick={() => onOpenFromDisk(f, false)}>"{f.name}"</button>
            : <span key={i} className="mono">"{f.name}" </span>)}
        </div>
      )}
    </>
  );
}
