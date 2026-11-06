/* @mimir/core — pure TypeScript, no DOM, no I/O. Runs in the analysis
 * worker, the renderer, Node tests and the CLI. Node-only helpers that
 * spawn the toolchain live in '@mimir/core/node'. */
export * from './types';
export { T, TYPE_INFO, TYPE_BY_KEY, MARK_AS, MARK_TYPE, DEFAULT_SETTINGS, TOOLCHAIN_KEYS, kindInfo, typeInfo } from './model';
export type { TypeGroup, TypeInfo, MarkAs } from './model';
export { h2, h4, $2, $4, word } from './util/hex';

export { OPC, ENC, MODE_LEN, KICK_ILLEGAL } from './cpu/opcodes';
export { undocumentedOpcode, undocumentedText, type UndocumentedInfo } from './cpu/undocumented';
export type { OpcodeInfo, AddrMode, Flow, Access } from './cpu/opcodes';
export { decode } from './cpu/decode';
export type { Decoded } from './cpu/decode';
export { branchTarget, cyclePath, cycleText, instructionCycles, type CycleBranch, type CyclePath, type Cycles, type CycleStep } from './cpu/cycles';

export { SYM, hwSymbol, isIO } from './c64/symbols';
export * from './c64/memconfig';
export { PETSCII_CONTROLS, petsciiControl, TEXT_ENCODINGS, textEncoding, type PetsciiControl, type TextEncodingInfo } from './c64/text';
export { parseBasic, BASIC_TOKENS } from './c64/basic';
export { parsePrg, makePrg, overwritesSystemArea, SYSTEM_AREA } from './c64/prg';
export {
  clipRanges, findInMemory, loadedRanges, MAX_MATCHES, monitorChar, monitorHexOf, monitorLine, monitorPrefix, monitorRows, monitorText, monitorTextOf, MONITOR_ROW, nextZero, parseMonitorCommand,
  petsciiToScreen, textLabel, TEXT_LABEL_MAX, type FindAs, type MemoryMatch, type MonitorChar, type MonitorCommand, type MonitorMode, type MonitorRange, type MonitorRow,
} from './c64/monitor';
export { isVsf, openC64File, parseVsf, patchSnapshot, snapshotConfig, snapshotVicBank, SNAPSHOT_LOAD, SNAPSHOT_ZP_LOAD, type OpenedFile, type OpenOptions, type Snapshot, type VsfModule } from './c64/vsf';
export {
  bankFiles, bootBank, cartMode, cartModeName, cartridgeSource, chipAddress, chipFromPrg, chipName, chipTypeName, compareCrt, crtBanks, crtBase, crtMode, crtOffsetText, crtOutputName, crtSourceName, crtTypeName, CRT_TYPES, projectCartMode,
  cartImageLines, cartLineText, describeCrt, isCrt, makeCrt, openCartridge, parseCrt, rebuildCrt, type CartLine, type CartSourceOptions, type ChipFile, type Crt, type CrtChip,
} from './c64/crt';
export { d64FileName, makeD64, parseD64, petsciiName, readD64File, sectorsOnTrack, type D64File, type D64FileType, type D64Image } from './c64/d64';
export { readSpindleDisk, spinChunkName, spinScript, type SpindleChunk, type SpindleDisk, type SpindleJob } from './c64/spindle-disk';
export { BITFIRE_VERSION, bitfireFileName, d64writeScript, readBitfireDisk, unpackBitnax, unpackDali, type BitfireDisk, type BitfireFile, type BitfireFormat, type BitfireUnpacked } from './c64/bitfire-disk';
export { makePsid, parsePsid } from './c64/psid';
export { sidPlayer, type SidPlayer, type SidPlayerOptions } from './c64/sidplayer';
export { artStudioPicture, ART_STUDIO_LOAD, BITMAP_SIZE, gfxSource, koalaPicture, KOALA_LOAD, SCREEN_SIZE, type GfxFileColors, type GfxFileKind } from './c64/gfxfiles';
export type { PsidInfo } from './c64/psid';

