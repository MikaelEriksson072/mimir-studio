# Kryptering i C64-spel – analys

Hur spel och deras laddare döljer kod och data. Analysen gjordes 2026-11-11 på referensarkivet
(`Desktop/C64/AssemblyLibrary/Archives/Games`): spelen kördes i Sindri och looparna som dekrypterar fångades medan de
gick. Skriptmallarna i fliken Scripts (spec 10.3, `packages/core/src/script-templates.ts`) bygger på det som hittades
här.

## Hur analysen gjordes

**Urval:** 3 714 filer, slumpade med fast frö ur varje samling. Med alla Preservers-disketter (originalen, G64 och D64,
utan B-sidor), 500 av Preservers band, 300 C64Tapes-org-band, alla Blast-from-the-past-disketter, ur Gamebase 400 D64,
300 T64 och alla G64, ur CSDB 500 D64 och 200 PRG, 300 OneLoad64-PRG, 150 Guybrush, 40 SEUCK och 300 C64com. 3 581
filer gick att köra (3 090 spel). Resten var trasiga avbilder eller saknade program, och sex hängde sig i Sindri och
stoppades.

**Körning:** varje fil kördes i Sindri med ROM, disketten i 1541:an eller bandet i datasetten, i högst 120 miljoner
cykler (två minuter C64-tid). Tangenter trycktes när ett lager väntade, så att intron släppte förbi.

**Vad som räknades:** en `STA` (eller en läs-ändra-skriv-instruktion som `INC $xxxx,x`) i rak kod efter en läsning,
där byten däremellan gått genom `EOR`, `ADC`, `SBC` eller ett skift. Instruktionen skulle skriva varje adress högst
några gånger och minst 64 byte sammanlagt. Bort sorterades:
- loopar där den lagrade byten laddades (tabelluppslag, `lda tab,x`),
- kopior av teckenrommen,
- packarnas tabellbyggen (Exomizer bygger sina tabeller med `txa / adc $0367,y / sta $0368,y`, vilket fanns i 58 spel).

Looparna sorterades efter vad som ändrade byten. Exemplen nedan är kontrollerade i sitt sammanhang: koden
disassemblerades i Sindri när loopen körde, med registren och nollsidan som de var då.

## Resultat i siffror

424 av 3 581 filer (11,8 %) har en loop som dekrypterar 64 byte eller fler. Då är NOT (`eor #$ff`) och text som skrivs
till skärmen inte medräknade.

| Samling | Media | Filer | Med dekryptering | Andel |
|---|---|---:|---:|---:|
| Preservers | band (TAP) | 474 | 100 | 21,1 % |
| C64Tapes-org | band (TAP) | 281 | 57 | 20,3 % |
| Preservers | diskett (G64) | 166 | 32 | 19,3 % |
| Preservers | diskett (D64) | 87 | 13 | 14,9 % |
| Gamebase | diskett (G64) | 81 | 32 | 39,5 % |
| CSDB | diskett (D64) | 492 | 51 | 10,4 % |
| Gamebase | diskett (D64) | 388 | 36 | 9,3 % |
| Blast-from-the-past | diskett (D64) | 335 | 29 | 8,7 % |
| OneLoad64 | PRG | 300 | 25 | 8,3 % |
| C64com | diskett (D64) | 289 | 22 | 7,6 % |
| CSDB | PRG | 199 | 14 | 7,0 % |
| Gamebase | T64 | 299 | 10 | 3,3 % |
| Guybrush | diskett (D64) | 150 | 3 | 2,0 % |
| SEUCK | diskett (D64) | 40 | 0 | 0 % |

**Krypteringen sitter i originalen:** ett av fem originalband och originaldisketter har den. Bland cracks och
enfilsversioner (CSDB, Gamebase, OneLoad64) är det en av tio eller färre. Crackarna tog bort skyddet, och det som
finns kvar där är oftast deras egna intron (text som dekrypteras till skärmen) eller packare. Gamebase G64-avbilder
är kopior av original med skyddet kvar, därav 39,5 %.

## Metoderna

Siffrorna är maskinens sortering av 3 581 filer och är ungefärliga. En grupp kan innehålla loopar som sorterades fel,
till exempel en konstant nyckel som ser ut som en tabell. Exemplen i tabellen är kontrollerade.

