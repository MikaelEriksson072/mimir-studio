/* The standard structures of C64 cartridges (spec 10.3, 13.9): for each hardware type, the sizes it comes in and for
 * each size the EXROM and GAME lines and the CHIP packets: their banks, where each is mapped, how big it is and what
 * kind of chip it is. They are the images VICE 3.10's cartconv writes of a .bin of that size (cartconv -b -t <key>),
 * byte for byte: the table is made from them, and the test compares where cartconv is there. The keys are cartconv's.
 *
 * A size is a list of runs, each [first bank, how many banks, the step between their numbers, the chips of each bank
 * as [load address, size, chip type]]; the chips come in the image in that order, which is the order a .bin's bytes
 * fill them in. */
import type { Addr } from '../types';
import { CRT_TYPES } from './crt';

const K = 1024;
type Run = [first: number, banks: number, step: number, chips: [load: Addr, size: number, type: number][]];
interface LayoutSizes { key: string; hw: number; sizes: { size: number; exrom: number; game: number; runs: Run[] }[] }

const TABLE: LayoutSizes[] = [
  { key: 'normal', hw: 0, sizes: [{ size: 4 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 4 * K, 0]]]] },
    { size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 12 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 12 * K, 0]]]] },
    { size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'ulti', hw: 0, sizes: [{ size: 4 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xf000, 4 * K, 0]]]] },
    { size: 8 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xe000, 8 * K, 0]]]] },
    { size: 16 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xe000, 8 * K, 0]]]] }] },
  { key: 'ap', hw: 9, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ar2', hw: 50, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ar3', hw: 35, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ar4', hw: 30, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ar5', hw: 1, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'bb3', hw: 65, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'bb4', hw: 66, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'bb8', hw: 64, sizes: [{ size: 32 * K, exrom: 0, game: 0, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 96 * K, exrom: 0, game: 0, runs: [[0, 6, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'bb9', hw: 71, sizes: [{ size: 32 * K, exrom: 1, game: 0, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'bdt', hw: 83, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'bis', hw: 68, sizes: [{ size: 2 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 2 * K, 0]]]] },
    { size: 4 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 4 * K, 0]]]] },
    { size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'cap', hw: 34, sizes: [{ size: 8 * K, exrom: 1, game: 1, runs: [[0, 1, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'comal', hw: 21, sizes: [{ size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 128 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'dep64', hw: 24, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'din', hw: 17, sizes: [{ size: 128 * K, exrom: 0, game: 1, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'drean', hw: 74, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'dsm', hw: 52, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'easy', hw: 32, sizes: [{ size: 1024 * K, exrom: 1, game: 0, runs: [[0, 64, 1, [[0x8000, 8 * K, 2], [0xa000, 8 * K, 2]]]] }] },
  { key: 'ecr', hw: 59, sizes: [{ size: 24 * K, exrom: 1, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xa000, 8 * K, 0]]], [1, 1, 1, [[0xa000, 8 * K, 0]]]] }] },
  { key: 'epyx', hw: 10, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'exos', hw: 44, sizes: [{ size: 8 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'expert', hw: 6, sizes: [{ size: 8 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 1]]]] }] },
  { key: 'f64', hw: 56, sizes: [{ size: 32 * K, exrom: 1, game: 0, runs: [[0, 4, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'fc1', hw: 13, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'fc3', hw: 3, sizes: [{ size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 256 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'fcp', hw: 29, sizes: [{ size: 32 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x0000, 32 * K, 0]]]] }] },
  { key: 'ff', hw: 45, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ff2', hw: 77, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'fm', hw: 46, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 32 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'fp', hw: 7, sizes: [{ size: 128 * K, exrom: 0, game: 1, runs: [[0, 8, 8, [[0x8000, 8 * K, 0]]], [1, 8, 8, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'gk', hw: 42, sizes: [{ size: 8 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'gmod2', hw: 60, sizes: [{ size: 512 * K, exrom: 0, game: 1, runs: [[0, 64, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'gmod3', hw: 62, sizes: [{ size: 2048 * K, exrom: 0, game: 1, runs: [[0, 256, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 4096 * K, exrom: 0, game: 1, runs: [[0, 512, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 8192 * K, exrom: 0, game: 1, runs: [[0, 1024, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 16384 * K, exrom: 0, game: 1, runs: [[0, 2048, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'gs', hw: 15, sizes: [{ size: 512 * K, exrom: 0, game: 1, runs: [[0, 64, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'hyper', hw: 79, sizes: [{ size: 64 * K, exrom: 0, game: 1, runs: [[0, 8, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ide64', hw: 39, sizes: [{ size: 64 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 16 * K, 2]]]] },
    { size: 128 * K, exrom: 0, game: 1, runs: [[0, 8, 1, [[0x8000, 16 * K, 2]]]] },
    { size: 512 * K, exrom: 0, game: 1, runs: [[0, 32, 1, [[0x8000, 16 * K, 2]]]] }] },
  { key: 'ieee', hw: 41, sizes: [{ size: 4 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 4 * K, 0]]]] }] },
  { key: 'ieeeflash64', hw: 75, sizes: [{ size: 8 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'kcs', hw: 2, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xa000, 8 * K, 0]]]] }] },
  { key: 'ks', hw: 54, sizes: [{ size: 24 * K, exrom: 0, game: 0, runs: [[0, 3, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ltk', hw: 72, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'mach5', hw: 51, sizes: [{ size: 4 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 4 * K, 0]]]] },
    { size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'max', hw: 61, sizes: [{ size: 16 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xe000, 8 * K, 0]]]] }] },
  { key: 'mb', hw: 86, sizes: [{ size: 1024 * K, exrom: 0, game: 1, runs: [[0, 128, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'md', hw: 19, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 64 * K, exrom: 0, game: 1, runs: [[0, 8, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 96 * K, exrom: 0, game: 1, runs: [[0, 12, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 128 * K, exrom: 0, game: 1, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 256 * K, exrom: 0, game: 1, runs: [[0, 32, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 512 * K, exrom: 0, game: 1, runs: [[0, 64, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 1024 * K, exrom: 0, game: 1, runs: [[0, 128, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'md16', hw: 85, sizes: [{ size: 32 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 64 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 96 * K, exrom: 0, game: 0, runs: [[0, 12, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 128 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 256 * K, exrom: 0, game: 0, runs: [[0, 32, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 512 * K, exrom: 0, game: 0, runs: [[0, 64, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 1024 * K, exrom: 0, game: 0, runs: [[0, 128, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 2048 * K, exrom: 0, game: 0, runs: [[0, 256, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'mf', hw: 14, sizes: [{ size: 32 * K, exrom: 1, game: 0, runs: [[0, 4, 1, [[0xe000, 8 * K, 0]]]] },
    { size: 64 * K, exrom: 1, game: 0, runs: [[0, 8, 1, [[0xe000, 8 * K, 0]]]] },
    { size: 96 * K, exrom: 1, game: 0, runs: [[0, 12, 1, [[0xe000, 8 * K, 0]]]] },
    { size: 128 * K, exrom: 1, game: 0, runs: [[0, 16, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'mikro', hw: 28, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'mm', hw: 70, sizes: [{ size: 1024 * K, exrom: 1, game: 0, runs: [[0, 64, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'mmc64', hw: 37, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'mmcr', hw: 38, sizes: [{ size: 64 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 512 * K, exrom: 0, game: 0, runs: [[0, 64, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'mv', hw: 49, sizes: [{ size: 16 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'ocean', hw: 5, sizes: [{ size: 32 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 128 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 256 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]], [16, 16, 1, [[0xa000, 8 * K, 0]]]] },
    { size: 512 * K, exrom: 0, game: 1, runs: [[0, 64, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'p64', hw: 43, sizes: [{ size: 256 * K, exrom: 0, game: 1, runs: [[0, 32, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'partner64', hw: 78, sizes: [{ size: 16 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xe000, 8 * K, 0]]]] }] },
  { key: 'pd', hw: 84, sizes: [{ size: 16 * K, exrom: 1, game: 0, runs: [[0, 2, 1, [[0xe000, 8 * K, 0]]]] }] },
  { key: 'pf', hw: 53, sizes: [{ size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'rgcd', hw: 57, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 24 * K, exrom: 0, game: 1, runs: [[0, 3, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 64 * K, exrom: 0, game: 1, runs: [[0, 8, 1, [[0x8000, 8 * K, 0]]]] },
    { size: 96 * K, exrom: 0, game: 1, runs: [[0, 12, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'rl', hw: 73, sizes: [{ size: 64 * K, exrom: 1, game: 0, runs: [[0, 8, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'ross', hw: 23, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 32 * K, exrom: 0, game: 0, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'rr', hw: 36, sizes: [{ size: 32 * K, exrom: 0, game: 1, runs: [[0, 4, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 64 * K, exrom: 0, game: 1, runs: [[0, 8, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 96 * K, exrom: 0, game: 1, runs: [[0, 12, 1, [[0x8000, 8 * K, 2]]]] },
    { size: 128 * K, exrom: 0, game: 1, runs: [[0, 16, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'rrf', hw: 67, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'rrnet', hw: 58, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 2]]]] }] },
  { key: 'ru', hw: 12, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 's64', hw: 47, sizes: [{ size: 4 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0xe000, 4 * K, 0]]]] }] },
  { key: 'sb', hw: 22, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'sdbox', hw: 69, sizes: [{ size: 128 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'se5', hw: 48, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'sg', hw: 8, sizes: [{ size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'silver', hw: 55, sizes: [{ size: 128 * K, exrom: 0, game: 1, runs: [[0, 16, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'simon', hw: 4, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xa000, 8 * K, 0]]]] }] },
  { key: 'ss4', hw: 40, sizes: [{ size: 32 * K, exrom: 0, game: 0, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'ss5', hw: 20, sizes: [{ size: 64 * K, exrom: 1, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 128 * K, exrom: 1, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'star', hw: 31, sizes: [{ size: 16 * K, exrom: 1, game: 0, runs: [[0, 1, 1, [[0x8000, 8 * K, 0], [0xe000, 8 * K, 0]]]] }] },
  { key: 'turtle', hw: 76, sizes: [{ size: 16 * K, exrom: 0, game: 1, runs: [[0, 2, 1, [[0x8000, 8 * K, 0]]]] }] },
  { key: 'uc1', hw: 80, sizes: [{ size: 32 * K, exrom: 0, game: 0, runs: [[0, 2, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 64 * K, exrom: 0, game: 0, runs: [[0, 4, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 96 * K, exrom: 0, game: 0, runs: [[0, 6, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 128 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'uc15', hw: 81, sizes: [{ size: 128 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 256 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 16 * K, 0]]]] },
    { size: 512 * K, exrom: 0, game: 0, runs: [[0, 32, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'uc2', hw: 82, sizes: [{ size: 128 * K, exrom: 0, game: 0, runs: [[0, 8, 1, [[0x8000, 16 * K, 2]]]] },
    { size: 256 * K, exrom: 0, game: 0, runs: [[0, 16, 1, [[0x8000, 16 * K, 2]]]] },
    { size: 512 * K, exrom: 0, game: 0, runs: [[0, 32, 1, [[0x8000, 16 * K, 2]]]] }] },
  { key: 'wl', hw: 11, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'ws', hw: 16, sizes: [{ size: 16 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 16 * K, 0]]]] }] },
  { key: 'zaxxon', hw: 18, sizes: [{ size: 20 * K, exrom: 0, game: 0, runs: [[0, 1, 1, [[0x8000, 4 * K, 0], [0xa000, 8 * K, 0]]], [1, 1, 1, [[0xa000, 8 * K, 0]]]] }] },
  { key: 'zipp', hw: 63, sizes: [{ size: 8 * K, exrom: 0, game: 1, runs: [[0, 1, 1, [[0x8000, 8 * K, 0]]]] }] },
];

/** a chip of a structure: its bank, the address the image maps it at, its size and its type (0 ROM, 1 RAM, 2 Flash) */
export interface CrtLayoutChip { bank: number; load: Addr; size: number; type: number }
/** a standard structure of one size */
export interface CrtLayout { key: string; hw: number; name: string; size: number; exrom: number; game: number; banks: number; chips: CrtLayoutChip[] }

const TITLES: Record<string, string> = { normal: 'Normal cartridge (8K or 16K mode)', ulti: 'Normal cartridge in Ultimax mode' };
/** what a structure is called: the hardware type's name */
export const crtLayoutName = (key: string, hw: number): string => TITLES[key] ?? CRT_TYPES[hw] ?? `cartridge type ${hw}`;

/** The standard structures: their key, hardware type, name and the sizes (in bytes of ROM) each comes in. */
export const CRT_LAYOUTS: readonly { key: string; hw: number; name: string; sizes: readonly number[] }[] =
  TABLE.map(t => ({ key: t.key, hw: t.hw, name: crtLayoutName(t.key, t.hw), sizes: t.sizes.map(s => s.size) }));

/**
 * The structure `key` (cartconv's name of it, or the hardware type's number: its first structure) of `size` bytes; the
 * smallest size when none is given. null when there is no such structure or it does not come in that size.
 */
export function crtLayout(key: string | number, size?: number): CrtLayout | null {
  const t = typeof key === 'number' ? TABLE.find(x => x.hw === key && x.key !== 'ulti') : TABLE.find(x => x.key === key.toLowerCase());
  const s = t && (size == null ? t.sizes[0] : t.sizes.find(x => x.size === size));
  if (!t || !s) return null;
  const chips: CrtLayoutChip[] = [];
  for (const [first, n, step, cs] of s.runs) for (let i = 0; i < n; i++) for (const [load, sz, type] of cs) chips.push({ bank: first + i * step, load, size: sz, type });
  return { key: t.key, hw: t.hw, name: crtLayoutName(t.key, t.hw), size: s.size, exrom: s.exrom, game: s.game, banks: new Set(chips.map(c => c.bank)).size, chips };
}
