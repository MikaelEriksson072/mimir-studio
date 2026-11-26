/**
 * The processors 64tass assembles for (`.cpu`, spec 10.7), as Mimir's own check knows them: the 6502 (and the NMOS
 * 6510's undocumented opcodes, "6502i"), the CMOS 65C02, the R65C02 and W65C02 with Rockwell's bit instructions, and
 * the W65C816 of the SuperCPU. Each is a table of 64tass's mnemonic → addressing mode → opcode, with 64tass's
 * aliases; measured against 64tass 1.57.
 */
import { OPC, TASS_ENC, type AddrMode } from '../cpu/opcodes';

/** the processors the check knows (`.cpu` names) */
export type TassCpu = '6502' | '6502i' | '65c02' | 'r65c02' | 'w65c02' | '65816';
export const TASS_CPUS: readonly TassCpu[] = ['6502', '6502i', '65c02', 'r65c02', 'w65c02', '65816'];

/**
 * An addressing mode as 64tass writes it: `dp` direct (zero) page, `abs` absolute, `long` 24 bit (65816), `dpi` (dp),
 * `dpix` (dp,x), `dpiy` (dp),y, `dpil` [dp], `dpily` [dp],y, `sr` stack relative (n,s), `sriy` (n,s),y, `absi` (abs),
 * `absix` (abs,x), `absil` [abs], `rell` a 16 bit branch, `move` mvn/mvp's two banks, `bit` rmb/smb's bit and dp,
 * `bitrel` bbr/bbs's bit, dp and branch.
 */
export type CpuMode = 'imp' | 'acc' | 'imm' | 'dp' | 'dpx' | 'dpy' | 'abs' | 'abx' | 'aby' | 'long' | 'longx'
  | 'dpi' | 'dpix' | 'dpiy' | 'dpil' | 'dpily' | 'sr' | 'sriy' | 'rel' | 'rell' | 'absi' | 'absix' | 'absil' | 'move' | 'bit' | 'bitrel';
export type CpuTable = Record<string, Partial<Record<CpuMode, number>>>;

/** the bytes after the opcode each mode has (an immediate's are the instruction's: imm8 or imm16) */
export const CPU_MODE_LEN: Record<CpuMode, number> = {
  imp: 0, acc: 0, imm: 1, dp: 1, dpx: 1, dpy: 1, abs: 2, abx: 2, aby: 2, long: 3, longx: 3, dpi: 1, dpix: 1, dpiy: 1, dpil: 1, dpily: 1,
  sr: 1, sriy: 1, rel: 1, rell: 2, absi: 2, absix: 2, absil: 2, move: 2, bit: 1, bitrel: 2,
};

/** the 6502's modes by Mimir's names (opcodes.ts) */
const FROM_6502: Record<AddrMode, CpuMode> = { imp: 'imp', acc: 'acc', imm: 'imm', zp: 'dp', zpx: 'dpx', zpy: 'dpy', izx: 'dpix', izy: 'dpiy', rel: 'rel', abs: 'abs', abx: 'abx', aby: 'aby', ind: 'absi' };

