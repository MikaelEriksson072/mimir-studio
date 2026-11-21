# Para-Protect – analys av bootet, laddaren och diskformatet

Para-Protect V2 är ett kopieringsskydd med snabbladdare som flera förlag hade på sina skivor 1987–1988. Bootet namnger
sig självt: `PARA-PROTECT V2 1987` och `PARA-PROTECTED BY PARANOID 1988`. Analysen gjordes 2026-11-21 på *Bangkok
Knights* (System 3, G64 i `Games/Preservers/Disc/B`). Koden kördes i Sindri och i VICE 3.10 (x64sc) och jämfördes byte för
byte; sedan prövades läsningen på arkivets sju andra Para-Protect-skivor. Det här dokumentet beskriver vad skivan och
koden gör. Spec 13.5o beskriver vad Mimir gör med det.

## Skivorna i arkivet

Arkivets 312 skivavbilder under `Games/Preservers` söktes efter bootets text. Åtta har den, alla G64. Kolumnen
*Förfrågningar* är bootets tabell: antal sidor, första spår/sektor och vart sidorna går.

| Skiva | Förfrågningar | Sektorer ett spår | Datablockens första byte | Sindri | VICE |
|---|---|---|---|---|---|
| Bangkok Knights (System 3) | 14 s 21/0 → `$BA00`, 52 s 21/17 → `$0800`, 137 s 24/15 → `$0800` | DOS:ens, steg 8 | sektorns nummer | till spelet | med drive 1541; inte med 1541-II |
| Better Dead than Alien (Electra) | 36 s 19/0 → `$DC00`, 118 s 20/3 → `$0800`, 1 s 40/14 → `$4000` | egen tabell, steg 8 | `$07` | till spelet | – |
| Beyond the Ice Palace (Elite) | 40 s 19/0 → `$D800`, 188 s 21/16 → `$0800`, 1 s 40/14 → `$C400` | egen tabell, steg 8 | `$07` | till spelet | – |
| Buggy Boy (Elite) | 40 s 19/0 → `$D800`, 206 s 21/16 → `$0800`, 1 s 40/14 → `$0800` | egen tabell, steg 8 | `$07` | stannar efter första filen | hänger (grön skärm) |
| F-16 Combat Pilot (Digital Integration) | 3 s 40/14 → `$0A00` | egen tabell, **steg 1** | `$07` | till spelet | – |
| Jaws (Screen 7) | 40 s 19/0 → `$D800`, 143 s 21/16 → `$0800`, 1 s 40/14 → `$0B00` | egen tabell, steg 8 | `$07` | till spelet | – |
| Superstar Ice Hockey (DataByte) | 30 s 34/0 → `$0800`, 1 s 40/14 → `$0500` | egen tabell, steg 8 | `$07` | till spelet | – |
| Thundercats (Elite) | 40 s 19/0 → `$D800`, 192 s 21/16 → `$0800`, 1 s 40/14 → `$0800` | egen tabell, steg 8 | `$07` | till spelet | – |

*Till spelet* betyder att Sindri laddar klart: titelskärm, meny eller spel. Varje förfrågan som Sindri gjorde på de sju
skivorna är byte för byte de sidor Mimir läser ur avbilden.
Undantaget är Buggy Boys andra förfrågan. Buggy Boys avbild har tre sektorer med fel kontrollsumma (två i den andra
filen, en på 40/14), och spelet hänger i VICE också. I Sindri tar driven emot `$C0` sidor när C64:an ber om `$CE`. Det
är inget fel i Sindris överföring utan en kapplöpning i bootet, se *Kapplöpningen med jiffy-klockan* nedan.

## Katalogen

Katalogen har 16 poster, Bangkok Knights 15. Alla pekar på bootets första sektor: 18/8 på Bangkok Knights, 18/9 på de
andra. Namnen bildar en bild i listningen (`PARA-PROTECT`, `BANGKOK`, `KNIGHTS` mellan streck). Den sista heter
`PROTECTED BY PAR…` och har ett påhittat antal block. `LOAD"*",8,1` laddar den första.

