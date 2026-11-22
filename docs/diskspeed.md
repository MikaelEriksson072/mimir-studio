# Disk-Speed – analys av bootet, drivkoden och filerna

Disk-Speed är ett kopieringsskydd med snabbladdare från Morse Technology Ltd. BAM:en på Elite säger det själv: *ELITE 64
USES THE 'DISK-SPEED' LOADING SYSTEM FROM MORSE TECHNOLOGY LIMITED*. Analysen gjordes 2026-11-22 på *Elite* (Firebird,
`Games/Preservers/Disc/E/Elite/Elite_ Gold Edition - Firebird.g64`). Koden kördes i Sindri och i VICE 3.10 (x64sc) och
jämfördes byte för byte. Sedan prövades läsningen på arkivets tre andra Disk-Speed-skivor. Det här dokumentet beskriver
vad skivan och koden gör. Spec 13.5p beskriver vad Mimir gör med det.

## Skivorna i arkivet

Arkivets 139 036 skivavbilder under `Games` söktes efter steg 1:s kod (`85 04 A5 04 30 FC 85 C1` och `20 34 F9` i
samma sektor) och efter BAM-texten. Fyra har den:

| Skiva | Boot | Filer i tabellen | Start | Nyckeln |
|---|---|---|---|---|
| Elite (Firebird), G64 | `GAME` 14/12 | PATCH `$033C`, OVER `$CE0E`, FILE1 `$4000`, 2NDBIT `$6A00`, 3RDBIT `$1D00` | `$CE27` | `$05` ur felen |
| Fighter Pilot (Digital Integration), G64 | `FP` 14/12 | FP1.1M `$0BC0`, FP1.2 `$B000`, FP3 `$E000` | `$0C00` | `$05` ur felen |
| Elite (tysk, OTD), D64 med felbyte | `GAME` 14/12 | fem namnlösa, `$033C` `$CE0E` `$4000` `$2000` `$6A00` | `$CE27` | `$05` ur felen |
| Elite (tysk, AEK), D64 med felbyte | annan första fil | samma fem | `$CE27` | `$05` ur felen |

Alla filers kontrollsummor stämmer på alla fyra. Den tyska Elite har ett annat FILE1 (`$4000-$895A`), ett
`$2000-$3F5C` i stället för 3RDBIT, och inga namn i tabellen. AEK:s crack har ett eget program först i katalogen, men
steg 1 och tabellen ligger kvar.

## Bootet

Katalogen listar en fil: `GAME`, 3 block på 14/12 → 14/2 → 14/13 med laddadressen `$0308`. BAM:en säger att nästan hela
skivan är ledig. Filerna ligger på sektorer som DOS:en tror är tomma.

`LOAD"GAME",8,1` lägger filen över KERNAL:ns vektorer `$0308-$0333`. IGONE (`$0308`) och BSOUT (`$0326`) pekar på
`$0334`, så det första BASIC gör efter laddningen (skriva `READY.`) startar bootet. Koden på `$0334`:

1. Släcker skärmen (`$D011 = $0B`).
2. Avkodar tre sidor av sig själv (`$035B-$065A`) med en slinga vars egen instruktion den först flyttar bitar i
   (`LSR $0349 / ROL $034A / ROR $034B`): instruktionen som avkodar byts innan slingan körs.
3. Öppnar buffert 2 i driven (`LISTEN 8`, `SECOND $F2`, namnet `#2`) och skickar `B-E 2 0 14 0` på kommandokanalen.
   DOS:en läser då 14/0 till `$0500` och kör den.
4. Tar emot filerna (se *Mottagningen*) och startar programmet med `RTS`.

Fighter Pilots boot är samma kod tio byte längre (den sparar och släcker spritarna först).

## Drivkoden, steg 1 (14/0, körs på `$0500`)

Steg 1 är okrypterad:

1. DOS-jobb `$80` (läs) på 14/3 med jobb 4, status till `$C1`. Sedan 14/14, status `AND $C1`. Båda sektorernas
   datablock har fel kontrollsumma på originalet, så båda ger status `$05`. Nyckeln är alltså `$05`.