/** the W65C816's 256 opcodes, a row for each high nibble, as 64tass names them */
const W65816_SRC = [
  'BRK imp,ORA dpix,COP imm,ORA sr,TSB dp,ORA dp,ASL dp,ORA dpil,PHP imp,ORA imm,ASL acc,PHD imp,TSB abs,ORA abs,ASL abs,ORA long',
  'BPL rel,ORA dpiy,ORA dpi,ORA sriy,TRB dp,ORA dpx,ASL dpx,ORA dpily,CLC imp,ORA aby,INC acc,TCS imp,TRB abs,ORA abx,ASL abx,ORA longx',
  'JSR abs,AND dpix,JSL long,AND sr,BIT dp,AND dp,ROL dp,AND dpil,PLP imp,AND imm,ROL acc,PLD imp,BIT abs,AND abs,ROL abs,AND long',
  'BMI rel,AND dpiy,AND dpi,AND sriy,BIT dpx,AND dpx,ROL dpx,AND dpily,SEC imp,AND aby,DEC acc,TSC imp,BIT abx,AND abx,ROL abx,AND longx',
  'RTI imp,EOR dpix,WDM imm,EOR sr,MVP move,EOR dp,LSR dp,EOR dpil,PHA imp,EOR imm,LSR acc,PHK imp,JMP abs,EOR abs,LSR abs,EOR long',
  'BVC rel,EOR dpiy,EOR dpi,EOR sriy,MVN move,EOR dpx,LSR dpx,EOR dpily,CLI imp,EOR aby,PHY imp,TCD imp,JML long,EOR abx,LSR abx,EOR longx',
  'RTS imp,ADC dpix,PER rell,ADC sr,STZ dp,ADC dp,ROR dp,ADC dpil,PLA imp,ADC imm,ROR acc,RTL imp,JMP absi,ADC abs,ROR abs,ADC long',
  'BVS rel,ADC dpiy,ADC dpi,ADC sriy,STZ dpx,ADC dpx,ROR dpx,ADC dpily,SEI imp,ADC aby,PLY imp,TDC imp,JMP absix,ADC abx,ROR abx,ADC longx',
  'BRA rel,STA dpix,BRL rell,STA sr,STY dp,STA dp,STX dp,STA dpil,DEY imp,BIT imm,TXA imp,PHB imp,STY abs,STA abs,STX abs,STA long',
  'BCC rel,STA dpiy,STA dpi,STA sriy,STY dpx,STA dpx,STX dpy,STA dpily,TYA imp,STA aby,TXS imp,TXY imp,STZ abs,STA abx,STZ abx,STA longx',
  'LDY imm,LDA dpix,LDX imm,LDA sr,LDY dp,LDA dp,LDX dp,LDA dpil,TAY imp,LDA imm,TAX imp,PLB imp,LDY abs,LDA abs,LDX abs,LDA long',
  'BCS rel,LDA dpiy,LDA dpi,LDA sriy,LDY dpx,LDA dpx,LDX dpy,LDA dpily,CLV imp,LDA aby,TSX imp,TYX imp,LDY abx,LDA abx,LDX aby,LDA longx',
  'CPY imm,CMP dpix,REP imm,CMP sr,CPY dp,CMP dp,DEC dp,CMP dpil,INY imp,CMP imm,DEX imp,WAI imp,CPY abs,CMP abs,DEC abs,CMP long',
  'BNE rel,CMP dpiy,CMP dpi,CMP sriy,PEI dpi,CMP dpx,DEC dpx,CMP dpily,CLD imp,CMP aby,PHX imp,STP imp,JMP absil,CMP abx,DEC abx,CMP longx',
  'CPX imm,SBC dpix,SEP imm,SBC sr,CPX dp,SBC dp,INC dp,SBC dpil,INX imp,SBC imm,NOP imp,XBA imp,CPX abs,SBC abs,INC abs,SBC long',
  'BEQ rel,SBC dpiy,SBC dpi,SBC sriy,PEA imm,SBC dpx,INC dpx,SBC dpily,SED imp,SBC aby,PLX imp,XCE imp,JSR absix,SBC abx,INC abx,SBC longx',
];
const W65816: CpuTable = {};
W65816_SRC.join(',').split(',').forEach((e, op) => { const [mn, mode] = e.split(' ') as [string, CpuMode]; (W65816[mn] ??= {})[mode] = op; });
// (JML [abs] is JMP [abs] too)
W65816.JML.absil = 0xdc;

/** what the 65C02 adds to the 6502: (dp) for the eight, BIT's new modes, BRA, the push and pull of X and Y, STZ, TRB,
 *  TSB, INC and DEC of A, JMP (abs,x) — each with the 65816's opcode */
const ADD_65C02: [string, CpuMode][] = [
  ...['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC'].map((mn): [string, CpuMode] => [mn, 'dpi']),
  ['BIT', 'imm'], ['BIT', 'dpx'], ['BIT', 'abx'], ['BRA', 'rel'], ['PHX', 'imp'], ['PHY', 'imp'], ['PLX', 'imp'], ['PLY', 'imp'],
  ['STZ', 'dp'], ['STZ', 'dpx'], ['STZ', 'abs'], ['STZ', 'abx'], ['TRB', 'dp'], ['TRB', 'abs'], ['TSB', 'dp'], ['TSB', 'abs'],
  ['INC', 'acc'], ['DEC', 'acc'], ['JMP', 'absix'],
];