## Bootet laddar över sin egen pekare och STOP-vektorn

Bootet är fem block med laddadressen `$00AE`. KERNAL:ns LOAD lagrar varje byte genom pekaren på `$AE/$AF` och räknar
sedan upp den (`STA ($AE),Y` / `INC $AE` / `BNE` / `INC $AF`). Den första byten hamnar alltså i pekaren själv, och resten
går dit bytena före har pekat den. På Bangkok Knights hamnar filen på `$003F`–`$00AE` och `$00BB`–`$04E2`. Stacksidan
`$0109`–`$0202` fylls med `$02`, så att LOAD återvänder till `$0203`.

På vägen laddar bootet över STOP-vektorn på `$0328`. KERNAL:ns seriella LOAD anropar STOP (`JSR $FFE1` på `$F4F9`,
genom vektorn) före varje byte den tar emot, utom den första. Från det ögonblicket körs alltså bootets egen kod mellan
bytena. Den läser pekaren och ser var laddningen är:

```
$00ED  lda $af / cmp #$03 / bne + / lda $ae / cmp #$3b / bne +   ; pekaren på $033B?
       lda $8b / eor #$b0 / sta $0329                             ; då: vektorn → $02ED
+      jmp $f6fb
$02ED  jmp $02b2
$02B2  ; pekaren − 1: byten som lagrades sist
       lda ($ae),y / eor $8b / eor $ae / eor $af / eor $0200,x / sta ($ae),y
       ; nyckeln $8B stegar inom ett fönster på 64 byte (sbc $02ee / and #$3f / adc $02ee)
       lda #$91 / sta $02cf                                      ; första anropet läser bara: STA skrivs in
       jmp $f6fb
```

Från `$033C` avkodas alltså varje byte när den har kommit in. `JMP $F6FB` hamnar i KERNAL:ns kod för felnummer, som
återvänder med A = 1 och carry satt. För LOAD betyder det att STOP inte är nedtryckt. Det blir 441 anrop.

*Sindri* lade tidigare in en diskfil i minnet på en gång (genom pekaren, men utan STOP-anrop). Bangkok Knights fastnade
då på en `JAM` vid `$033C`. Nu lagrar Sindri en byte i taget och anropar STOP-vektorn före varje byte efter den första,
med `$AE/$AF` i RAM som KERNAL:ns, så som bandladdningen redan gjorde (13.5f). Mätt gammal mot ny på 200 slumpvisa
skivor ur arkivet: 199 lika. Planet Golf Extras (Triad) kommer längre: dess boot laddar på `$02ED` och startar sig
själv från STOP-vektorn mitt i LOAD.

*VICE:s autostart* (x64sc `-autostart` med standardläget) går inte genom KERNAL:ns laddslinga: en brytpunkt på `$F4F0`
nås aldrig, och minnet efter laddningen är inte det en C64 får. Analysen gjordes därför med `LOAD"*",8,1` inskrivet
(`-keybuf`) och `+trapdevice8`.

Vid `$0203` gör bootet så här:

1. Släcker skärmen och gör den svart.
2. Nollar minnet från `$0600` till `$FFFF` med `$01` = `$34`.
3. Återställer vektorerna (`JSR $E453`, `JSR $FD15`).
4. Avkodar `$023B`–`$0261` (XOR med `$0203,X` och X).
5. Letar efter en cartridge: `INC $DF00` sexton gånger, och skriver till `$8000`, `$DE00` och `$DF00`.
6. Går till `$033C`.

Där skickar bootet `I` till driven och sedan ett `M-E $0205`-kommando, avkodat med `DEC` och `EOR (27 − x)`. Dess egna byte
är kod:

```
$0205  sei / lda $0e / sta $0f / sta $47 / lda #$80 / sta $04 / cli
       lda $04 / bmi * / cmp #1 / bne … / jmp $0704
```

