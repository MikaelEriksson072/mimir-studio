/**
 * The processors 64tass assembles for (`.cpu`, spec 10.7), as Mimir's own check knows them: the 6502 (and the NMOS
 * 6510's undocumented opcodes, "6502i"), the CMOS 65C02, the R65C02 and W65C02 with Rockwell's bit instructions, the
 * W65C816 of the SuperCPU, the C64 DTV's 65DTV02, the CSG 65CE02 and the C65's 4510 (the Z register, 16 bit branches)
 * and the 65EL02. Each is a table of 64tass's mnemonic → addressing mode → opcode, with 64tass's aliases: measured by
 * assembling every mnemonic in every addressing mode with 64tass 1.57 (what each adds to the one it is made from is
 * that measurement's difference).
 */
import { OPC, TASS_ENC, type AddrMode } from '../cpu/opcodes';

/** the processors the check knows (`.cpu` names) */
export type TassCpu = '6502' | '6502i' | '65c02' | 'r65c02' | 'w65c02' | '65816' | '65dtv02' | '65ce02' | '4510' | '65el02';
export const TASS_CPUS: readonly TassCpu[] = ['6502', '6502i', '65c02', 'r65c02', 'w65c02', '65816', '65dtv02', '65ce02', '4510', '65el02'];

/**
 * An addressing mode as 64tass writes it: `dp` direct (zero) page, `abs` absolute, `long` 24 bit (65816), `dpi` (dp),
 * `dpix` (dp,x), `dpiy` (dp),y, `dpil` [dp], `dpily` [dp],y, `sr` stack relative (n,s), `sriy` (n,s),y, `absi` (abs),
 * `absix` (abs,x), `absil` [abs], `rell` a 16 bit branch, `move` mvn/mvp's two banks, `bit` rmb/smb's bit and dp,
 * `bitrel` bbr/bbs's bit, dp and branch; the 65CE02's `dpiz` (dp),z, the 65EL02's `rr` (n,r) and `rriy` (n,r),y.
 */
export type CpuMode = 'imp' | 'acc' | 'imm' | 'dp' | 'dpx' | 'dpy' | 'abs' | 'abx' | 'aby' | 'long' | 'longx'
  | 'dpi' | 'dpix' | 'dpiy' | 'dpiz' | 'dpil' | 'dpily' | 'sr' | 'sriy' | 'rr' | 'rriy' | 'rel' | 'rell' | 'absi' | 'absix' | 'absil' | 'move' | 'bit' | 'bitrel';
export type CpuTable = Record<string, Partial<Record<CpuMode, number>>>;

