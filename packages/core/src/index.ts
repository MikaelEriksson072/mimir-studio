/* @mimir/core — pure TypeScript, no DOM, no I/O. Runs in the analysis
 * worker, the renderer, Node tests and the CLI. Node-only helpers that
 * spawn the toolchain live in '@mimir/core/node'. */
export * from './types';
export { T, TYPE_INFO, TYPE_BY_KEY, MARK_AS, MARK_TYPE, DEFAULT_SETTINGS, TOOLCHAIN_KEYS, kindInfo, typeInfo } from './model';
export type { TypeGroup, TypeInfo, MarkAs } from './model';
export { h2, h4, $2, $4, word } from './util/hex';

export { OPC, ENC, MODE_LEN, KICK_ILLEGAL, TASS_ENC, TASS_NAMES, tassName } from './cpu/opcodes';
export { undocumentedOpcode, undocumentedText, type UndocumentedInfo } from './cpu/undocumented';
export type { OpcodeInfo, AddrMode, Flow, Access } from './cpu/opcodes';
export { decode } from './cpu/decode';
export type { Decoded } from './cpu/decode';
export { branchTarget, cyclePath, cycleText, instructionCycles, type CycleBranch, type CyclePath, type Cycles, type CycleStep } from './cpu/cycles';

export { SYM, hwSymbol, isIO } from './c64/symbols';
export * from './c64/memconfig';
export { PETSCII_CONTROLS, petsciiControl, TEXT_ENCODINGS, textEncoding, type PetsciiControl, type TextEncodingInfo } from './c64/text';
export { parseBasic, BASIC_TOKENS } from './c64/basic';
export { parsePrg, makePrg, overwritesSystemArea, coversReadyScreen, startsFromMonitor, SYSTEM_AREA, READY_SCREEN, START_STUB } from './c64/prg';
export { debuggerStart, DRIVE_INIT, startCode, type DebuggerStart, type DebuggerVia } from './c64/debugger-start';
export type { IoStep, StartIo } from '@mimir/sindri';
export { debugInfoFile, debugSources, viceLabels, type DebugInfo, type DebugSource, type DebugWatch, type DebugWatchFormat } from './c64/debugger-dbg';
export {
  clipRanges, findInMemory, loadedRanges, MAX_MATCHES, monitorChar, monitorHexOf, monitorLine, monitorPrefix, monitorRows, monitorText, monitorTextOf, MONITOR_PER_ROW, MONITOR_ROW, nextZero, parseMonitorCommand,
  petsciiToScreen, textLabel, TEXT_LABEL_MAX, type FindAs, type MemoryMatch, type MonitorChar, type MonitorCommand, type MonitorLineOpts, type MonitorMode, type MonitorPerRow, type MonitorRange, type MonitorRow,
} from './c64/monitor';
export { snapshotForC64Debugger, type DebuggerSnapshot, type DebuggerSnapshotOptions } from './c64/vsf-c64d';
export { isVsf, openC64File, parseVsf, patchSnapshot, snapshotConfig, snapshotVicBank, SNAPSHOT_LOAD, SNAPSHOT_ZP_LOAD, type OpenedFile, type OpenOptions, type Snapshot, type SnapshotVic, type VsfModule } from './c64/vsf';
export { snapshotVicState, vicScreen, vicState, VIC_SCREEN, type VicMode, type VicScreen, type VicSprite, type VicState } from './c64/vicscreen';
export {
  bankFiles, bootBank, cartMode, cartModeName, cartridgeSource, chipAddress, chipFromPrg, chipName, chipTypeName, compareCrt, crtBanks, crtBase, crtMode, crtOffsetText, crtOutputName, crtSourceName, crtTypeName, CRT_TYPES, projectCartMode,
  cartImageLines, cartLineText, describeCrt, isCrt, makeCrt, openCartridge, parseCrt, rebuildCrt, type CartLine, type CartSourceOptions, type ChipFile, type Crt, type CrtChip,
} from './c64/crt';
export { d64FileName, diskSectors, isDiskImage, looseChains, makeD64, parseD64, pastEndText, petsciiName, readD64File, sectorsOnTrack, writeDiskFile, type D64File, type D64FileType, type D64Image, type LooseChain } from './c64/d64';
export { nextSides } from './c64/sides';
export { C64_BACKGROUND, C64_BORDER, C64_TEXT, directoryProgram, directoryScreen, screenRowText, type DirPart, type DirScreen, type DirScreenRow } from './c64/dirlist';
export { tapeDirectory, tapeDirEntry, tapeScreen, type TapeDirEntry, type TapePart, type TapeScreen } from './c64/tapelist';
export { PIRATESLAYER_SIGNATURE, pirateSlayerFileList, pirateSlayerFileName, pirateSlayerPrg, readPirateSlayerDisk, type PirateSlayerBoot, type PirateSlayerDisk, type PirateSlayerFile, type PirateSlayerKey, type PirateSlayerVersion } from './c64/pirateslayer';
export { paraProtectFileList, paraProtectFileName, paraProtectPrg, readParaProtectDisk, type ParaProtectBoot, type ParaProtectDisk, type ParaProtectFile, type ParaProtectKind, type ParaProtectRequest, type ParaProtectStepping } from './c64/paraprotect';
export { diskSpeedFileList, diskSpeedPrg, readDiskSpeedDisk, type DiskSpeedDisk, type DiskSpeedFile, type DiskSpeedSector } from './c64/diskspeed';
export { isTap, makeTap, readTape, replaceTapeFile, tapeBoot, tapeFileName, tapeToolRle, tapeToolScript, tapPulses, TAPE_CLOCK, type TapeFile, type TapeFileType, type TapeFormat, type TapeImage, type TapeUnknown, type TapPulses } from './c64/tap';
export { isT64, makeT64, readT64, t64Info, writeT64, type T64Entry, type T64Info } from './c64/t64';
export { readSpindleDisk, spinChunkName, spinScript, type SpindleChunk, type SpindleDisk, type SpindleJob } from './c64/spindle-disk';
export { BOOZE_CRUNCHER, boozeFileList, boozeFileName, readBoozeDisk, unpackByteBoozer1, unpackByteBoozer2, type BoozeCruncher, type BoozeDisk, type BoozeFile, type BoozeUnpacked } from './c64/booze-disk';
export { readSparkleDisk, sparkleBlockOrder, sparkleChunkName, sparkleChunkPrg, sparkleCount, sparkleScript, type SparkleBundle, type SparkleChunk, type SparkleCountCode, type SparkleDisk, type SparkleItems } from './c64/sparkle-disk';
export {
  COVERT_PACKER, COVERT_RAW_AT, covertCallText, covertDiskFile, covertFileName, covertFilePrg, covertScript, covertScriptText, covertSummary, covertUnpackedName, maked64DiskName, maked64Text, readCovertDisk,
  unpackCovertExomizer, unpackCovertExomizer3Raw, unpackCovertFile, unpackCovertPucrunch,
  type CovertCall, type CovertDisk, type CovertEntry, type CovertFile, type CovertPacker, type CovertScript, type CovertTool, type CovertUnpacked,
} from './c64/covert-disk';
export { cc1541Script, cc1541Text, KRILL_EXOMIZER_PROTOCOLS, KRILL_PACKER, krillCallRegs, krillCallText, krillDiskPrg, krillFileName, krillFilePrg, krillFileTs, krillPackerName, krillTableEntries, krillUnpackedName, readKrillDisk, unpackKrillDoynax, unpackKrillExomizer, unpackKrillTinyCrunch, unpackKrillZx0, type KrillCall, type KrillDisk, type KrillEntry, type KrillFile, type KrillPacker, type KrillReg, type KrillRegs, type KrillUnpacked } from './c64/krill-disk';
export { IFFL_ENTRIES, IFFL_PACKER, IFFL_TABLE, ifflPartName, ifflPieceName, ifflPiecePrg, readIffl, readIfflDisk, unpackIfflPart, type IfflDisk, type IfflFile, type IfflPacker, type IfflPart, type IfflPiece } from './c64/iffl-disk';
export { c1541Name, DLOC_BASE, DLOC_ROUTINE, dlocCallText, dlocFileName, dlocFilePrg, dlocScript, dlocScriptText, dlocSummary, dlocUnpackedName, readDlocDisk, unpackDlocBoot, unpackDlocFile, unpackZx0, type DlocBoot, type DlocCall, type DlocDisk, type DlocEntry, type DlocFile, type DlocName, type DlocRoutine, type DlocScript, type DlocUnpacked } from './c64/dloc-disk';
export { BITFIRE_VERSION, bitfireFileName, d64writeScript, readBitfireDisk, unpackBitnax, unpackDali, type BitfireDisk, type BitfireFile, type BitfireFormat, type BitfireUnpacked } from './c64/bitfire-disk';
export { makePsid, parsePsid } from './c64/psid';
export { sidPlayer, musicPlayData, musicSidFile, type SidPlayer, type SidPlayerOptions, type MusicPlayData, type MusicPlayDigi } from './c64/sidplayer';
export {
  findPictureColors, flatColors, picture, pictureData, pictureFormatName, pictureFormatOf, pictureFromData, PICTURE_FORMATS, PICTURE_FORMATS_HIRES, PICTURE_FORMATS_MC, PICTURE_INFO, PICTURE_READS, readPicture, writePicture,
  type C64Picture, type PictureColors, type PictureColorsAt, type PictureFormat, type PictureFormatInfo,
} from './c64/pictures';
export { artStudioPicture, ART_STUDIO_LOAD, BITMAP_SIZE, gfxSource, koalaPicture, KOALA_LOAD, SCREEN_SIZE, type GfxFileColors, type GfxFileKind } from './c64/gfxfiles';
export { findPetsciiAnims, type PetsciiAnim, type PetsciiFrame, type PetsciiPlayer, type PetsciiSequence } from './c64/petscii-anim';
export { findStorePlayers, readStoreStream, spindleStoreAnims, storePagesText, storePlayerAt, storeStreamStarts, type SpindleStoreAnim, type StoreAnim, type StorePlayer } from './c64/store-anim';
export type { PsidInfo } from './c64/psid';