| Metod | Spel | Loopen | Kontrollerade exempel | Mall |
|---|---:|---|---|---|
| XOR med en konstant | 71 (+28 till skärmen) | `lda ($80),y / eor #$77 / sta ($80),y` | Pooyan (Datasoft, band): `$431b–$931a`, som sedan körs. Purple Turtles (Quicksilva): `eor #$fd` över `$0800–$a1ff`. Arctic Fox (EA): `eor #$34`. Ironlord (Ubi Soft): `eor #$bf` bakifrån. Green Beret (Imagine): `eor #$a5`. Kick Off (Anco): `eor #$5a`, text till skärmen | `xor_key` |
| NOT (`eor #$ff`) | 70 | `lda $ef00,y / eor #$ff / sta $e000,y` | Arctic Fox (EA). Många är grafik eller masker: SEUCK-motorn vänder `$f400–$f5ff` i varje SEUCK-spel | `xor_key`, nyckeln `$ff` |
| XOR med byte i minnet (samma för alla byte) | 33 + 25 | `eor $0308 / eor $0317` | Gauntlet (US Gold, diskett): `jsr $ffcf / eor $0316 / eor $0317 / sta $0330,y` (BRK-vektorn). Mastertronics band (Jungle Story, Bionic Granny, Spitfire 40): `eor $0308 / eor $0317`. Elite (Firebird): `eor $0316`. House of Usher (Kingsoft): `eor $0400 / eor $0401`, de två första tecknen på skärmen | `xor_key`, nyckeln `$a ^ $b` |
| XOR med stacken | 34 | `tsx / dex / eor $0100,x / eor $0101,x` | US Golds och Gremlins band (Shackled, Artura, Led Storm, Chicago 30, Alien Storm): två byte som ligger kvar under stackpekaren. Bootet dekrypterar `$087c–$097b` och fortsätter där | `xor_key` |
| Kedja: XOR med byten före | omkring 60 | `ldy #$ab / eor $0350,y / sta $0350,y / dey / bne` | Armalyte (Thalamus), Dynamite Dux och Fighter Bomber (Activision), Dominator (System 3), Peter Pack Rat (Silverbird) och 28 band till: bootet i bandbufferten (`$0351–$03fb`) bakifrån, där A bär byten som just dekrypterats. Laser Compiler och Laser Basic (Ocean IQ): `eor ($02),y / sta ($02),y / iny`. Impossible Mission (Epyx): `lda $b001,y / eor $b000,y / sta $b001,y`. Arcticfox (Ariolasoft): byten före som den var krypterad (`pha … pla / sta $0013`) | `xor_chain` |
| XOR med en nyckeltabell | 54 | `lda $3c00,x / eor ($76),y / sta ($76),y` | Guild of Thieves (Rainbird): en nyckel på 256 byte. Ironlord (Ubi Soft): `lda $1552,x / eor $1502,x / sta $0100,x`, två tabeller till kod på stacksidan. Prodigy (Firebird): `eor ($a8),y` | `xor_key_string` |
| Rullande nyckel | 46 | `lda $fd / clc / adc $fe / sta $fd / lda ($fb),y / eor $fd` | Designer's Pencil (Activision): nyckeln ökar med `$fe` per byte. Adventure Construction Set och Pinball Construction Set (EA): `eor $28`, där `$28` = sidan EOR `$7f` | `xor_rolling_key` (`pageKey`) |
| ADD/SUB | 44 + 39 | `lda $03d0,y / sec / sbc #$55 / sta $03d0,y` | Strike Fleet, Chuck Yeager's AFT, Demon Stalkers (EA): 128 byte som sedan körs | `add_key` |
| Flera steg | 8 + 7 + 4 | `sbc #$1b / eor #$aa / sbc #$fb / eor #$55` | Commodores egna band (Spirates, Maggotmania, Patience, Rolf Harris Picture Builder): över BASIC-programmet, och laddaren med `eor #$e3 / sbc #$7f`. Green Beret och Yie Ar Kung Fu (Imagine): `adc #$32 / eor #$49`, text till skärmen | `steps` |
| XOR med en timer | 4 + 4 | `eor $dd04 / eor $dd05` | EA:s laddare (Arctic Fox med Pirate Slayer, samma kod i Marble Madness och Age of Adventure): 13 lager, som vart och ett dekrypterar resten. Melbourne Houses band (Bazooka Bill, Judge Dredd, Way of the Exploding Fist, Staff of Karnath): en LFSR-byte (`asl / bcc / eor #$1d`) EOR CIA2:s timer A, som räknar ner med loopens cykler | ingen: Sindri eller VICE |