Den läser alltså spår `$0E`, efter `I` = 18, sektor 18, med datablockets ID = 18 (`$47`), till buffert 4 på `$0700`, och
kör det. Sedan kopierar bootet mottagningskoden till nollsidan (`$03F5` → `$0002`–`$0101`) och laddarstubben till sida 2
(`$03C5` → `$02AE`), sätter `$01` = `$35`, laddar förfrågan 0, kör `$BA80`, laddar förfrågan 1 och hoppar till `$0801`.
Förfrågan 2 laddas av introt när en tangent eller eld trycks (`LDX #2 / JSR $02AE / LDA #$0B / STA $D011 / JMP $0801`
på `$02D1`).

## Drivkoden: stegen, och varför en 1541-II inte klarar det

Drivkoden läses i steg med vanliga DOS-jobb. På Bangkok Knights är det 18/18 (ID `$12`, buffert 4), 18/15 (ID `$0F`,
buffert 3) och 18/14 (ID `$0E`, buffert 2). Varje steg avkodar nästa, och slutet är laddaren på `$0500`–`$0686`. 18/16 och
18/17 har ID `$10` och `$11` men läses inte av bootet. De andra skivorna läser 18/18 och 18/15 med ID `$07`, och deras
kod ligger okrypterad på skivan.

18/18 suddar ut sig själv med byte ur DOS-ROM:en: `LDX #$29 / LDA $C000,X / STA $0700,X / DEX / BPL`. Den första
skrivningen landar på slingans egen opkod på `$0729` och lägger dit `$C029`. Vad som händer sedan beror på ROM:en:

- **1541** (ROM 901229-05): `$C029` = `$AA` (`TAX`), och operanden `$00` blir `BRK`. Drivens IRQ-rutin körs, `RTI` går
  vidare till `STA $0700,X` och `DEX`, och `BPL` hoppar inte (X = `$A9`). Drivkoden fortsätter till nästa steg. Spåret av
  det syns i driven som `$07AA` = `$AA`.
- **1541-II** (ROM 251968-03): `$C029` = `$4C`, alltså `JMP $C000`. Driven startar om. C64:an tar emot nollor, och spelet
  fyller minnet med `00 01 02 …` och stannar på en `JAM` vid `$8242`.

VICE:s standarddrive (x64sc `-default`) är en 1541-II. Bangkok Knights startar därför inte där. Med `-drive8type 1541`
visar VICE titelskärmen, och Sindri, som tar 1541-ROM:en, kommer till spelet.

## Laddaren

**C64:an.** En förfrågan är A = antal sidor, X = spår och Y = sektor, med `$8E/$8F` = vart sidorna går och `JMP $00B2`.
Bit 7 i sektorn betyder att driven går tillbaka till sin DOS efteråt (`LDA #7 / STA $47 / JMP $D048`). Stubben på sida 2
(`SEI / LDA dest,X / STA $8F / LDA sidor,X / PHA / LDA spår,X / PHA / LDY sektor,X / PLA / TAX / PLA / JMP $00B2`) tar
förfrågan X ur tabellen efter sig. Det är den tabellen Mimir läser.

- Bangkok Knights skickar tre byte. De andra skickar fyra. Den fjärde är 1 för fler förfrågningar. Med 2 stannar driven i
  en slinga som håller DATA, och allt annat startar om driven (`JMP ($FFFC)`).
- Varje byte går en halvbyte i taget genom en tabell, två bitar per skrivning till `$DD00`, på en rad som inte ligger
  precis före en badline (`LDA $D012 / SEC / SBC #$31 / BCC / AND #7 / CMP #2 / BCC`).
- Mottagningen läser `$DD00` fyra gånger och gör `EOR $89` för VIC-bankens bitar. Sidorna lagras med `DEC $01` / `STA
  ($8E),Y` / `INC $01`, alltså i RAM under I/O.
- Better Dead than Alien har NMI-vektorn och CIA 2:s timrar igång under laddningen. NMI-rutinen påverkar inte bytena.

**Driven.** Laddaren körs som DOS-jobb `$E0` i buffert 2 eller 3, med huvudet på spåret. För varje sektor gör den så
här:

1. Bygger sektorhuvudet som DOS:en gör (ID, spår, sektor, kontrollsumma) och gör det till GCR (`JSR $F6D0` eller `$F934`).
2. Jämför de första 8 GCR-bytena när de kommer från skivan.
3. Väntar på nästa SYNC och läser 326 GCR-byte.
4. Avkodar dem med `JSR $F8E0`, **utan att se på datablockets första byte eller kontrollsumman**.
5. Skickar de 256 bytena.

Nästa sektor är sektor + *steg*. Blir den ≥ antalet sektorer på spåret dras antalet av, och blir det då 0 går laddaren
till nästa spår, sektor 0. Huvudet stegar den själv, två halvspår med timern `$1805`. Antalet sektorer tar Bangkok
Knights från DOS:en (`JSR $F24B`: 21, 19, 18, 17). De andra har en egen tabell efter hastighetszon: 17, 17, 19 och 19 för
spår 31–35, 25–30, 18–24 och 1–17. Tabellen är sista byten i 18/15 och de tre första i 18/18. Steget är 8, utom på F-16
där det är 1.

Två följder av det:

- På Bangkok Knights spår 25–30 (18 sektorer, steg 8) läses bara de jämna sektorerna, och de udda är utfyllnad.
- På de andra läses spår 25–30 som 17 sektorer och spår 1–17 som 19.

**Bangkok Knights datablock** har sektorns nummer som första byte i stället för `$07`. Sektor 7:s är alltså `$07`, och
sektor 8:s är `$08`, samma som ett sektorhuvud. En 1541:s DOS läser ingen av dem (22 READ ERROR), och en D64 av skivan
saknar dem. De andra skivornas datablock har `$07`, så en D64 av dem har sektorerna, men inte det som kontrollen läser.

## Kapplöpningen med jiffy-klockan

C64:ans sändrutin tar varje halvbyte ur en tabell på 16 byte på `$0092`–`$00A1`: `00 80 20 A0 40 C0 60 E0 10 90 30 B0
50 D0 70 F0`. Tabellens två sista byte, posterna för halvbytarna `$E` och `$F`, ligger på `$00A0`–`$00A1`. Där har
KERNAL:n sin jiffy-klocka (`$A0`–`$A2`).

Bootet kopierar laddaren till nollsidan (`LDA $0433,Y / STA $0002,Y`, Buggy Boy; `$03F5` på Bangkok Knights) och
stubben till sida 2 *innan* det gör `SEI`. Under tiden går KERNAL:ns avbrott var 60:e sekund. Kommer ett avbrott efter att
kopian har skrivit `$70` på `$00A0` men före `SEI`, ser klockrutinen (`$F69B`) att klockan visar mer än 24 timmar
(`$70xxxx` ≥ `$4F1A01`) och nollar `$A0`–`$A2` (`$F6B6`). Halvbytarna `$E` och `$F` skickas då som 0. Fönstret är
ungefär 2 300 cykler av avbrottets 16 421, så omkring en uppstart av sju borde drabbas på en riktig C64, där läget i
avbrottets period beror på var skivan står när LOAD börjar.

- *Buggy Boy* ber om `$CE` sidor och driven får `$C0`. Laddaren tar emot 206 sidor men driven skickar 192, så C64:an
  väntar för evigt. Det hände i Sindris körning (avbrottet kom vid `$F6B6` strax efter att `$00A0` skrivits).
- *VICE* är deterministisk här och vann kapplöpningen i tio körningar. Med starten flyttad (`-keybuf-delay` 1–12) var
  `$00A0`–`$00A2` nollade vid `SEI` med fördröjning 12, och orörda med de andra elva.
- *Bangkok Knights* första förfrågan är `$0E` sidor, så den skulle bli 0 om avbrottet slog till. De andra skivorna har
  samma kod och samma risk där en förfrågan har `$E` eller `$F` i en halvbyte.

Sindri gör alltså som en C64 gör: den förlorar kapplöpningen när avbrottet faller i fönstret. Sindris överföring är inte
fel. Buggy Boy hade ändå inte startat, eftersom avbilden har trasiga sektorer.

## Spelens egna laddningar