2. DOS-jobb `$B0` (sök) till spår 36.
3. Läser 36/11 till `$0300` och 36/1 till `$0400` med egen kod: den gör om huvudet till GCR (`JSR $F934`) med skivans
   ID ur `$12/$13` och letar efter det, tar datablocket efter nästa SYNC och avkodar det med DOS:ens `$F8E0`.
4. EOR:ar `$0300-$04FF` med nyckeln och hoppar till `$0300`.

En kopia med rätta kontrollsummor på 14/3 och 14/14 får nyckeln `$01` och kör skräp. En kopia med bara 35 spår har
inget steg 2 alls.

14/11 och 14/1 har en kopia till av steg 2, krypterad med samma nyckel. Bara den sista byten (`$04FF`, oanvänd)
skiljer. Laddaren läser den aldrig.

## Drivkoden, steg 2 (36/11 och 36/1, körs på `$0300`)

1. Läser tabellen på 14/4 med DOS-jobb 4 till `$0700`. Läsrutinen försöker tre gånger, sedan `$C0` (bump) och `$B0`
   två omgångar. Går det inte skickar den `$FF` och blinkar med lampan för evigt.
2. Skickar tabellen: antalet filer, och för varje fil laddadressen (låg, hög), antalet byte i sista sektorn, antalet
   hela sektorer och en kontrollsumma.
3. Läser filerna med DOS-jobb 3 från 14/15. Efter varje sektor går den 11 sektorer vidare på ett spår om 21. När det
   slår runt till sektor 0 tar den spåret **nedanför** (`DEC $0C`). Elites filer går från 14/15 ner till 4/2.
4. Före varje sektor skickar den en nolla (en felflagga). En hel sektor skickas som två halvor om 128 byte. Sista
   sektorns byte skickas en och en.
5. Till sist skickar den startadressen minus 1 (hög, låg), släpper linjerna och hoppar till `$0503` i steg 1, som
   tömmer `$0300-$04FF` och går tillbaka till DOS:en (`JMP $D042`).

Steg 2 anropar sig självt genom 1541:ans RAM-spegel: `JSR $234E`, `JSR $2303` och felvägen `JMP $2459`. 1541:an
avkodar bara A15 och A10-A12, så RAM och VIA:erna på `$0000-$1FFF` finns också på `$2000`, `$4000` och `$6000`.

**Byten är inverterade på skivan.** Driven skickar en hel sektors byte som de är. En bit som är 1 drar linjen låg, och
C64:an läser en låg linje som 0. Sista sektorns byte EOR:as med `$FF` och skickas genom samma rutin som tabellen,
som själv EOR:ar en gång till. C64:an får alltså komplementet till varje filbyte på skivan, men tabellens byte som de
är.

Namnen i tabellen ligger från `$60`, 16 byte var och avslutade med 0: `PATCH`, `OVER`, `FILE1`, `2NDBIT`, `3RDBIT`
på Elite och `FP1.1M`, `FP1.2`, `FP3` på Fighter Pilot. Laddaren läser dem aldrig. Resten av sektorn (`$B0-$FF`) är kod
som blivit kvar från verktyget som gjorde skivan.

## Mottagningen på C64:an

Bytet tas emot två bitar i taget på CLK och DATA (`$DD00` bit 6 och 7). Driven väntar på att C64:an släpper DATA, och
C64:an väntar på driven på CLK:

- `$0400` tar emot en byte: släpper linjerna (`$DD00 = $27`), väntar på CLK, drar CLK (`$03`), väntar och läser bussen
  fyra gånger.
- `$0443` tar emot 128 byte till `$0680-$06FF` på samma sätt, med ramfärgen blinkande. `$0477` kopierar dem dit filen
  ska och räknar kontrollsumman (EOR) i `$02`.
- `$0489` tar emot antalet filer till `$BE`, och för varje fil adressen till `$FB/$FC`, byten i sista sektorn till `$FD`,
  antalet sidor till `$FE` och kontrollsumman till `$02`. Är felflaggan inte 0, eller blir `$02` inte 0, tömmer den
  skärmen, skriver en text ur BASIC-ROM:en (`$A369`) och står still.