**Rotation** (ROL/ROR på datan) hittades inte som kryptering. ROR i EA:s laddare läser bitar från disken. Lsr/rol/ror
i Elite ändrar själva laddarens instruktioner (koden skapar sin egen `eor`). De övriga skiften var grafik. I mallen
`steps` finns rotation som steg (`ROTL`, `ROTR`) ifall ett spel gör det.

## Nyckeln från maskinen: skydd mot fusk

Ofta är nyckeln inte ett tal i loopen utan något laddaren räknar med att maskinen har just då:
- vektorer som KERNAL eller laddaren satt (`$0308`, `$0316/$0317`),
- byte som ligger kvar under stackpekaren efter en tidigare `JSR`,
- tecken på skärmen,
- en CIA-timer som går.

En frysare, en monitor eller en cartridge ändrar något av det, och då blir det skräp i stället för kod. Samma avsikt
har tricken runt omkring:
- **Självdekrypterande kod:** loopen faller rakt in i det den nyss dekrypterat (Pooyan, Strike Fleet, Shackled).
- **Odokumenterade opkoder som fyllnad:** `lax`, `nop $20,x`, `nop #$cd` mitt i Mastertronics loop.
- **Kod som ändrar sig själv:** Elite gör sin `eor $0316` med `lsr`/`rol`/`ror` på instruktionens byte, och
  Pharaoh's Curse räknar upp sidan i sina egna operander.

## Var krypteringen sitter

- **Bandets boot i bandbufferten** (`$033c–$03fb`): huvudet dekrypterar sig självt innan turbon startar. Exempel är
  Armalyte-familjen (kedja) och Mastertronic (vektorer).
- **Diskettladdare:**
  - EA:s laddare (Arctic Fox): 13 lager med timern, `eor #$34`, `eor #$ff`, och XOR `$EA` på filerna (Pirate
    Slayer-disketterna, `docs/pirateslayer.md`).
  - Gauntlet: filen läses med CHRIN och XOR:as med BRK-vektorn.
- **Spelets kod**, som dekrypteras och sedan körs (Pooyan, Purple Turtles, Ironlord).
- **BASIC-programmet** på Commodores band.
- **Text:** krediter och intron som dekrypteras till skärmen (Kick Off, Imagine, crackintron).

## Det som såg ut som kryptering men inte var det

- **Exomizers tabellbygge**, i 58 spel: `txa / adc $0367,y / sta $0368,y` och `adc $039b,y / sta $039c,y`, 52 byte.
- **Tabeller som räknas fram:** Terrorpods `sbc $18` bygger subtraktionstabeller på `$c200–$c4ff`.
- **Grafik:**
  - skift och rotationer på bitmappar,
  - teckenrommen kopierad inverterad,
  - SEUCK-motorns NOT-tabeller.
- **Text till skärmen** med `adc #$40` eller `sbc #$40`: omvandling mellan PETSCII och skärmkoder.
- **`slo $033c,y`** på bandbufferten (Mastertronic, 12 spel): skiftar bort huvudet efter användning, dekrypterar inget.

## Mallarna

| Mall | Metod |
|---|---|
| `xor_key` | XOR med en byte, också NOT och nycklar ur minnet (`key = $66 ^ $fe`) |
| `xor_key_string` | XOR med nästa byte i en nyckel på 1–256 byte |
| `xor_rolling_key` | nyckeln ändras per byte (plus något, sedan EOR), eller är sidan EOR en nyckel |
| `xor_chain` | XOR med byten före, dekrypterad eller krypterad, framifrån eller bakifrån |
| `add_key` | ADC eller SBC med en nyckel som kan ändras |
| `steps` | upp till fyra steg i rad: ADD, SUB, XOR, ROTL, ROTR |

**Så används en mall:**

1. Hitta loopen i listningen: en `eor`, `adc` eller `sbc` mellan en `lda` och en `sta` med `,x`, `,y` eller `(zp),y`.
2. Läs av nyckeln. Är den en byte i minnet, läs värdet när spelet kör (debuggern eller VICE:s monitor).
3. Sätt `.var`-raderna: `source`, `length` och nyckeln.
4. Kör först med `dest = result`. Programmet lämnas då orört och scratchpaden visar resultatet som kod, hex eller
   text.
5. Ser det rätt ut, sätt `dest` till en etikett eller `source`. Då hamnar byten i programmet och i `.asm`-filen.
6. `encrypt = true` krypterar tillbaka ändrade byte.

Nycklar från en timer som går kan ett skript inte efterlikna. Där är Sindri (Unpack) eller VICE vägen.