const copy = (t: CpuTable): CpuTable => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v }]));
const T6502: CpuTable = {}, T6502I: CpuTable = {};
for (const o of OPC) if (!o.ill && (o.mn !== 'NOP' || o.op === 0xea)) (T6502[o.mn] ??= {})[FROM_6502[o.mode]] ??= o.op;
for (const [mn, modes] of Object.entries(TASS_ENC)) for (const [m, op] of Object.entries(modes ?? {})) (T6502I[mn] ??= {})[FROM_6502[m as AddrMode]] ??= op;
const T65C02 = copy(T6502);
for (const [mn, mode] of ADD_65C02) (T65C02[mn] ??= {})[mode] = W65816[mn][mode];
const TR65C02 = copy(T65C02);
TR65C02.RMB = { bit: 0x07 }; TR65C02.SMB = { bit: 0x87 }; TR65C02.BBR = { bitrel: 0x0f }; TR65C02.BBS = { bitrel: 0x8f };
Object.assign(TR65C02.NOP, { dp: 0x44, dpx: 0x54, imm: 0x82, abs: 0xdc });
const TW65C02 = copy(TR65C02);
TW65C02.WAI = { imp: 0xcb }; TW65C02.STP = { imp: 0xdb };
// (BRK takes a signature byte on every one: brk #$12)
for (const t of [T6502, T6502I, T65C02, TR65C02, TW65C02, W65816]) t.BRK.imm = 0x00;

/** 64tass's aliases, each processor's own and those they all have */
const ALIASES: Record<string, Record<string, string>> = {
  all: { BGE: 'BCS', BLT: 'BCC', CPA: 'CMP', SHL: 'ASL', SHR: 'LSR' },
  '65c02': { INA: 'INC', DEA: 'DEC', CLR: 'STZ' },
  w65c02: { HLT: 'STP' },
  '65816': { CLP: 'REP', CSP: 'COP', HLT: 'STP', SWA: 'XBA', TAD: 'TCD', TAS: 'TCS', TDA: 'TDC', TSA: 'TSC' },
};
const TABLES: Record<TassCpu, CpuTable> = { '6502': T6502, '6502i': T6502I, '65c02': T65C02, r65c02: TR65C02, w65c02: TW65C02, '65816': W65816 };
const ALIASES_OF: Record<TassCpu, Record<string, string>> = {
  '6502': ALIASES.all, '6502i': ALIASES.all, '65c02': { ...ALIASES.all, ...ALIASES['65c02'] }, r65c02: { ...ALIASES.all, ...ALIASES['65c02'] },
  w65c02: { ...ALIASES.all, ...ALIASES['65c02'], ...ALIASES.w65c02 }, '65816': { ...ALIASES.all, ...ALIASES['65c02'], ...ALIASES['65816'] },
};

/** a mnemonic's modes on a processor (`mn` in upper case; an alias gives its instruction's), and its own name */
export function cpuOp(cpu: TassCpu, mn: string): { mn: string; modes: Partial<Record<CpuMode, number>> } | null {
  const own = TABLES[cpu][mn];
  if (own) return { mn, modes: own };
  const to = ALIASES_OF[cpu][mn];
  return to && TABLES[cpu][to] ? { mn: to, modes: TABLES[cpu][to] } : null;
}

/** every mnemonic the processors other than the 6502 have, with the aliases (lower case): the editor colours them */
export const TASS_CPU_MNEMONICS: readonly string[] = [...new Set([
  ...(['65c02', 'r65c02', 'w65c02', '65816'] as const).flatMap(c => Object.keys(TABLES[c])),
  ...Object.values(ALIASES).flatMap(a => Object.keys(a)),
].map(m => m.toLowerCase()))].sort();

/** the instructions whose immediate is the accumulator's size (.al: 16 bits) and the index registers' (.xl) */
export const ACCU_IMM = new Set(['ORA', 'AND', 'EOR', 'ADC', 'BIT', 'LDA', 'CMP', 'SBC']);
export const INDEX_IMM = new Set(['LDX', 'LDY', 'CPX', 'CPY']);
/** the branches (8 bit relative) */
export const CPU_BRANCH = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ', 'BRA']);

/** the processor a `.cpu` name or a command line option is (null: one the check does not know) */
export function tassCpu(name: string): TassCpu | null {
  const n = name.toLowerCase();
  return (TASS_CPUS as readonly string[]).includes(n) ? (n as TassCpu) : null;
}
/** 64tass's command line options for a processor (`--m65816`, `-x` …) */
export const CPU_OPTIONS: Record<string, TassCpu | string> = {
  '--m65xx': '6502', '-i': '6502i', '--m6502': '6502i', '-c': '65c02', '--m65c02': '65c02', '--mr65c02': 'r65c02', '--mw65c02': 'w65c02',
  '-x': '65816', '--m65816': '65816', '--m65ce02': '65ce02', '-t': '65dtv02', '--m65dtv02': '65dtv02', '-e': '65el02', '--m65el02': '65el02', '--m4510': '4510',
};
