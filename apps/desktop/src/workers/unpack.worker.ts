/* Unpacker worker: Sindri (@mimir/sindri) off the UI thread and apart from the analysis worker. A
 * run takes about 0.1 s, but one that never settles goes on to Sindri's time limit, some seconds. */
import * as Comlink from 'comlink';
import { unpackPrg, type Roms, type UnpackRun, type UnpackTape } from '@mimir/core';

const api = {
  /** `entry`: start the program with SYS there instead of as LOAD leaves it (RUN, or SYS to where it loads), with
   *  `port` in $01 when it is given; `vsf`: the PRG is this VICE snapshot's RAM, and Sindri goes on from the snapshot
   *  where it was taken */
  unpack(prg: Uint8Array, roms: Roms | null, disk: Uint8Array | null, tape: UnpackTape | null = null, entry: number | null = null, vsf: Uint8Array | null = null, port: number | null = null): UnpackRun {
    return unpackPrg(prg, roms, disk, entry, tape, vsf, port);
  },
};

export type UnpackApi = typeof api;
Comlink.expose(api);