- Elites boot anropar `$033C` när två filer återstår (`LDA $BE / CMP #$02 / BNE / JSR $033C`). Där ligger den första
  filen, PATCH. Fighter Pilots boot har inget sådant anrop.
- Efter sista filen läggs startadressen på stacken. `$0200` får kod som fyller laddaren (`$0334` och framåt) med
  mellanslag och ställer tillbaka IGONE, BSOUT och STOP, och `RTS` startar programmet.

## Elites filer

| Fil | Var | Sektorer | Vad |
|---|---|---|---|
| PATCH | `$033C-$0354` | 14/15 | sparar nollsidan till `$0600`, anropar `$7596` i FILE1 och lägger tillbaka nollsidan |
| OVER | `$CE0E-$CEFF` | 14/5 | startpunkten `$CE27`: stänger av CIA-avbrotten, väljer VIC-bank 1 och hoppar till `$1D22`; texten *IF YOU THINK YOU ARE THE FIRST TO HACK ELITE 64 THEN YOU'RE WRONG! DOUG TURNER BEAT YOU TO IT SUCKER !!* |
| FILE1 | `$4000-$865B` | 14/16 → 11/9 | spelets början; rutinen på `$7596` flyttar 22 sidor ner till `$0700` innan 2NDBIT laddar över `$6A00-$865B` |
| 2NDBIT | `$6A00-$CCE3` | 11/20 → 6/6 | krypterad av spelet självt |
| 3RDBIT | `$1D00-$3ED2` | 6/17 → 4/2 | avkodaren på `$1D22` och resten, krypterad |

Avkodaren på `$1D22` sparar nollsidan till `$CE00`. Den avkodar `$1D81-$3ED1` och `$6A00-$CCE2` bakifrån med en
löpande subtraktion (varje byte minus den förra avkodade, start `$36` och `$49`), anropar `$AAB2` och startar spelet på
`$886F`. Filerna i Disk-Speed-fliken är alltså som C64:an tar emot dem. Det färdiga spelet får man med Unpack på
`GAME`: Sindri kör bootet till `$886F` och sparar `$0308-$F8FF`.

## Sindri

Sindri stannade först i `$044A` och väntade på driven. Felet var att Sindris 1541 gav öppen buss på `$2000-$7FFF`, så
`JSR $234E` hamnade i skräp. Nu speglar den RAM och VIA:er där som den riktiga 1541:an (`drive.ts`, `read`/`write`).

- Med det laddar Sindri Elite till spelet (`$886F`) och Fighter Pilot till programmet (`$0C00`, som sedan väntar på
  `$C488`). Före ändringen stannade båda efter steg 1.
- Varje byte C64:ans lagringar (`STA ($FB),Y` på `$047E` och `$04D0`) skrev i Sindri, 52 254 byte, är i ordning och på
  adressen de byte läsaren ger.
- Gammal mot ny drive: 297 slumpvisa skivor ur `Games` och `Demos` körda, 4 rör `$2000-$7FFF` i driven (BeachHead II
  från Bitnappers, Hoaxagon, Seaworld, Panda Lovers). Alla fyra ger samma lager och samma sparade byte som förut.

## VICE

x64sc med `-drive8type 1541 +trapdevice8 -keybuf 'load"*",8,1\n'` och fjärrmonitorn (`-remotemonitor`): brytpunkter på
`$0346` (just före `JSR $7596`), `$CE27` och `$886F`, RAM sparat med `bank ram` och `save`. PATCH, OVER och FILE1 är
byte för byte läsarens vid `$0346`, 2NDBIT och 3RDBIT vid `$CE27`, och spelet når `$886F`.

## Inte gjort

Spåren 37-40 på G64:orna är brus (långa SYNC, inga sektorer). Varken drivkoden eller C64:an läser dem. Om spelet
senare kontrollerar skivan igen är inte utrett.
