/* Unpacker worker: Sindri (@mimir/sindri) off the UI thread and apart from the analysis worker. A
 * run takes about 0.1 s, but one that never settles goes on to Sindri's time limit, some seconds. */
import * as Comlink from 'comlink';
import { unpackPrg, type Roms, type UnpackRun, type UnpackTape } from '@mimir/core';

const api = {
  unpack(prg: Uint8Array, roms: Roms | null, disk: Uint8Array | null, tape: UnpackTape | null = null): UnpackRun {
    return unpackPrg(prg, roms, disk, null, tape);
  },
};

export type UnpackApi = typeof api;
Comlink.expose(api);