export { findBlock } from './analyze';
export { goneCounts, isFault, isProblem } from './analyze/deep';
// a cartridge's banks analysed, rendered and verified as spaces of their own (13.9b); one space goes to the engine as it is
export { exportGroup, joinSources, type GroupExport } from './group-export';
export { analyze, bankAddr, fileSpaces, type SpaceCache, render, SPACE, spaceAddr, spaceFiles, spaceLines, spaceOf, spaceRender, spaceView, splitProject, verify } from './spaces';
export { spindleCondition, spindleLabel, spindleName, spindleRoutines, spindleScript } from './analyze/spindle';
export { boozeLine, boozeScript } from './analyze/booze';
export { krillLoads, krillScriptText, type KrillLoad } from './analyze/krill';
export { validLabel, type RenderOptions } from './render/kick';
export { applyZpPairs, zpPairable } from './zp-pairs';
export { addJunk, junkAt, junkIn, junkPlan, removeJunk, type JunkPlan } from './junk';
export { refsShown, removeViewOffset, setViewOffset, shiftText, shownAddress, shownLabelName, shownTarget, usableViewOffsets, viewOffsetAt, viewOffsetFit, viewOffsetProblem } from './viewoffsets';
export { lineText, kickMnemonic, lineMnemonic, TOP_LEVEL_DIRECTIVES } from './render/lines';
export type { LineTextSettings } from './render/lines';
export { hardwareInclude } from './render/include';
// the assemblers the source can be written for (spec 11.8)
export { ASSEMBLERS, asmMnemonic, assemblerOf, forcedMnemonic, guessAssembler, isLabelDefinition, isTass, labelFor, TASS_FIXED_ARGS, type AssemblerInfo } from './render/dialect';