/** the bytes after the opcode each mode has (an immediate's are the instruction's: imm8 or imm16) */
export const CPU_MODE_LEN: Record<CpuMode, number> = {
  imp: 0, acc: 0, imm: 1, dp: 1, dpx: 1, dpy: 1, abs: 2, abx: 2, aby: 2, long: 3, longx: 3, dpi: 1, dpix: 1, dpiy: 1, dpiz: 1, dpil: 1, dpily: 1,
  sr: 1, sriy: 1, rr: 1, rriy: 1, rel: 1, rell: 2, absi: 2, absix: 2, absil: 2, move: 2, bit: 1, bitrel: 2,
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
// (BRK takes a signature byte on every one: brk #$12; the 65816's COP may be written alone, PEI without its brackets)
for (const t of [T6502, T6502I, T65C02, TR65C02, TW65C02, W65816]) t.BRK.imm = 0x00;
W65816.COP.imp = 0x02; W65816.PEI.dp = 0xd4;

/** a table made from another: its modes taken away ("MN mode", …) and added ("MN mode op", the opcode in hex) */
function derive(from: CpuTable, remove: string, add: string): CpuTable {
  const t = copy(from);
  for (const e of remove.split(',').map(x => x.trim()).filter(Boolean)) { const [mn, mode] = e.split(' '); if (t[mn]) { delete t[mn][mode as CpuMode]; if (!Object.keys(t[mn]).length) delete t[mn]; } }
  for (const e of add.split(',').map(x => x.trim()).filter(Boolean)) { const [mn, mode, op] = e.split(' '); (t[mn] ??= {})[mode as CpuMode] = parseInt(op, 16); }
  return t;
}
/** the 65DTV02 (the C64 DTV): the 6502 with most of its undocumented opcodes, BRA, SAC and SIR */
const TDTV = derive(T6502I, 'NOP imm, NOP dp, NOP abs, NOP dpx, NOP abx, ANC imm, JAM imp, LDS aby, SBX imm, SHA aby, SHA dpiy, SHS aby, SHX aby, SHY abx',
  'BRA rel 12, SAC imm 32, SIR imm 42');
/** the 65CE02: the R65C02 with the Z register ((dp),z instead of (dp)), 16 bit branches and words */
const T65CE02 = derive(TR65C02, 'ADC dpi, AND dpi, CMP dpi, EOR dpi, LDA dpi, ORA dpi, SBC dpi, STA dpi, NOP imm, NOP dp, NOP abs, NOP dpx',
  'ADC dpiz 72, AND dpiz 32, ASR acc 43, ASR dp 44, ASR dpx 54, ASW abs cb, BCC rell 93, BCS rell b3, BEQ rell f3, BMI rell 33, BNE rell d3, BPL rell 13, '
  + 'BRA rell 83, BSR rell 63, BVC rell 53, BVS rell 73, CLE imp 02, CMP dpiz d2, CPZ imm c2, CPZ dp d4, CPZ abs dc, DEW dp c3, DEZ imp 3b, EOR dpiz 52, '
  + 'INW dp e3, INZ imp 1b, JSR absi 22, JSR absix 23, LDA dpiz b2, LDA sriy e2, LDZ imm a3, LDZ abs ab, LDZ abx bb, NEG acc 42, ORA dpiz 12, PHW imm f4, '
  + 'PHW abs fc, PHZ imp db, PLZ imp fb, ROW abs eb, RTS imm 62, SBC dpiz f2, SEE imp 03, STA dpiz 92, STA sriy 82, STX aby 9b, STY abx 8b, TAB imp 5b, '
  + 'TAZ imp 4b, TBA imp 7b, TSY imp 0b, TYS imp 2b, TZA imp 6b');
/** the 4510 (the C65's, the MEGA65's start): the 65CE02 with MAP */
const T4510 = derive(T65CE02, '', 'MAP imp 5c');
/** the 65EL02: the 65C02 with the 65816's stack instructions, a return stack (n,r), MUL, DIV and more */
const TEL02 = derive(T65C02, '',
  'ADC sr 63, ADC sriy 73, ADC rr 67, ADC rriy 77, AND sr 23, AND sriy 33, AND rr 27, AND rriy 37, CMP sr c3, CMP sriy d3, CMP rr c7, CMP rriy d7, '
  + 'DIV dp 4f, DIV abs 6f, DIV dpx 5f, DIV abx 7f, ENT imp 22, EOR sr 43, EOR sriy 53, EOR rr 47, EOR rriy 57, JSR absix fc, LDA sr a3, LDA sriy b3, '
  + 'LDA rr a7, LDA rriy b7, MMU imm ef, MUL dp 0f, MUL abs 2f, MUL dpx 1f, MUL abx 3f, NXA imp 42, NXT imp 02, ORA sr 03, ORA sriy 13, ORA rr 07, '
  + 'ORA rriy 17, PEA imm f4, PEI dp d4, PEI dpi d4, PER rell 62, PHD imp df, PLD imp cf, REA imm 44, REA abs 44, REI dp 54, REI dpi 54, REP imm c2, '
  + 'RER rel 82, RHA imp 4b, RHI imp 0b, RHX imp 1b, RHY imp 5b, RLA imp 6b, RLI imp 2b, RLX imp 3b, RLY imp 7b, SBC sr e3, SBC sriy f3, SBC rr e7, '
  + 'SBC rriy f7, SEA imp 9f, SEP imm e2, STA sr 83, STA sriy 93, STA rr 87, STA rriy 97, STP imp db, SWA imp eb, TAD imp bf, TDA imp af, TIX imp dc, '
  + 'TRX imp ab, TXI imp 5c, TXR imp 8b, TXY imp 9b, TYX imp bb, WAI imp cb, XBA imp eb, XCE imp fb, ZEA imp 8f');

/** 64tass's aliases, each processor's own and those they all have: an instruction, one of its modes (`LAX:imm`), or
 *  that mode as another (`INC:acc>imp`: `ina`, but not `ina a`) */
const ALIASES: Record<string, Record<string, string>> = {
  all: { BGE: 'BCS', BLT: 'BCC', CPA: 'CMP', SHL: 'ASL', SHR: 'LSR' },
  /** the undocumented opcodes' other names */
  ill: { AHX: 'SHA', ALR: 'ASR', AXS: 'SBX', DCM: 'DCP', INS: 'ISB', ISC: 'ISB', LAE: 'LDS', LAS: 'LDS', LXA: 'LAX:imm', TAS: 'SHS', XAA: 'ANE' },
  '65c02': { INA: 'INC:acc>imp', DEA: 'DEC:acc>imp', CLR: 'STZ' },
  w65c02: { HLT: 'STP' },
  '65816': { CLP: 'REP', CSP: 'COP', HLT: 'STP', SWA: 'XBA', TAD: 'TCD', TAS: 'TCS', TDA: 'TDC', TSA: 'TSC' },
  '65ce02': { RTN: 'RTS:imm' },
  '4510': { EOM: 'NOP:imp' },
  '65el02': { CLP: 'REP', HLT: 'STP' },
};
const TABLES: Record<TassCpu, CpuTable> = { '6502': T6502, '6502i': T6502I, '65c02': T65C02, r65c02: TR65C02, w65c02: TW65C02, '65816': W65816, '65dtv02': TDTV, '65ce02': T65CE02, '4510': T4510, '65el02': TEL02 };
const { CLR: _clr, ...CE02_65C02 } = ALIASES['65c02'];
const ALIASES_OF: Record<TassCpu, Record<string, string>> = {
  '6502': ALIASES.all, '6502i': { ...ALIASES.all, ...ALIASES.ill }, '65c02': { ...ALIASES.all, ...ALIASES['65c02'] }, r65c02: { ...ALIASES.all, ...ALIASES['65c02'] },
  w65c02: { ...ALIASES.all, ...ALIASES['65c02'], ...ALIASES.w65c02 }, '65816': { ...ALIASES.all, ...ALIASES['65c02'], ...ALIASES['65816'] },
  // (the DTV has not the aliases of the opcodes it has not; the 65CE02 not CLR, as STZ is no store of zero there)
  '65dtv02': { ...ALIASES.all, DCM: 'DCP', INS: 'ISB', ISC: 'ISB', ALR: 'ASR', LXA: 'LAX:imm', XAA: 'ANE' },
  '65ce02': { ...ALIASES.all, ...CE02_65C02, ...ALIASES['65ce02'] }, '4510': { ...ALIASES.all, ...CE02_65C02, ...ALIASES['65ce02'], ...ALIASES['4510'] },
  '65el02': { ...ALIASES.all, ...ALIASES['65c02'], ...ALIASES['65el02'] },
};

/** a mnemonic's modes on a processor (`mn` in upper case; an alias gives its instruction's, or the one mode it is of
 *  it), and its own name */
export function cpuOp(cpu: TassCpu, mn: string): { mn: string; modes: Partial<Record<CpuMode, number>> } | null {
  const own = TABLES[cpu][mn];
  if (own) return { mn, modes: own };
  const a = ALIASES_OF[cpu][mn];
  if (!a) return null;
  const [to, one] = a.split(':') as [string, string | undefined], modes = TABLES[cpu][to];
  if (!modes) return null;
  if (!one) return { mn: to, modes };
  const [only, as] = one.split('>') as [CpuMode, CpuMode | undefined];
  return { mn: to, modes: modes[only] !== undefined ? { [as ?? only]: modes[only] } : {} };
}
/** the mnemonics a processor has, with its aliases (upper case) */
export const cpuMnemonics = (cpu: TassCpu): string[] => [...Object.keys(TABLES[cpu]), ...Object.keys(ALIASES_OF[cpu]).filter(a => cpuOp(cpu, a))];

/** every mnemonic the processors other than the 6502 have, with the aliases (lower case): the editor colours them */
export const TASS_CPU_MNEMONICS: readonly string[] = [...new Set([
  ...(['65c02', 'r65c02', 'w65c02', '65816', '65dtv02', '65ce02', '4510', '65el02'] as const).flatMap(c => Object.keys(TABLES[c])),
  ...Object.values(ALIASES).flatMap(a => Object.keys(a)),
].map(m => m.toLowerCase()))].sort();

/** the instructions whose immediate is the accumulator's size (.al: 16 bits) and the index registers' (.xl) */
export const ACCU_IMM = new Set(['ORA', 'AND', 'EOR', 'ADC', 'BIT', 'LDA', 'CMP', 'SBC']);
export const INDEX_IMM = new Set(['LDX', 'LDY', 'CPX', 'CPY']);
/** the processors whose accumulator and index registers can be 16 bits (.al, .xl, REP and SEP with .autsiz) */
export const WIDE_CPUS: ReadonlySet<TassCpu> = new Set(['65816', '65el02']);
/** where a 16 bit branch counts from on each processor: the 65816's (BRL, PER) and 65EL02's from the next instruction,
 *  the 65CE02's (and the 4510's) from its last byte */
export const REL16_FROM: Partial<Record<TassCpu, number>> = { '65816': 3, '65el02': 3, '65ce02': 2, '4510': 2 };

/** the processor a `.cpu` name or a command line option is (null: one the check does not know) */
export function tassCpu(name: string): TassCpu | null {
  const n = name.toLowerCase();
  return (TASS_CPUS as readonly string[]).includes(n) ? (n as TassCpu) : null;
}
/** 64tass's command line options for a processor (`--m65816`, `-x` …) */
export const CPU_OPTIONS: Record<string, TassCpu> = {
  '--m65xx': '6502', '-i': '6502i', '--m6502': '6502i', '-c': '65c02', '--m65c02': '65c02', '--mr65c02': 'r65c02', '--mw65c02': 'w65c02',
  '-x': '65816', '--m65816': '65816', '--m65ce02': '65ce02', '-t': '65dtv02', '--m65dtv02': '65dtv02', '-e': '65el02', '--m65el02': '65el02', '--m4510': '4510',
};
