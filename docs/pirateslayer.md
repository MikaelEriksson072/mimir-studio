# Pirate Slayer – analys av bootet

Electronic Arts kopieringsskydd för C64 (1986–1989). Analysen gjordes 2026-11-07 på originalskivorna (G64) i
referensarkivet: koden kördes i Sindri och i VICE 3.10 (x64sc) och jämfördes instruktion för instruktion och byte för
byte. Det här dokumentet beskriver vad bootet gör; spec 13.5h beskriver vad Mimir gör med det.

## Ursprung och versioner

Loader-filen namnger sig själv: `+2 PIRATESLAYER BOOT PROGRAMMED BY KRIS HATLELID REGINA, SASK. CANADA`. Skyddet
bygger på PirateBusters av Kevin P. Pickell och Brian R. Niessen (Access Software, *Beach-Head II*, "PirateBusters
1.0FL"). Kända versioner (Rittwage, C64 Preservation Project):

| Version | Nyckelspår | Mönstret kontrollen letar efter |
|---|---|---|
| PirateBusters | 35 | `D7 D7 EB AA 55` |
| V1 | 37 och 36 | `EB D7 AA 55` på 37, `D7 D7 EB CC AD` på 36; misslyckas den drivs huvudet mot spår 42 |
| V2 | 2 | `D7 D7 EB CC AD`, och hos vissa titlar sedan `55 AE 9B 55 AD 55 CB AE 6B AB AD AF` |

## Skivorna i arkivet

Alla 483 G64-avbilder i arkivet skannades bit för bit efter mönstren. Fem har skyddet, alla version 2, alla i
`Games/Preservers/Disc`:

| Skiva | Boot | Nyckelspår 2 | Bitfas i avbilden | Kör i Sindri | Kör i VICE |
|---|---|---|---|---|---|
| Arctic Fox (Ariola) | EA + LOADER | 3 kopior/varv, 0 SYNC | 3 | ja, till spelet (lager 6, "CREATED BY DYNAMIX") | ja |
| Chuck Yeager's Advanced Flight Trainer | EA på `$0102` | 3 kopior (en avkortad), 0 SYNC | 7 | ja, 10 lager, 120 s | ja |
| Dan Dare (EA) | EA + LOADER | 4 kopior (två avkortade), 0 SYNC | 4 | nej | nej: avbilden är skadad |
| Demon Stalkers, sida A | EA på `$0102` | 4 kopior, 1 SYNC (skarven) | 0 | ja, 9 lager, 71 s | ja |
| Ferrari Formula One, sida A | FF1-BOOT (eget) | 4 kopior, 0 SYNC | 7 | ja, till titelskärmen | ja |

Dan Dares avbild har skadade sektorer (39 med fel kontrollsumma, LOADER:s text har nollor där bokstäver ska stå) och
hänger på `LOADING` även i VICE. Ingen annan G64 i arkivet har mönstren; D64-avbilderna av EA-spel saknar spåret.

## Nyckelspåret

Spår 2 har inga sektorer och inte ett enda SYNC-märke, bara byte som EA:s duplicering skrev, i densitet 1 (6 666 byte
ett varv; Demon Stalkers och Ferrari 7 140). Ett varv rymmer 3–4 kopior av nyckeln:

```
D7 D7 … D7        400–1 100 st
EB
CC AD × 512       1 024 byte
55 AE 9B 55 AD 55 CB AE 6B AB AD AF
AB AD AD …        (fyllnad, sedan nästa kopia)
```

Utan SYNC vet driven inte var en byte börjar: skiftregistrets räknare nollställs bara av ett SYNC, så byte ramas in
där räknaren råkar stå när huvudet kommer till spåret. På en riktig skiva är antalet bitar ett varv sällan delbart med
8, så inramningen flyttar sig ett par bitar varje varv, och kontrollen läser upp till ~65 000 byte (omkring tio varv)
innan den ger upp. I en G64 är spåret hela byte, och mönstret ligger på en fast bitfas (3, 7, 4, 0 och 7 i de fem
avbilderna), så en emulator som läser byte för byte hittar det aldrig – utom när fasen råkar vara 0.

## Kontrollen i driven

Kärnan är densamma i alla varianter (här Arctic Fox, `$05C5`–`$060B` i driven):

```
       lda $1c00 / and #$9f / ora #$60 / sta $1c00   ; densitet 3 en stund (256 × 5 cykler) …
       lda $1c00 / and #$9f / ora #$20 / sta $1c00   ; … sedan densitet 1, som spåret skrevs i
miss:  inc count / bne + / inc count+1 / bne …        ; 65 536 byte utan träff: ett nytt försök
+      bvc * / clv / lda $1c01 / cmp #$d7 / bne miss  ; en D7
d7:    bvc * / clv / lda $1c01 / cmp #$d7 / beq d7    ; resten av D7:orna
       cmp #$eb / bne miss
       ldx #2 / ldy #0
pair:  … cmp #$cc / bne miss / … cmp #$ad / bne miss  ; 512 par
       dey / bne pair / dex / bne pair
sig:   … cmp $0617,y / bne miss / iny / cpy #12 / bne sig   ; de 12 sista
```

Arctic Fox gör tio försök och hoppar sedan till `JMP ($FFFC)`, dvs. driven startas om. Jobbvarianten (Yeager, Demon
Stalkers, Ferrari) körs som DOS-jobb `$E0` och svarar med jobbkod 1 (nyckeln hittad), 3 (65 536 byte utan träff) eller
4 (tre försök slut).

## Boot 1: EA + LOADER (Arctic Fox, Dan Dare)

1. **EA** (2 block, `$00F7`–`$0246`) laddas över stacksidan. Stacken fylls med `$02`, så KERNAL:ns LOAD återvänder
   till `$0203`. Koden använder odokumenterade opkoder (`LAX`, `SAX`, `NOP abs`) och bygger själv sitt `JSR $033C`.
   Den skickar `UI` och `I` på kommandokanalen och laddar `LOADER` med sekundäradress 15.
2. **LOADER** (22 block, laddadress `$FFFA`). KERNAL:ns laddslinga skriver `$FFFA`–`$FFFF`, slår över till `$0000`
   (`$01` = `$06`: BASIC ut) och skriver sedan över sin egen pekare på `$AE`/`$AF`. Resten av filen hamnar därför i RAM
   under KERNAL från `$EDB0`.
3. **Dekrypteringen**, 13 lager (`$F33B` och framåt). Varje lager:
   - stoppar CIA 2:s timer A, laddar latchen `$504B` och startar den;
   - torkar koden det just körde genom att skriva timerns värde över den (`LAX $DD04 / STA $F30A,Y`);
   - dekrypterar nästa del med `LDA ($2B),Y / EOR $DD04 / EOR $DD05 / STA ($2B),Y`.

   Nyckeln är cykelräkningen. Skärmen är släckt (`$D011 = $0B`), så inga badlines stör. En frys-modul, en monitor
   eller ett avbrott ger fel nyckel, och koden kör in i en `BRK`-släde och en `JAM`. Det blir 36 771 dekrypterade
   byte. 32 av dem läses exakt när timern slår om, och där visar en 6526 latchen, aldrig 0.
4. **Drivkoden** laddas upp med `M-W` i 32-bytesblock från C64:ans `$0400`–`$08FF` till driven `$0300`–`$07FF` och
   startas med `M-E`. Den kör nyckelkontrollen och blir sedan en snabbladdare. Hittar den nyckeln skickar den genast
   sektorkedjan på 3/0, utan att C64:an bett om den. Sedan väntar den på kommandon. Ett kommando är 4 byte: kommando,
   spår, sektor och en kontrollsumma, besvarat med `$89` (ACK) eller `$A1` (NAK).
   - `$80`: läs en sektor.
   - `$90`: skriv en sektor (spara).
   - `$F0`: töm minnet och starta om DOS:en.
   - Allt annat: läs en sektorkedja från (spår, sektor) och skicka den.
5. **C64:ans laddare** (`$FC3E`, nås via `JSR $FF17` / `JMP ($F306)`) är tvåbitars. För varje byte väntar den på en
   rad som inte ligger precis före en badline (`LDA $D012 / SBC #$32 / BCC / AND #7 / BEQ`), släpper DATA och läser
   `$DD00` 16, 26, 39 och 50 cykler senare. Driven ser DATA släppas i en sjucykelsslinga och skriver bitparen 6, 16,
   30 och 40 drivcykler efter det. Ser driven släppet inom en fjärdedels cykel, läser C64:an det första paret i samma
   ögonblick som driven skriver det andra. Det håller när ett släppt DATA når driven ungefär en cykel sent.
6. Spelet laddas med `LDA #$17 / LDX #8 / LDY #0 / JSR $FF17`. Kommandon `$1x` skickar inget till driven: laddaren tar
   emot filen som driven skickar ändå, kedjan på 3/0, och X och Y används inte. Bit 0 startar filen via en stubbe på
   `$0073` (`LDA #$37 / STA $01 / JMP …`). Filen är spelets första och innehåller en egen kopia av laddaren på `$9106`.
   Den läser resten av spelet, se *Filerna utanför katalogen*.

Texter i bootet: `OUT OF MY CODE HACKER!`, `LICK MY USER PORT!`.

## Boot 2: EA på `$0102` (Chuck Yeager's AFT, Demon Stalkers)

1. **EA** (1–2 block, identiska byte på båda skivorna) laddas över stacksidan och startar när LOAD återvänder.
   Den rensar och släcker skärmen, öppnar kommandokanalen och avkodar sig i lager.
2. Den läser block 1/7–1/21 med `U1` och `B-P`, och laddar upp nyckelkontrollen en byte i taget med `M-W`
   (`$0300`–`$03B5`).
3. `M-E $0300` köar jobb `$E0` på spår 2. DOS:en söker spåret och kör koden som jobb.
4. `M-R $0000` läser jobbresultatet (`01` = nyckeln hittad), sedan `M-R $0300`.
5. `UJ` startar om driven. Återstarten sätter stegmotorn i fas 0. På spår 2 står den i fas 2, så huvudet flyttas till
   spår 3, där DOS:en hittar headers igen och kan läsa BAM:en (ID:t på `$12/$13`).
6. `#0` och `B-E 2,0,1,1` kör nästa drivsteg från 1/1.
7. C64:an öppnar varje överföring med en ATN-handskakning som har en tidsgräns på ungefär 2 800 cykler. Svarar
   driven inte töms `$0400`–`$0FFF` från en rutin på `$EF00`, och programmet kraschar. Text i lagren: `GIVEITUPGUY`.

## Filerna utanför katalogen

Katalogen på en skiva med EA:s eget boot listar bara `EA` och `LOADER` (Dan Dare två filer till). Resten av spelet
ligger i sektorkedjor som laddaren läser på spår och sektor. Formatet:

- Kedjan är länkad som en vanlig fil: varje sektor börjar med nästa spår och sektor.
- Sista sektorns andra byte är **antalet** byte i den. DOS har index för den sista byten där, alltså ett mindre.
- De två första byten är laddadressen, som i en PRG.
- Varje byte är lagrad **XOR `$EA`**, laddadressen också. Överföringen till C64:an tar bort det, så filen hamnar
  avkodad i minnet.

Spelets kopia av laddaren (`$9106` i Arctic Fox) tar kommandot i A, spåret i Y och sektorn i X:

| A | Gör |
|---|---|
| `$1x` | tar emot filen som driven skickar ändå (den första, när nyckeln är hittad) |
| `$00` | sätter bufferten för sektorläsning: X = låg, Y = hög byte |
| `$80` | läser sektorn (Y, X) till bufferten |
| `$90` | skriver bufferten till sektorn (Y, X) |
| `$F0` | startar om driven |
| annat | laddar kedjan som börjar på (Y, X) till dess laddadress |

Bit 0 i kommandot startar filen på laddadressen. Bit 1 blinkar `$D021` för varje block. Tillbaka får man status i A
och carry satt vid fel. Arctic Fox läser bilderna en sektor i taget (`$80`) ur en tabell med spår, sektor och antal,
och hoppar över de fyra första byten i första sektorn.

Arctic Fox har 27 sådana filer. Laddadresserna gäller efter avkodningen:

| Från | Laddar | Vad |
|---|---|---|
| 3/0 | `$8F1F`–`$97FF` | spelets första fil, med laddaren på `$9106`; driven skickar den efter nyckeln |
| 19/0 | `$39BD`–`$7F9B` | spelets huvudkod (17 887 byte) |
| 23/0 | `$9800`–`$9FFF` | fortsättning efter första filen |
| 9/0, 11/0, 13/0, 15/0 | `$A000`–`$BF3F` | fyra bitmappar à 8 000 byte |
| 10/11, 12/11, 14/11, 16/11 | `$C000`–`$C3E7` | 1 000 byte till varje bitmapp (skärmminne, av storleken att döma) |
| 10/15, 12/15, 14/15, 16/15 | `$C400`–`$C7E7` | 1 000 byte till (färger, av storleken att döma) |
| 31/0, 32/0, 34/0, 35/0 | `$0400`–`$0EA4` | fyra olika filer, lika stora och på samma adress |

Resten är mindre filer och två olika filer på `$3B00` (3/13 och 5/16). 19/0, 23/0, 31/0, 8/19 och 3/0 jämfördes med Sindris minne när spelet gick, och
stämde byte för byte. Dan Dares 3/0 laddar på `$C000`, och huvudfilen 24/0 på `$0800`–`$3FFF`.

Stack-bootet (Yeager, Demon Stalkers) har spelets filer i katalogen, okodade. Efter kontrollen läser driven kedjan på
3/0. Den är lagrad XOR **`$A5`** och ligger avkodad i minnet: Demon Stalkers på `$1800`–`$28FF`, Yeager på
`$9700`–`$A000`. Kedjorna på spår 1 är bootets egna block, som `EA` läser med `U1`.

Mimir listar filerna i fliken **Pirate Slayer** (spec 13.5h) och öppnar dem avkodade, så de kan disassembleras och
assembleras om. Arctic Fox 3/0, 9/0, 19/0 och 23/0 blir byte för byte desamma igen.

## Boot 3: Ferrari Formula One (Argonaut/Imagitec för EA)

FF1-BOOT laddas till `$00AE`. De två första byten skriver om KERNAL:ns laddpekare, så resten hamnar på `$02B0`. Där
pekar BASIC:s vektor `$0302` in i koden, och programmet startar av sig självt. FF2M innehåller `M-W`-uppladdaren och
jobbvarianten av nyckelkontrollen (på `$BF90` i spelets minne). Spelet behåller koden, så Mimir hittar kontrollen även
i det uppackade spelet.

## Vad som krävdes av emuleringen

Bootet körs nu hela vägen i Sindri med G64:an i driven. Det krävde åtta rättelser, alla mätta mot VICE:

1. **G64 i driven, bit för bit**: SYNC efter tio 1-bitar, en byte var åttonde bit efter det, halvspår. På ett spår
   utan SYNC glider inramningen en bit per varv, som på en riktig skiva.
2. **CIA-timern läses i instruktionens sista cykel** (tidigare i den första) och börjar räkna i tredje cykeln efter
   skrivningen. `STA $DC0E / LDA $DC04` ger latchen minus 2.
3. **En timer som går visar aldrig 0**: den laddas om i samma cykel, och latchen syns två cykler i rad.
4. **Badline-DMA i cykel 11–54** av raden (räknat från 0, när rasterraden byter), och processorn stannar först vid
   en läsning, inte efter instruktionen som passerar.
5. **CLK och DATA som C64:an släpper når driven en cykel senare**; neddragning och ATN syns direkt. Det mättes: EA:s
   och Ferraris laddare behöver det, och Krills laddare, som klockar bitarna med ATN, går som förut bara om ATN inte
   fördröjs. Med en fördröjning på alla linjer, som VICE:s `maincpu_clk + 1`, föll sju av 200 diskar i
   regressionskörningen; med den här ingen.
6. **Stegmotorns fas hör till huvudets läge** (fas 0 på spår 1, 2 på spår 2), och den motsatta fasen flyttar huvudet
   ett helt spår. Så flyttar `UJ` huvudet från nyckelspåret.
7. **LOAD lagrar genom pekaren på `$AE/$AF`**, byte för byte. En fil över pekaren fortsätter dit dess första byte
   pekar.
8. **Busstrafik med driven räknas som arbete**: en bytevis `M-W`-uppladdning med motorn av skriver inget nytt i
   C64:ans minne men är inte "settled".

Efter rättelserna stämmer de 36 771 dekrypterade byten och alla 59 064 byte som laddaren tar emot fram till spelet
exakt med VICE.

## Källor

- Pete Rittwage, *Pirateslayer V1/V2 and PirateBusters 1.0FL*, C64 Preservation Project (rittwage.com/c64pp).
- VICE 3.10:s källkod (drivecpu.c, c64cia2.c, iecbus.c, drive.c) för synk, stegmotor och G64-läsning.
- Skivorna själva, körda i Sindri och i x64sc med `-moncommands`-spårpunkter.