export { assemble, importPath, type AssembleOptions } from './verify/kick-subset-assembler';
export { assembleTass } from './verify/tass-subset-assembler';
export { TASS_ALL_MNEMONICS, TASS_CPU_MNEMONICS, tassCpu, type TassCpu } from './verify/tass-cpu';
export { comparePrg } from './verify/verify';
export { parseKickOutput } from './verify/kick-output';
export { parseTassOutput } from './verify/tass-output';

export { DEMO_FONT, makeDemo } from './demo';
export type { DemoProgram } from './demo';
export { makeShowcase, showcaseProject, type ShowcaseProgram } from './showcase';
// bytes the program copies elsewhere to run there (8.1b)
export { addReloc, codeWhereLoaded, fileBytesIn, loadAddress, loadRange, moveKeys, moveReloc, relocAt, relocLoadedAt, relocProblem, removeReloc, type RelocKeys } from './relocs';
export { FORMATTABLE, formatOverride, gfxToData, keepCutTypes, lineMove, markIdOf, markOverride, mergeOverride, mergeRange, moveBlockKeys, moveBytes, moveFrom, resizeBlock, splitBlock, type BlockMerge, type BlockResize, type BlockSplit, type ByteMove, type GfxUnmark, type MarkMerge, type RangeMerge } from './edit';
export { createProject, demoProject, serializeProject, deserializeProject, projectNameFor, withId, newId, b64enc, b64dec } from './project';
export { buildScripts, BUILD_SCRIPTS, builtCartridge, cartBuild, cartridgeFiles, expectedCartridge, readme, projectScripts, projectTextFiles, templateScripts, exportFiles, type CartBuild } from './export';
export {
  BUILT_IN_TEMPLATES, builtInTemplate, fillTemplate, newTemplateName, originalTemplate, placeholdersIn, readTemplate, readTemplateLibrary, renderTemplate,
  scriptEol, sfxEntry, TEMPLATE_PLACEHOLDERS, templateText, templateValues, type BuildTarget, type TemplateValues,
} from './build-template';
export { SCRIPT_TEMPLATES, templateSource, type ScriptTemplate } from './script-templates';
export { JS_TEMPLATES } from './script-templates-js';
export { asmOfLang, assembleIn, codeLabels, codeLines, codeOfLine, commentAt, definedNames, LANG_TITLE, langIs, langOf, LANGS, lineComment, needsTassCpu, setsItsPlace, splitLabel, startsInBlockComment, usedWords, withoutComment } from './code-lang';
export { asmDebugSources, asmMachineMemory } from './asm-project';
export { ASM_SOURCE, ASM_TEXT, asmAddrOf, asmArgCpu, asmArgDefines, asmArgLibdirs, asmCallSite, asmDropPath, asmEndText, asmTemplate, asmLineAt, asmMachine, asmProgram, checkAsm, dataFiles, importsOf, mainFile, sourceLang, type AsmCheck, type AsmProblem, type AsmProgram } from './asm-project';
export { asmWriteBytes, type AsmByteChange, type AsmWriteBack } from './asm-write';
export { asmCode, asmLineCycles, asmLinesRange } from './asm-cycles';
export { asmNameRefs, asmNames, asmRenameProblem, type AsmNameAt } from './asm-names';
export { asmC64Notes, type AsmC64Note } from './asm-c64check';
export { ASM_BLOCK_INFO, ASM_BLOCK_KINDS, ASM_MARK_WORDS, asmBlockBytes, asmBlockMarks, asmBlockText, asmLabel, asmMarkAt, assemblerSources, libraryLabel, type AssemblerSources, type AsmBlockInfo, type AsmBlockKind, type AsmBlockMark, type AsmBlockRequest, type AsmBlockText } from './asm-blocks';
export { releaseImage, releaseStarts, type ReleaseKind } from './asm-release';
export { AsmC64, asmC64Text, c64Held, c64Key, C64_KEYS, FRAME_CYCLES, LINE_CYCLES, PAL_CLOCK, PAL_LINES, type AsmC64Options, type C64Key } from './asm-c64';
export { kickToTass, type Converted } from './code-convert';
export { patchIn64tass, scriptIn64tass, type Moved } from './script-convert';
export { padStoreAt, padStoreLine, padStoreReach, type PadStore, type PadStoreFind } from './script-padstore';
export { callScript, cryptScript, cryptStepsText, cryptWhereText, findCryptLoops, type CallScript, type CryptLoop, type CryptScript, type CryptStep } from './script-suggest';
export { runScriptInC64, SCRIPT_C64_CYCLES, type ScriptC64 } from './script-machine';
export { MARK_NAMES, planScriptActions, scriptActions, scriptDirectives, type ActionsPlan, type ScriptAction, type ScriptDirective } from './script-actions';
export { JS_CALL_LIMIT, JS_RUN_LIMIT, runJs, type JsExtras } from './script-js';
export { SINDRI_BUDGET, SINDRI_RUN_CYCLES, sindriApi, type SindriContext } from './script-sindri';
export { BROKKR_FORMATS, brokkrApi, type BrokkrContext } from './script-brokkr';
export { loaderApi, type ScriptLoaderData } from './script-loader';
export { blocksApi, scriptBlocksData, type ScriptBlock, type ScriptBlocksData } from './script-blocks';
export { decodeText, encodeText, fieldSize, fieldTypeText, readStruct, STRUCT_FIELDS, STRUCT_SIZE, STRUCT_TYPES, structFields, structSize, structText, validStruct } from './struct';
export { snapshotApi, snapshotRequestText, type ScriptSnapshotData, type ScriptSnapshotRequest } from './script-snapshot';
export { planScriptsRequests, scriptsApi, scriptsRequestText, SCRIPTS_CALL_DEPTH, SCRIPTS_REQUESTS, SCRIPTS_RUN_CHAIN, type ScriptInfo, type ScriptScriptsData, type ScriptScriptsRequest, type ScriptsPlan } from './script-scripts';
export { diskRequestText, disksApi, type ScriptDiskRequest, type ScriptDisksData } from './script-disks';
export { tapeRequestText, tapesApi, type ScriptTapeRequest, type ScriptTapesData } from './script-tapes';
export { cartridgeRequestText, cartridgesApi, CRT_STRUCTS, type ScriptCartridgeRequest, type ScriptCartridgesData } from './script-cartridges';
export { CBM80, CrtEdit, programCartridge, CRT_CHIP_MAX, CRT_IMAGE_MAX, type CrtEditChip, type ProgramCartridge } from './c64/crtedit';
export { CRT_LAYOUTS, crtLayout, crtLayoutName, type CrtLayout, type CrtLayoutChip } from './c64/crt-layouts';
export { LIBRARY_REQUESTS, libraryApi, libraryRequestText, type ScriptLibraryData, type ScriptLibraryRequest } from './script-library';
export { SID_REQUESTS, SID_RUN_DEFAULT, SID_RUN_FRAMES, sidApi, sidRequestText, type ScriptSidData, type ScriptSidRequest, type ScriptSidTune } from './script-sid';
export { BUILD_REQUESTS, buildApi, buildRequestText, type ScriptBuildData, type ScriptBuildRequest } from './script-build';
export { applyExportRequest, exportApi, exportFileName, exportRequestText, type ScriptExportData, type ScriptExportRequest } from './script-export';
export { C64_COLOR_NAMES, c64Color, SCREEN_C64, SCREEN_MAX, SCREEN_ROUTINES, SCREEN_RAM, COLOR_RAM, BORDER_AT, BACKGROUND_AT, screenApi, screenMemory, screenRanges, startScreenMemory, screenRoutine, screenSize, screenTraps, textPetscii, TextScreen, vicMatrix, c64TextScreen, type ScreenContext, type ScreenMemory, type ScreenSize, type ScriptScreen } from './script-screen';
export { paramValueOk, parseParamTable, runResults, scriptParams, setScriptParams, startParamTable, type ParamTable, type ScriptParam } from './script-params';
export { isScriptFileName, readScriptFile, SCRIPT_FILE_MAX, SCRIPT_FOLDER, scriptFileName, scriptFileText, scriptFits, type StoredScript } from './script-file';
export { loadScripts, runChangeText, SCRIPT_KEYS, withRunChanges } from './script-hooks';
export { FILE_PAD_MAX, filePad, fileResultText, fileRunPlan, fileRunResults, padWithFile, type FileRunPlan, type ScriptFile, type ScriptFileResult } from './script-files';
export { scriptWatches, userWatches, watchByte, watchEntryKey, watchSpace, watchView, type WatchRow, type WatchSpace, type WatchSpot, type WatchView } from './script-watch';
export { BLOCK_PAD_FORM, blockEndNames, blockPad, type BlockPad, byteLines, checkScript, endedWell, runChanges, scriptStopAt, disassembleBytes, freePlace, initEmpty, withAddressNames, padData, padDiff, padNow, padStart, padText, type PadDataError, type PadDiff, SCRIPT_FLAGS, SCRIPT_P, tidyInit, linkName, loadedMask, maskRanges, type MusicField, musicNames, newScript, padName, scriptPlace, ScriptMachine, scriptStartMemory, type ScriptMemory, type StackEntry, rangeText, runScript, SCRIPT_LIMIT, scriptEndText, scriptEnv, scriptName, scriptNames, scriptPatches, withoutScriptPatches, writeScriptRun, type PadInstruction, type ScriptChange, type ScriptCheck, type ScriptEnd, type ScriptEnv, type ScriptLink, type ScriptProblem, type ScriptRange, type ScriptRun, type ScriptWriteFailure } from './script';
export { applyPatch, assemblePatch, programNames, patchAt, patchLang, patchEnd, patchesOn, patchFileName, patchPrg, patchSource, planPatch, projectUnpatched, revertPatch, straightCycles, switchPatch, unpatchedFiles, withPatch, withoutPatch, type PatchCode, type PatchError, type PatchLine, type PatchPlan, type PatchRequest, type PatchTime } from './patch';
export { NOTES_FILE, NOTES_TEXT_FILE, notesDocument, notesExport, notesFile, notesFor, notesText, lineHtml } from './notes-doc';
export { detectPacking, packerSignature, type PackingInfo } from './packing';
export { conclusive, depackers, depackerText, ioSummary, notPacked, packedData, packerNames, unpackedName, unpackLog, unpackPrg, unpackSummary, type LayerReport, type Roms, type UnpackDiskBoot, type UnpackRun, type UnpackTape } from './sindri';
export { driveCode, driveSymbol, runAddress, type DriveCode, type DriveCheck, type DriveSegment } from './drivecode';
export { addDecisionChecks, addRunChecks, checkDecisions, checkRun, type DecisionCheck, type RunCheck } from './runcheck';
export { brokkrArgs, brokkrCommands, brokkrCommandText, brokkrPlan, crunchHere, NO_ROOM, packDecruncher, packNeeds, packWithBrokkr, type BrokkrCrunch, type BrokkrPack, type BrokkrPlan, type PackedFile, type PackTried } from './brokkr';
export {
  checkDecrunched, DEFAULT_PACK, editRanges, extraProblem, keepText, MEMORY_PLACES, mergeRanges, nothingPacked, placeSpan, ZP_PLACES, type PackPlace, packArgs, packEffective, packFileName, packImage, packInputs, packOptions, packOutName, packParts, packProblem, parseKeep,
  parseExomizer, rangeCover, shellWord, type ExomizerArea, type ExomizerReport, type PackCheck, type PackFile, type PackPart,
} from './pack';
export { splitArgs } from './util/args';
export { safeStem, sourceStem } from './util/names';
export { fileOffsetBases, offsetText } from './offsets';
export { charsetFile, fileStem, isLibraryFileName, LIBRARY_EXT, libraryExt, LIBRARY_FOLDERS, LIBRARY_INDEX, LIBRARY_KINDS, LIBRARY_MAX_BYTES, LIBRARY_READS, libraryHash, libraryIndexJson, libraryItems, libraryRange, librarySourceText, libraryStem, readLibraryFile, readLibraryIndex, safeFileName, sidWithTexts, spriteFile, uniqueLibraryName, type LibraryColors, type LibraryDigi, type LibraryEntry, type LibraryFile, type LibraryItem, type LibraryKind, type LibrarySource } from './library';
export { knownRoutines, learnable, learnProject, learnRoutine, readRoutineLibrary, ROUTINE_MAX, ROUTINE_MIN, routineAt, routineSuggestions, sameRoutine, startsRoutine, type KnownRoutine, type Routine, type RoutineMatch } from './routines';
export { DiskEdit, diskKindOf, diskName, type DiskEntry, type DiskFileType, type DiskKind } from './c64/diskedit';