export { findBlock } from './analyze';
export { goneCounts, isFault, isProblem } from './analyze/deep';
// a cartridge's banks analysed, rendered and verified as spaces of their own (13.9b); one space goes to the engine as it is
export { analyze, bankAddr, fileSpaces, type SpaceCache, render, SPACE, spaceAddr, spaceFiles, spaceLines, spaceOf, spaceRender, spaceView, splitProject, verify } from './spaces';
export { spindleCondition, spindleLabel, spindleName, spindleRoutines, spindleScript } from './analyze/spindle';
export { validLabel, type RenderOptions } from './render/kick';
export { applyZpPairs, zpPairable } from './zp-pairs';
export { lineText, kickMnemonic, TOP_LEVEL_DIRECTIVES } from './render/lines';
export type { LineTextSettings } from './render/lines';
export { hardwareInclude } from './render/include';

export { assemble } from './verify/kick-subset-assembler';
export { comparePrg } from './verify/verify';
export { parseKickOutput } from './verify/kick-output';

export { DEMO_FONT, makeDemo } from './demo';
export type { DemoProgram } from './demo';
export { makeShowcase, showcaseProject, type ShowcaseProgram } from './showcase';
// bytes the program copies elsewhere to run there (8.1b)
export { addReloc, codeWhereLoaded, loadAddress, loadRange, moveKeys, moveReloc, relocAt, relocLoadedAt, relocProblem, removeReloc, type RelocKeys } from './relocs';
export { FORMATTABLE, formatOverride, keepCutTypes, lineMove, markIdOf, mergeOverride, mergeRange, moveBlockKeys, moveBytes, moveFrom, resizeBlock, splitBlock, type BlockMerge, type BlockResize, type BlockSplit, type ByteMove, type RangeMerge } from './edit';
export { createProject, demoProject, serializeProject, deserializeProject, projectNameFor, withId, newId, b64enc, b64dec } from './project';
export { buildScripts, BUILD_SCRIPTS, builtCartridge, cartBuild, cartridgeFiles, expectedCartridge, readme, projectScripts, projectTextFiles, exportFiles, type CartBuild } from './export';
export { applyPatch, assemblePatch, patchAt, patchEnd, patchesOn, patchFileName, patchPrg, patchSource, planPatch, projectUnpatched, revertPatch, straightCycles, switchPatch, unpatchedFiles, withPatch, withoutPatch, type PatchCode, type PatchError, type PatchLine, type PatchPlan, type PatchRequest, type PatchTime } from './patch';
export { NOTES_FILE, NOTES_TEXT_FILE, notesDocument, notesExport, notesFile, notesFor, notesText, lineHtml } from './notes-doc';
export { detectPacking, packerSignature, type PackingInfo } from './packing';
export { conclusive, depackers, depackerText, packerNames, unpackLog, unpackPrg, unpackSummary, type LayerReport, type Roms, type UnpackRun } from './sindri';
export { addDecisionChecks, addRunChecks, checkDecisions, checkRun, type DecisionCheck, type RunCheck } from './runcheck';
export { brokkrArgs, brokkrCommands, brokkrCommandText, brokkrPlan, crunchHere, packDecruncher, packNeeds, packWithBrokkr, type BrokkrCrunch, type BrokkrPack, type BrokkrPlan, type PackedFile } from './brokkr';
export {
  checkDecrunched, DEFAULT_PACK, editRanges, extraProblem, keepText, MEMORY_PLACES, mergeRanges, placeSpan, ZP_PLACES, type PackPlace, packArgs, packEffective, packFileName, packImage, packInputs, packOptions, packOutName, packParts, packProblem, parseKeep,
  parseExomizer, rangeCover, shellWord, type ExomizerArea, type ExomizerReport, type PackCheck, type PackFile, type PackPart,
} from './pack';
export { splitArgs } from './util/args';
export { fileOffsetBases, offsetText } from './offsets';