**40/14.** Spår 40 har 17 vanliga sektorer. Sektor 14 är en sida som de flesta spelen laddar med laddaren:

- I bootets tabell: Better Dead than Alien `$4000`, Beyond the Ice Palace `$C400`, Jaws `$0B00`, Thundercats `$0800`,
  Superstar Ice Hockey `$0500`, och F-16 tre sidor till `$0A00`.
- Från spelet: Bangkok Knights gör `A=1, X=40, Y=$8E` → `$4500` från `$9180`, när spelet har packats upp, och driven går
  sedan tillbaka till DOS:en.

På Bangkok Knights är sidan spelets uppstart. Den sparar nollsidan, kopierar `$46C6`–`$49C5` till `$0600`–`$08FF` och
ändrar musikens `STA $D418`. Efter den läser Better Dead, Ice Palace, Jaws, Superstar Ice Hockey och Thundercats 18/22
med ett DOS-jobb, en sektor som spår 18 inte har. Det är skyddets kontroll, och den är inte utredd här.

**Bangkok Knights eget format (System 3).** Spelet laddar motståndare och bakgrunder med en egen drivkod på `$0500`. Den
letar i en katalog som börjar på 11/0, med poster av typen `$82` och namnet som C64:an skickar, och följer sektorkedjor
som DOS:ens. Sektorerna läser den så här:

1. Söker spåret själv.
2. Letar upp huvudet genom att jämföra GCR-bytena, utan att vänta på SYNC.
3. Hoppar över 3 GCR-byte efter de 8 jämförda och läser sedan 326 GCR-byte.

Datablocket ligger alltså direkt efter huvudet, utan SYNC emellan, och DOS:en kan inte läsa det. Sektor 0 på spår 11 har
inte ens ett SYNC före huvudet: före huvudet finns bara nio 1-bitar. Den hittas bara genom inramningen från föregående
sektors SYNC, ett varv runt. Formatet ligger på spår 2–17 och 19–20.

Katalogen 11/0 → 11/8 → 11/16 har 18 filer, alla med rätt kontrollsumma och hela kedjor:

| Fil | Block | Laddar | Fil | Block | Laddar |
|---|---|---|---|---|---|
| BOOT | 4 | `$0600`–`$08FE` | MUGDEMO | 23 | `$B1F0`–`$C7FF` |
| S.CHU | 40 | `$44A8`–`$6B67` | Z.CHU | 11 | `$7568`–`$7FFF` |
| S.DAN | 43 | `$44A8`–`$6F27` | Z.DAN | 11 | `$7568`–`$7FFF` |
| S.BAMBO | 39 | `$44A8`–`$6A67` | Z.BAMBO | 11 | `$7568`–`$7FFF` |
| S.KALE | 38 | `$44A8`–`$69A7` | Z.KALE | 11 | `$7568`–`$7FFF` |
| CLIFF.SCRN | 26 | `$A700`–`$BFFF` | CLIFF.CHRS | 9 | `$C000`–`$C7FF` |
| SQUARE.SCRN | 26 | `$A700`–`$BFFF` | SQUARE.CHRS | 9 | `$C000`–`$C7FF` |
| JUNGLE.SCRN | 26 | `$A700`–`$BFFF` | JUNGLE.CHRS | 9 | `$C000`–`$C7FF` |
| MARKET.SCRN | 26 | `$A700`–`$BFFF` | MARKET.CHRS | 9 | `$C000`–`$C7FF` |

Katalogsektorn 11/16, den med MARKET, finns också som vanlig sektor på 18/7, utanför katalogkedjan. Spår 1 är ett vanligt
spår. Sektor 0 börjar med `CBM` och kod, troligen en C128-bootsektor, och resten är nollor. Det är inte utrett.

Bangkok Knights' fil 0 (`$BA00`) är en avkodare som körs med `JSR $BA80`. Fil 1 (`$0800`) packar upp introt med "PRESS
ANY KEY TO CONTINUE" till `$1000`. Fil 2 (`$0800`) packar upp spelet till `$9180`.
