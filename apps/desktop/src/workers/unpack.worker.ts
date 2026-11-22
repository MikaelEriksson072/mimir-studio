/* Unpacker worker: Sindri (@mimir/sindri) off the UI thread and apart from the analysis worker. A
 * run takes about 0.1 s, but one that never settles goes on to Sindri's time limit, some seconds. */
import * as Comlink from 'comlink';
import { unpackPrg, type Roms, type UnpackDiskBoot, type UnpackRun, type UnpackTape } from '@mimir/core';

const api = {
  /** `entry`: start the program with SYS there instead of as LOAD leaves it (RUN, or SYS to where it loads), with
   *  `port` in $01 when it is given; `vsf`: the PRG is this VICE snapshot's RAM, and Sindri goes on from the snapshot
   *  where it was taken; `disks`: the disk's next sides, which Sindri turns to when the program asks; `diskBoot`: the
   *  file is one a loader on `disk` loads, and Sindri runs the disk's boot file when it does not run alone */
  unpack(prg: Uint8Array, roms: Roms | null, disk: Uint8Array | null, tape: UnpackTape | null = null, entry: number | null = null, vsf: Uint8Array | null = null, port: number | null = null, disks: Uint8Array[] = [], diskBoot: UnpackDiskBoot | null = null): UnpackRun {
    return unpackPrg(prg, roms, disk, entry, tape, vsf, port, disks, diskBoot);
  },
};

export type UnpackApi = typeof api;
Comlink.expose(api);
