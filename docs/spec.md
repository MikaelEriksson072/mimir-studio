# Mimir Studio — teknisk specifikation

<p class="lead">En professionell arbetsmiljö för att analysera Commodore 64-program (<code>.prg</code>) och återskapa dem som ren, strukturerad och kompilerbar Kick Assembler-källkod — med byte-exakt verifiering och direkt koppling till VICE.</p>

**Version** 1.0 · **Datum** 2026-10-18 · **Status** arkitekturprototyp (den här filen) + produktionsspecifikation

## 1. Sammanfattning

Mimir Studio är en desktop-applikation (Electron + React + TypeScript + Tailwind CSS) med ett mörkt, IDE-inspirerat gränssnitt. Den har tre huvudsyften:

1. **Djupgående analys.** Laddade PRG-filer disassembleras och varje byte i C64-minnet klassificeras som kod, grafik (bitmap, teckensnitt, sprites, skärmmatris), musik (SID), tabeller, text eller övrig data.
2. **Intelligent symbol- och adresshantering.** Hårdvaruregister (VIC-II, SID, CIA 1/2), KERNAL-rutiner, vektorer och systemvariabler får läsbara namn. Användaren döper om etiketter, kommenterar och ändrar blocktyper interaktivt, och allt slår igenom överallt direkt.
3. **Kick Assembler-export och arbetsflöde.** Projektet exporteras som ett välorganiserat Kick Assembler-projekt (`.asm`, `include/`, `gfx/*.bin`, `music/*.sid`, byggskript) som kompileras och startas i VICE (`x64sc`) med ett klick.

Fyra designprinciper bär hela arkitekturen:

| Princip | Innebörd |
|---|---|
| **Byte-exakt round-trip som kvalitetsgrind** | Varje export assembleras om och jämförs byte för byte med originalet innan den räknas som klar. Allt som analysen inte förstår exporteras som data, så resultatet är alltid korrekt även när det inte är vackert. |
| **En linjemodell, två vyer** | Samma radmodell (`Line[]`) driver både den interaktiva listningen och den genererade källkoden. Det som syns i listningen är exakt det som exporteras. |
| **Förklarbar heuristik** | Varje block bär sin evidens ("sprite pointer $07f8 = $80"), en konfidensnivå och kan granskas i Inspektorn. Inga svarta lådor. |
| **Användaren har sista ordet** | Automatisk analys < heuristik < användarens overrides. Overrides lagras som en ordnad lista och analysen körs om deterministiskt efter varje ändring. |

## 2. Mål, målgrupp och avgränsningar

**Målgrupp:** demoscenare som vill studera eller återanvända gammal kod, reverse engineers och crackers, spelutvecklare som moddar gamla titlar, samt musik- och grafikrippare.

**Mätbara mål för v1**

| Mål | Kriterium |
|---|---|
| Korrekthet | 100 % byte-exakt round-trip på testkorpusen (≥ 500 PRG från CSDb, spel, demos, intron, musikfiler). |
| Kodtäckning | ≥ 95 % av den kod som körs i VICE från startpunkten hittas automatiskt i okomprimerade demos (mätt med VICE-trace). |
| Läsbarhet | Hårdvaruåtkomster, KERNAL-anrop och IRQ-uppsättning visas symboliskt i ≥ 99 % av fallen. |
| Prestanda | Full analys av 64 KB under 50 ms i worker; listning 60 fps vid scrollning. |
| Arbetsflöde | Från PRG till körande om-assemblerat program i VICE på under 30 sekunder för en ny användare. |

**Icke-mål i v1:** ingen inbyggd emulator (VICE används), ingen automatisk uppackning av komprimerade program (detekteras och rapporteras; uppackning med ett klick med Sindri, den inbyggda uppackaren, 8.11b, eller ett externt verktyg som unp64), ingen export till andra assemblers än Kick Assembler och 64tass (11.8; ACME och ca65 ligger på roadmap), inget stöd för cartridge-format (`.crt`) och diskavbilder (`.d64`) i v1 — `.d64`-import kommer i M5.

## 3. Teknikstack

| Del | Val | Motivering |
|---|---|---|
| Skal | **Electron 33+** (`contextIsolation`, `sandbox`) | Ett fönster, native filsystem, kan starta `java` och `x64sc`, plattformsoberoende. |
| UI | **React 18** + **TypeScript 5** (strict) | Komponentmodell som passar en IDE, stort ekosystem, typad domänmodell delas med kärnan. |
| Styling | **Tailwind CSS 3.4** med designtokens som CSS-variabler | Snabb, konsekvent styling. Tokens (`--bg`, `--accent`, `--g-code` …) mappas i `tailwind.config` så att mörkt/ljust tema byts i ett ställe. |
| Editor | **Monaco 0.45+** | Samma motor som VS Code: egen Kick Assembler-språkdefinition, hover, gå-till-definition, minimap, sök. |
| State | **Zustand** + **Immer** (patches för undo/redo) | Lättviktigt, selektorer utan onödiga omritningar, patch-baserad historik. |
| Analys | **@mimir/core** i en **Web Worker** via **Comlink** | Ren TypeScript utan DOM. Körs i worker (UI blockeras aldrig), i Node för tester och CLI. |
| Bygg | **electron-vite**, **electron-builder** | Snabb HMR i utveckling, signerade installationsfiler för Windows/macOS/Linux. |
| Test | **Vitest**, **Playwright for Electron**, **fast-check** | Enhetstester, end-to-end i den riktiga appen, egenskapsbaserade tester för disassembler och round-trip. |

**Om prototypen:** den här enfilsversionen använder samma designtokens i ren CSS i stället för Tailwind-runtime, och kärnan körs synkront i huvudtråden (den är snabb nog: ~20 ms för demot). Strukturen i koden motsvarar paketen ovan.

## 4. Systemarkitektur

<div class="diagram">
<svg viewBox="0 0 960 430" role="img" aria-label="Processmodell: renderer med UI och store, analysworker med kärnan, preload-brygga, huvudprocess med filsystem och toolchain, samt externa KickAss.jar och VICE x64sc">
<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-head"/></marker></defs>
<rect x="20" y="40" width="330" height="230" rx="10" class="dg-box dg-main"/>
<text x="38" y="68" class="dg-t">Renderer-process (React)</text>
<text x="38" y="92" class="dg-s">Listing · Monaco · Inspektor · Paneler</text>
<rect x="38" y="108" width="294" height="54" rx="7" class="dg-inner"/>
<text x="52" y="130" class="dg-t2">Store (Zustand + Immer)</text>
<text x="52" y="149" class="dg-s">Project · overrides · undo/redo · UI-state</text>
<rect x="38" y="174" width="294" height="78" rx="7" class="dg-inner"/>
<text x="52" y="196" class="dg-t2">Vyer på samma linjemodell</text>
<text x="52" y="215" class="dg-s">Listning (virtualiserad) · Monaco (kickass)</text>
<text x="52" y="233" class="dg-s">Heatmap · grafikförhandsvisning · xrefs</text>
<rect x="20" y="320" width="330" height="92" rx="10" class="dg-box"/>
<text x="38" y="348" class="dg-t">Analysworker · @mimir/core</text>
<text x="38" y="372" class="dg-s">decode · trace · evidens · musik/VIC</text>
<text x="38" y="391" class="dg-s">klassificering · render (Kick) · verify</text>
<rect x="398" y="110" width="140" height="110" rx="10" class="dg-box"/>
<text x="414" y="138" class="dg-t">Preload</text>
<text x="414" y="160" class="dg-s">contextBridge</text>
<text x="414" y="178" class="dg-s">window.kr (typat</text>
<text x="414" y="196" class="dg-s">IPC-API)</text>
<rect x="586" y="40" width="190" height="230" rx="10" class="dg-box"/>
<text x="602" y="68" class="dg-t">Huvudprocess</text>
<text x="602" y="96" class="dg-s">Projekt-FS (.mimir)</text>
<text x="602" y="118" class="dg-s">Inställningar</text>
<text x="602" y="140" class="dg-s">Toolchain-runner</text>
<text x="602" y="162" class="dg-s">VICE monitor-klient</text>
<text x="602" y="184" class="dg-s">Fil-watcher</text>
<rect x="818" y="52" width="124" height="70" rx="10" class="dg-box dg-ext"/>
<text x="834" y="80" class="dg-t">KickAss.jar</text>
<text x="834" y="102" class="dg-s">java -jar</text>
<rect x="818" y="182" width="124" height="70" rx="10" class="dg-box dg-ext"/>
<text x="834" y="210" class="dg-t">VICE x64sc</text>
<text x="834" y="232" class="dg-s">-autostart</text>
<line x1="350" y1="165" x2="396" y2="165" class="dg-arrow" marker-end="url(#arw)" marker-start="url(#arw)"/>
<line x1="538" y1="165" x2="584" y2="165" class="dg-arrow" marker-end="url(#arw)" marker-start="url(#arw)"/>
<text x="356" y="155" class="dg-s">invoke</text>
<text x="545" y="155" class="dg-s">IPC</text>
<line x1="776" y1="87" x2="816" y2="87" class="dg-arrow" marker-end="url(#arw)"/>
<line x1="776" y1="210" x2="816" y2="210" class="dg-arrow" marker-end="url(#arw)"/>
<line x1="816" y1="232" x2="776" y2="232" class="dg-arrow" marker-end="url(#arw)"/>
<text x="780" y="78" class="dg-s">spawn</text>
<text x="780" y="200" class="dg-s">spawn</text>
<text x="770" y="256" class="dg-s">TCP 6502</text>
<line x1="150" y1="270" x2="150" y2="318" class="dg-arrow" marker-end="url(#arw)"/>
<line x1="220" y1="318" x2="220" y2="270" class="dg-arrow" marker-end="url(#arw)"/>
<text x="64" y="300" class="dg-s">Project</text>
<text x="228" y="300" class="dg-s">AnalysisResult + Line[]</text>
</svg>
</div>

### 4.1 Processer och ansvar

| Process | Ansvar | Får inte |
|---|---|---|
| **Huvudprocess** (Node) | Fönster, menyer, filsystem (öppna/spara projekt, exportera), inställningar (`electron-store`), starta KickAss och VICE via `child_process.spawn` (utan shell), VICE binary monitor (TCP), fil-watcher för exporterade projekt. | Tolka analysresultat eller rita UI. |
| **Preload** | Exponera ett smalt, typat API (`window.kr`) via `contextBridge`. Validerar argument. | Exponera `ipcRenderer` eller Node-API direkt. |
| **Renderer** | Hela UI:t, store, Monaco, kortkommandon. Skickar `Project` till worker och tar emot resultat. | Röra filsystemet eller starta processer. |
| **Analysworker** | Kör `@mimir/core`: `analyze()`, `render()`, `verify()`. Ren beräkning, deterministisk. | Ha sidoeffekter eller I/O. |

### 4.2 Säkerhet

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Strikt CSP i renderern: inga fjärrskript; Monaco och typsnitt paketeras lokalt.
- IPC-kanaler är en uttömmande allowlist (se 13.4). Sökvägar normaliseras och begränsas till användarvalda projektmappar; körbara filer (`java`, `x64sc`) anges explicit i inställningarna och startas med argumentlista, aldrig via shell-strängar.
- Projektfiler är JSON med schema-validering (zod) vid inläsning.
- Fildialogerna (Open PRG, Mount D64, Smart attach, projekt, Export) öppnas i den mapp där samma slags dialog senast användes, annars
  där någon dialog senast användes. Mapparna sparas i `recent-folders.json` i användardatamappen och gäller även efter
  en omstart (`electron/main/recent.ts`). En mapp som inte längre finns hoppas över. Exportdialogen öppnas i mappen
  runt den senaste exporten. Minnet anger bara var dialogen börjar: åtkomst får appen fortfarande bara till det
  användaren väljer.

### 4.3 Dataflöde

```
Project (filer, overrides, etiketter, kommentarer, inställningar)
   │  postMessage (Comlink)                     ← varje ändring, debounce 30 ms
   ▼
analyze(project)  →  AnalysisResult (minnesbild, instruktioner, xrefs, block, evidens, logg)
   │
render(result, project)  →  { lines: Line[], files: { "main.asm": "...", "music/…sid": Uint8Array, … } }
   │
   ├─▶ Listning (virtualiserad, interaktiv)      ├─▶ Monaco (samma text, radkarta för synk)
   ├─▶ Inspektor / heatmap / förhandsvisning      └─▶ Export (ZIP / mapp) + verify()
```

Etiketter och kommentarer påverkar bara `render()`, inte `analyze()`, så omdöpningar är omedelbara även för stora program. Overrides och inställningar kör om hela kedjan (fortfarande < 50 ms).

## 5. Kodbas och katalogstruktur

```
mimir-studio/
├─ apps/desktop/
│  ├─ electron/
│  │  ├─ main/index.ts            fönster, meny, livscykel
│  │  ├─ main/ipc.ts              registrering av IPC-kanaler (allowlist)
│  │  ├─ main/toolchain.ts        KickAss- och VICE-körning, felparsning
│  │  ├─ main/vice-monitor.ts     binary monitor-protokoll (TCP 6502)
│  │  ├─ main/project-fs.ts       öppna/spara .mimir, exportera projektmapp
│  │  └─ preload/index.ts         contextBridge → window.kr
│  └─ src/                        renderer
│     ├─ App.tsx
│     ├─ store/{project.ts, ui.ts, history.ts}
│     ├─ workers/analysis.worker.ts
│     ├─ components/{TitleBar, ActivityBar, Sidebar, Listing, SourceView,
│     │              Inspector, Heatmap, GfxPreview, BottomPanel, StatusBar,
│     │              CommandPalette, Settings, ContextMenu}.tsx
│     ├─ monaco/{kickass-language.ts, theme.ts, providers.ts}
│     └─ styles/{tokens.css, tailwind.css}
├─ packages/core/
│  ├─ src/cpu/{opcodes.ts, decode.ts}
│  ├─ src/c64/{symbols.ts, basic.ts, prg.ts, psid.ts}
│  ├─ src/analyze/{memory.ts, trace.ts, evidence.ts, pointers.ts, music.ts,
│  │               vic.ts, classify.ts, labels.ts, diagnostics.ts, index.ts}
│  ├─ src/render/{lines.ts, kick.ts, include.ts}
│  ├─ src/verify/{kick-subset-assembler.ts, verify.ts}
│  ├─ src/script.ts                användarens skript: kontroll och körning i Sindris 6510 (10.3)
│  ├─ src/script-templates.ts      skriptmallarna: dekryptering och kryptering som spelen gör (10.3)
│  ├─ src/script-sid.ts            SID-musiken för ett JavaScript-skript: `sid` (programmets låtar, .sid-filer, spelaren körd bild för bild, spela i VICE/DeepSID) (10.3)
│  ├─ src/script-build.ts          bygge och körning för ett JavaScript-skript: `build` (senaste bygget, Verify, Build & Run, starta en PRG) (10.3)
│  ├─ src/script-export.ts         exporten för ett JavaScript-skript: `exporter` (läs, ändra, lägg till, skriv) (10.3)
│  ├─ src/script-loader.ts         loadern för ett JavaScript-skript: `loader` (loaderflikens filer, grupper, skript) (10.3)
│  ├─ src/script-brokkr.ts         Brokkr för ett JavaScript-skript: `brokkr` (packa, kruncha, avkruncha) (10.3)
│  ├─ src/script-sindri.ts         Sindri för ett JavaScript-skript: `sindri` (uppackaren, en hel C64, disassemblering) (10.3)
│  ├─ src/script-templates-js.ts   skriptmallarna i JavaScript: exempel på vad språket är bra på (10.3)
│  ├─ src/script-watch.ts          skriptets watch-lista: det koden skriver, hittat i koden, och värdena (10.3)
│  ├─ src/script-files.ts          ett skript kört på filer: filen i en scratchpad, och vad körningen ger som filer (10.3)
│  ├─ src/script-suggest.ts        skript som analysen föreslår: dekrypteringsloopar och rutinanrop (10.3)
│  ├─ src/script-machine.ts        ett skript kört i hela C64:an: ROM, I/O, avbrott och 1541 med disken (10.3)
│  ├─ src/script-actions.ts        skriptens egna direktiv: .mark, .name, .note och .junk (10.3)
│  ├─ src/script-js.ts             skript i JavaScript: mem, addr, pad, cpu.call, disk (10.3)
│  ├─ src/script-params.ts         skriptets inställningar ur koden, och en tabell av värden att köra med (10.3)
│  ├─ src/script-file.ts           ett skript som fil: koden med en huvudrad, och om det passar ett program (10.3)
│  ├─ src/script-hooks.ts          skriptets tangent, och körning på det byggda programmet före Build & Run (10.3)
│  └─ test/{opcodes.test.ts, trace.test.ts, roundtrip.test.ts, fuzz.test.ts}
├─ packages/cli/                  mimir analyse|export|verify|unpack|measure (Node, för CI och batch)
├─ packages/sindri/               Sindri, den inbyggda uppackaren: en emulerad C64 som följer ett packat program genom sina lager
├─ fixtures/{prg/, golden/}       testkorpus + förväntade .asm
└─ docs/
```

Prototypens sektioner motsvarar dessa filer: `1. OPCODE TABLE` → `cpu/opcodes.ts`, `2. C64 SYMBOL DATABASE` → `c64/symbols.ts`, `5. ANALYSIS ENGINE` → `analyze/*`, `6. RENDERING` → `render/*`, `7. VERIFIER` → `verify/*`, React-delen → `apps/desktop/src`.

## 6. Datamodell

```ts
type Addr = number;                       // 0x0000–0xffff

interface Project {
  format: 'mimir-project'; version: 1;
  name: string;
  files: LoadedFile[];                    // en eller flera PRG
  overrides: Override[];                  // ordnad lista, senare vinner
  entries: Addr[];                        // användarens extra startpunkter
  entryPoint: Addr | null;                // programstart satt av användaren (null: BASIC SYS eller laddadressen), 8.2
  labels: Record<Addr, string>;           // användarens namn (tom sträng = återställ)
  comments: Record<Addr, string>;         // kommentar i slutet av raden
  blockComments: Record<Addr, string>;    // kommentarer ovanför block (en // per textrad)
  notes: Record<Addr, Note>;              // egna kommentarrader och kommentarblock ovanför en adress
  blanks?: Record<Addr, number>;          // egna tomma rader ovanför en adress, hur många (saknas: inga)
  bookmarks: Record<Addr, Bookmark>;      // bokmärken: titel och anteckning per adress, skrivs aldrig till källkoden (10)
  bankZones: BankZone[];                  // ordnad lista, senare vinner: vad koden i ett intervall körs med
  relocs: Reloc[];                        // byte som programmet kopierar till en annan adress och kör där (8.1b)
  excluded: Addr[];                       // starten på block som lämnas utanför bygget (11.5)
  binary: Addr[];                         // starten på block som sparas som binärfil (11.6)
  junk?: JunkArea[];                      // skräp: byte som lämnas utanför allt, {start, end} med end exklusivt (11.7)
  userScripts?: UserScript[];             // användarens skript: koden exporteras aldrig, det de ändrar blir patchar (10.3)
  settings: Settings;
}

interface UserScript {                    // se 10.3
  id: string; name: string;               // namnet är unikt i projektet
  lang: 'kickass';                        // Kick Assembler; fler språk (Python) kan komma
  code?: 'js';                            // koden är JavaScript (script-js.ts); lang är då bara scratchpadsens språk
  source: string;
  pads: ScriptPad[];                      // skriptets egna scratchpads (data utanför programmet, t.ex. en logg)
  links?: Addr[];                         // adresser i programmet länkade till skriptet (högerklick i .asm); visas med namnet (linkName)
  watch?: { expr: string; size?: number; ptr?: boolean }[];  // egna rader i watch-listan (det skriptet skriver hittas i koden)
  unwatch?: string[];                     // rader listan hittat i koden som tagits bort, med operanden som koden skriver den
}                                         // id sparas i .mimir.json: patcharna med Patch.script pekar på det

interface Patch {                         // som i 10.2, och:
  script?: string;                        // id för skriptet vars körning skrev byten (10.3); saknas: användarens patch
}

interface ScriptPad {
  name: string;                           // en etikett i koden; name_end är adressen efter den
  start: Addr; size: number;              // där den ligger medan skriptet körs, och hur stor den är
  fill?: number;                          // byten den har när en körning börjar (saknas: 0)
  bytes?: Uint8Array;                     // vad senaste körningen lämnade i den (base64 i .mimir.json)
}

interface Note {
  text: string;                           // flera rader tillåtna
  block?: boolean;                        // true: ett /* … */-block, annars en // per textrad
  below?: number;                         // tomma rader mellan kommentaren och raden (blanks står ovanför den)
}

interface Bookmark {
  title: string;                          // högst 200 tecken; standard: etiketten på adressen, annars $xxxx
  text: string;                           // anteckningen, flera rader tillåtna (högst 20 000 tecken)
  color?: string;                         // en förinställd färg (amber, orange, …) eller #rrggbb; saknas: amber
  end?: Addr;                             // ett bokmärke på ett område slutar här (exklusiv); nyckeln är dess första byte
}

interface BankZone {                      // se 8.7b
  start: Addr; end: Addr;
  port?: number | null;                   // värdet på $01 (bit 0–2 räknas); null = tillbaka till detektering
  vicBank?: number | null;                // VIC-bank 0–3; null = tillbaka till detektering
}

interface Reloc {                         // se 8.1b
  start: Addr; end: Addr;                 // där byten ligger i filen (end exklusiv)
  to: Addr;                               // där de körs
}

interface LoadedFile { id: string; name: string; load: Addr; bytes: Uint8Array; }

type BlockKind = 'code' | 'data' | 'words' | 'text' | 'table' | 'lohi' | 'sprite'
               | 'charset' | 'bitmap' | 'screen' | 'music' | 'fill' | 'basic'
               | 'reloc';                 // där ett flyttat block ligger (8.1b)

interface Override {
  start: Addr; end: Addr;                 // end exklusiv
  type: BlockKind | 'auto';               // 'auto' = rensa overrides i intervallet
  props?: { enc?: 'petscii' | 'screen'; row?: number; fmt?: 'hex' | 'bin' | 'dec';
            init?: Addr; play?: Addr };
}

interface Block {
  id: number; start: Addr; end: Addr; type: BlockKind; file: number;
  props: Record<string, unknown>;
  conf: number;                           // 0–1
  reason: string;                         // evidens i klartext, visas i Inspektorn
  user: boolean;                          // satt av användaren
  entropy: number;                        // bitar/byte
  hint?: 'code';                          // t.ex. "trolig oupptäckt kod"
}

interface XRef { from: Addr; kind: 'call' | 'jump' | 'branch' | 'read' | 'write' | 'rmw' | 'ptr'; }

interface AnalysisResult {
  mem: Uint8Array; owner: Int16Array;     // minnesbild + vilken fil som äger byten
  insLen: Uint8Array; codeOwner: Int32Array;
  xrefs: Map<Addr, XRef[]>;
  entryKind: Map<Addr, 'entry' | 'irq' | 'nmi' | 'brk' | 'sub' | 'ptr' | 'user' | 'jmp' | 'branch'>;
  blocks: Block[]; labels: Map<Addr, { name: string; kind: string }>;
  hints: Map<Addr, { kind: 'lo' | 'hi'; target: Addr }>;   // #<label / #>label
  music: MusicInfo[]; vic: VicEvidence; log: LogEntry[]; stats: Stats;
}

type Token = { t: 'lbl' | 'hw' | 'kw' | 'num' | 'str' | 'dir' | 'def' | 'p'; s: string; to?: Addr };
type Line =
  | { k: 'hdr'; a: Addr; blk: number; type: number; text: string }
  | { k: 'lbl'; a: Addr; name: string }
  | { k: 'ins'; a: Addr; n: number; mn: string; ext: '' | '.abs' | '.zp'; tok: Token[]; cmt: string }
  | { k: 'dat'; a: Addr; n: number; dir: '.byte' | '.word' | '.text'; tok: Token[]; cmt: string }
  | { k: 'dir'; a: Addr; n: number; tok: Token[]; cmt?: string }
  | { k: 'cmt'; a: Addr; text: string } | { k: 'blank'; a: Addr };
```

`Line` är kärnan i "en linjemodell, två vyer": listningen renderar tokens interaktivt (klickbara etiketter, hover på register), exporten gör `tokens.map(t => t.s).join('')` med formatteringsregler. Varje rad bär adress och bytelängd, vilket ger exakt synk mellan listning, Monaco och heatmap.

## 7. Disassemblermotorn (6502/6510)

### 7.1 Opkodstabell

Alla 256 opkoder är tabellstyrda. Varje post: `mnemonic`, adresseringsläge, längd, `ill` (odokumenterad), `unstable`, flödesklass (`seq`, `br`, `jmp`, `jmpi`, `jsr`, `ret`, `brk`, `jam`), minnesåtkomst (`read`, `write`, `rmw`) och `kick` (om Kick Assembler kan uttrycka den med mnemonic).

| Läge | Syntax | Längd | Exempel |
|---|---|---|---|
| implied / accumulator | `rts`, `asl` | 1 | `0a` |
| immediate | `#$nn` | 2 | `a9 00` |
| zero page (,x / ,y) | `$nn`, `$nn,x` | 2 | `a5 fb` |
| (indirect,x) / (indirect),y | `($nn,x)`, `($nn),y` | 2 | `b1 fb` |
| relative | `label` | 2 | `d0 fa` |
| absolute (,x / ,y) | `$nnnn`, `$nnnn,x` | 3 | `8d 20 d0` |
| indirect | `($nnnn)` | 3 | `6c fb 00` |

### 7.2 Odokumenterade opkoder

| Namn | Opkoder (urval) | Kick-mnemonic | Stabil | Exportpolicy |
|---|---|---|---|---|
| SLO, RLA, SRE, RRA | `$03…$1f`, `$23…`, `$43…`, `$63…` | `slo` `rla` `sre` `rra` | ja | mnemonic |
| SAX, LAX | `$83 $87 $8f $97`, `$a3 $a7 $af $b3 $b7 $bf` | `sax` `lax` | ja | mnemonic |
| DCP, ISC | `$c3…$df`, `$e3…$ff` | `dcp` `isc` | ja | mnemonic |
| ANC, ALR, ARR, AXS | `$0b`, `$4b`, `$6b`, `$cb` | `anc` `alr` `arr` `axs` | ja | mnemonic |
| ANC (dubblett), SBC `$eb` | `$2b`, `$eb` | — | ja | `.byte` + kommentar |
| NOP-varianter | `$04 $0c $14 $1a $1c $80 $82 …` | — | ja | `.byte` (flera kodningar per mnemonic) |
| XAA, LAX #imm, AHX, TAS, SHX, SHY, LAS | `$8b $ab $93 $9f $9b $9e $9c $bb` | — | **nej** | `.byte` + varning |
| JAM (KIL) | `$02 $12 $22 … $f2` | — | — | stoppar spårning, rapporteras som fel |

Principen: allt som har mer än en möjlig kodning, eller vars beteende är instabilt, exporteras som `.byte` med en kommentar som visar mnemonic. Då är round-trip garanterad oavsett assemblerversion.

**Vad de gör:** när pekaren står på en odokumenterad opkod visas en kort beskrivning (`undocumentedText()`,
`packages/core/src/cpu/undocumented.ts`). Den har mnemonic, opkod och adresseringsläge, andra namn (`isc` heter också
`isb`), vad den gör i en mening och som formel, vilka flaggor den ändrar (N V Z C, eller *none change*) och, för de
instabila, varför. I listningen sitter den på mnemonic och, för en opkod som skrivs som `.byte`, på `.byte` och
kommentaren. I källkodsfliken visar Monaco samma text när pekaren står på mnemonic, också i en kommentar.

### 7.3 Kantfall

| Fall | Hantering |
|---|---|
| Adress-wrap vid `$ffff` | All adressaritmetik är `& $ffff`; en instruktion som korsar filslutet spåras inte. |
| BIT-skip (`.byte $2c`) | När ett hopp landar på byte 2 i en `BIT abs`/`BIT zp` konverteras BIT-instruktionen till en 1-byte "skip" och den gömda instruktionen spåras. Exporteras som `.byte $2c // bit abs: skips the next 2-byte instruction`. Fungerar i båda spårningsordningarna. |
| Överlappande instruktioner (övrigt) | Spåras inte; varning i Problems med båda adresserna. |
| Självmodifierande kod | Skrivningar in i en instruktion detekteras; instruktionen får en etikett (`smc_xxxx`) och skrivande kod refererar `smc_xxxx+1`. Kommentar på målinstruktionen. |
| Inline-data efter JSR | Om målrutinen börjar med `PLA / STA zp / PLA` (hämtar returadressen) fortsätter spårningen inte efter JSR. |
| BRK | Avslutar kodvägen, varning. |
| JAM | Avslutar kodvägen, fel ("probably runs into data"). |

## 8. Analysmotorn och heuristiker

Analysen är en deterministisk pipeline. Varje steg är O(n) över max 64 KB och hela kedjan körs om vid varje override.

### 8.1 Minnesbild

Alla filer läggs i en 64 KB-bild; `owner[addr]` anger vilken fil som äger byten (senare fil vinner vid överlapp, med varning). Flera filer analyseras tillsammans, så korsreferenser mellan t.ex. `main.prg` och `music.prg` löses upp.

### 8.1b Flyttade block (relokering)

Program kopierar ofta kod till en annan adress innan den körs där: en överföringsrutin till kassettbufferten
(`$033c`) eller skärmen som laddar nästa del, kod under KERNAL eller i nollsidan. Byten ligger då på en adress i filen
och körs på en annan, och koden i dem är skriven för den andra (`jmp $2000`, inte `jmp $1000`). Ett flyttat block
(`Project.relocs`: `start`–`end` i filen körs på `to`) gör att analysen läser dem där de körs:

- **Minnesbilden.** Efter filerna läggs en kopia av byten på `to` (`placeRelocs`). Under analysen ägs kopian av
  `files.length + k`, så att ingen instruktion och inget block går från den in i andra byte; i resultatet ägs den av
  filen byten är från, och `AnalysisResult.relocs` säger var varje block är laddat och körs. Där byten är laddade är de
  ett block av typen *Relocated* (`T.RELOC`, typen vinner över allt som markerats där) med en etikett (`reloc_1000`);
  spårningen går inte in där, och en kodväg som gör det får en varning som säger var koden körs. Referenser till
  laddplatsen skrivs från blockets etikett (`lda reloc_1000+5`, hur långt in det än är).
- **Villkor.** Byten ska vara ett stycke av en fil, eller av ett annat flyttat blocks kopia (ett block flyttat igen
  därifrån; de läggs ut i omgångar), och där de körs får ingenting vara laddat, varken en fil, ett annat flyttat block
  eller blockets egna byte. Ett block som inte kan läggas ut står i loggen med skälet. Kopieringsloopens
  `sta $2000,x` från blockets byte är kopieringen, inte självmodifierande kod. I en cartridge körs blocket i banken
  det är laddat i (13.9b).
- **Källkoden.** Blocken där det körs skrivs där byten är laddade, i `.pseudopc to { … }`: etiketten för laddplatsen
  före, inga `.pc` inuti (musik utan sin `.pc = music.location`), och `}` efter. Kick Assembler kan inte nästla
  `.pseudopc`, så ett block flyttat igen inifrån ett annat pausar det: `}`, blockets etikett som `.label`, dess egen
  `.pseudopc`, och sedan `.pseudopc` där det första fortsätter. Filhuvudet listar filens flyttade block. Hela blocket
  kan lämnas utanför bygget (11.5) eller sparas som binärfil (11.6, etiketterna där det körs blir `.label`); ett block
  där det körs kan inte lämnas utanför för sig. Den inbyggda assemblern klarar `.pseudopc`, och KickAss.jar bygger
  alltihop byte för byte (`kickass.integration.test.ts`).
- **Upptäckt.** `findCopies` hittar loopar `lda src,x / sta dst,x` (eller `,y`), flera par en sida isär blir ett
  block, där indexregistrets start (`ldx #`) och slut (`dex/bpl`, `dex/bne`, `inx/bne`, `inx/cpx #/bne`, `bcc`) går
  att läsa, kopian hamnar där ingenting är laddat, och koden hoppar eller anropar dit. Där hoppet går in ska byten
  vara en rutin (inte text, inte NOP), och kod som programmet går in i där den är laddad (en loop som kopierar några
  byte mer än sin rutin, in i en subrutin) hålls utanför. Av kopior till samma plats vinner den som hoppet följer
  direkt efter (en text som kopieras till skärmen på `$0400` går ofta dit också). Varje kopia blir ett tips i
  Problems med *Relocate…* och en rad i fliken *Relocated*. På 284 intros ur CSDB:s samling (uppackade med Sindri först) hittas 101 i 98 av dem, och varenda
  en assembleras byte för byte när den flyttas. En körning av Sindri vars enda lager flyttar kod dit ett flyttat (eller
  föreslaget) block körs ger ingen packningsnotis (8.11b).
- **Över byte som filen har där** (`RelocCopy.over`). Ett program som Sindri sparat efter att det kört har kvar det som
  låg där när det sparades: The Last Ninja +Triad, uppackad till fuskmenyn (`$0400-$fff7`, start `$c857`), har introts
  skärm på `$0400`, och menyns start kopierar laddaren från `$ca00-$cbff` dit (`$c845`) innan spelet anropar den
  (`jsr $0400` på `$cf6c`). Spårningen gick in i skärmens mellanslag (`jsr $2020` om och om igen) och laddaren hittades
  inte. En kopia dit något är laddat räknas när byten där hoppet går in inte är kod (BRK, JAM, en odokumenterad opkod
  eller samma instruktion tre gånger i rad bland de fem första) och den kopierade koden pekar in där den körs (`jsr`,
  `jmp`, `lda`… dit) oftare än dit den är laddad, eller byten där är en fyllnad (16 lika) och koden inte pekar dit den är
  laddad. Inget av det programmet självt kör där får finnas: ingen programstart, avbrottsrutin eller ingång som
  användaren satt, och inget annat som hoppar, anropar eller grenar dit utifrån än hopp som kopian förklarar (Eldorado
  kopierar till `$0800` över sin egen start på `$0812`, Vicious Sid 2 har sin start `jmp $9000` på `$0400`). Tipset
  säger att byten där blir skräp, och *Relocate…* gör dem till junk (11.7) i samma steg som blocket flyttas
  (`relocProblem(…, over)`, `fileBytesIn()`); Ctrl+Z tar tillbaka båda. På 428 uppackade program (Year-top20 rank 1–6 och
  Onefile-top200) ger regeln 8 nya kopior i 8 program (laddare och flyttrutiner till `$0180`, `$0334`, `$0358`, `$0400`,
  `$0801`, `$0cd4`, `$8000`); av de 31 som en regel utan bevisen ovan gav var bland annat en teckenuppsättning och
  programmens egen kod.

### 8.2 Startpunkter

0. **Programstart satt av användaren** (`entryPoint`; Explorer → *Program start*, högerklick → *Program* → *Set as program start*): blir `start`, spårningen börjar där och `$01` antas vara `$37` där (8.7b). En BASIC-stubs `SYS`-adress spåras ändå (den heter då `entry_xxxx` och `BasicUpstart2()` pekar dit), men laddadressen används inte längre. En adress utanför de laddade filerna ger en varning och den detekterade starten.
   **Clear** (Explorer, högerklick → *Program* → *Clear program start*, kommandopaletten) nollställer den: analysen använder den
   detekterade starten igen och Build & Run startar programmet med RUN, utan någon startadress (13.2). Explorer visar
   alltid hur Build & Run startar det: med RUN, med `sys <start>` eller från monitorn, och varnar när RUN inte kan
   fungera (en PRG över `$0002-$03ff` utan start, eller en start i en annan fil än den som körs).
1. **BASIC-stub** vid `$0801`: radlänkar valideras, tokens avkodas (`10 SYS2064`), `SYS`-adressen blir `start`. Matchar stubben exakt det `BasicUpstart2()` genererar exporteras den så; annars som `.byte` med den avkodade BASIC-raden som kommentar. Håller länkarna inte läses raderna som C64:an läser dem efter LOAD, när BASIC länkar om programmet (LINKPRG, `$a533`): varje rad slutar vid sin första nolla från femte byten, programmet vid en länk vars höga byte är 0 (The Last Ninja +6 Teesside Cracking Service: `1988 SYS2072 TRIUMWYRAT` med länken `$080b` mitt i raden; `{00}1001SYS2066` som LIST visar som bara `1001`; `1990 SYS2059` med radnumret som länk). Så läst räknas stubben bara när en `SYS` i den går in i samma fil, och den slutar där `SYS` går när koden börjar i det BASIC läser som resten av raden eller programslutet (`LDY #$00` på `$080b`). `SYS`-uttrycket räknas ut som BASIC gör: tal (mellanslag i dem hoppas över, decimalpunkt, exponent), `+ - * / ^` och parenteser, och det slutar vid första byten som inte för det vidare (`SYS2069-2MHZ!` går till 2067, `SYS9*4096` till `$9000`, `SYS(2^(7+4)+373)` till 2421); en variabel, en funktion (`PEEK` …) eller ett värde utanför 0–65535 lämnar det oläst, och en `$9e` inom citattecken är en färgkod. Kommentaren ger adressen i hex efter uttrycket: `6969 SYS2069-2 ($0813)MHZ!`. Mätt 2026-11-20 på spelen under T i arkivet (21 358 filer på `$0801`): 8 421 stubbar läses nu som förut inte hittades (de startade vid laddadressen), 39 får en annan `SYS`, alla rätt; på 300 av dem hittar analysen 7 144 av 7 144 körda instruktioner (förut 3 656).
2. **En cartridges vektorer** (13.9): i 8K och 16K kallstarten på `$8000` (`start`) och varmstarten på `$8002`
   (`warm_start`, NMI) när `CBM80` står på `$8004`; i Ultimax CPU:ns vektorer för återställning, NMI och IRQ på
   `$fffa–$ffff`. Laddadressen används då inte.
3. Annars: första filens laddadress.
4. Användarens startpunkter (`E`) och kod-overrides (`C`).
4. Dynamiskt upptäckta: IRQ/NMI/BRK-vektorer, hopptabeller (8.5).

### 8.3 Rekursiv spårning (recursive descent)

```
kö ← startpunkter
medan kö inte tom:
  pc ← kö.pop()
  loop:
    stopp om pc ej laddad, redan kod, användardata, JAM, överlapp
    avkoda instruktion, markera bytes som kod
    branch      → xref(branch), köa mål, fortsätt på pc+2
    JMP abs     → xref(jump), köa mål, stopp
    JMP (ind)   → xref(ptr), registrera indirekt hopp, stopp
    JSR         → xref(call), köa mål, fortsätt (utom inline-data-rutin)
    RTS/RTI/BRK → stopp
```

### 8.3b Tidskod (fördröjning)

En stabil raster väntar så många cykler som en timer säger. Ett exempel, från en CIA-tajmad rasterrutin:

```
        lda $dc06               // CIA 1 timer B, låg byte
        eor #$07
        sta smc+1
smc:    bpl *                   // avståndet 0-7 sätts av koden
        lda #$a9                // a9 a9 a9 a9 ad a5 ea: varje ingång slutar på samma ställe
        lda #$a9
        lda $eaa5
```

`findDelays()` (`analyze/delay.ts`) körs efter varje evidenspass och känner igen mönstret:
- en gren vars avståndsbyte en STA/STX/STY skriver;
- ett värde som i den raka sträckan före kommer från en räknare: CIA 1:s eller 2:s timer A eller B (`$DC04–$DC07`,
  `$DD04–$DD07`, med speglingar) eller VIC:ens raster (`$D012`), via `AND`/`EOR`/`ORA`/`ADC`/`SBC` med konstanter
  och överföringar mellan registren;
- byten efter grenen: det mesta grenen hoppar (`AND`:ens, annars `EOR`:ens konstant, högst 63) är hur långt
  fördröjningen räcker, och varje ingång 0…n avkodas till instruktioner som bara tar tid (inga hopp och inga
  skrivningar) och slutar precis vid fördröjningens slut.

Spindles mall (`template/effect.s`) drar i stället timern från en konstant, och inget begränsar värdet:

```
        lda #39-(10)            // den tidigaste cykeln
        sec
        sbc $dc06               // A blir 0-8
        sta *+4
        bpl *+2
        lda #$a9
        lda #$a9
        lda #$a9
        lda $eaa5
```

En konstant (`lda #`) som en räknare dras från, läggs till eller EOR:as med (`SBC`/`ADC`/`EOR`) räknas också. Utan
`AND` eller `EOR` efter är fördröjningen den kortaste (2–63 byte) där varje ingång slutar vid dess slut. I en följd av
`lda #$a9` möts ingångarna först vid den sista instruktionen (`lda $eaa5`), så en `nop` efter räknas inte med. Mallen
ger 0–9 byte (10–0 cykler).

Då gäller:
- **Fördröjningen avkodas från början.** En snapshot kan ha avståndet 5 kvar från senaste avbrottet. Spårningen
  har då gått in mitt i, men fördröjningen avkodas om från början, och grenen skrivs `bpl delay_0886+5`.
- **Operanderna tar bara tid.** De ger inga korsreferenser och inga etiketter, som `data_eaa5` eller `zp_ea`, och de
  skrivs som tal (`lda $eaa5`).
- **Märkning:** etiketten `delay_xxxx` på början, en kommentarsrad ovanför (*delay: the bpl at $0884 goes 0-7 bytes
  into it by CIA1_TB_LO ($dc06), so it takes 8 down to 0 cycles*), kommentaren `delay` på varje rad och på grenen
  *0-7 bytes into the delay, by CIA1_TB_LO ($dc06)*. I listningen är raderna tonade, har en streckad kant och en
  bricka *delay*. Loggen har en rad per fördröjning.

`AnalysisResult.delays` (`DelaySled`) har grenen, skrivningen, timern, fördröjningens intervall, hur långt grenen går
i de laddade byten och hur många cykler den kan ta. **Mätt** på de riktiga programmen i testkorpusen: 15
fördröjningar i 11 program (7 i 6 innan konstanten minus timern räknades). De använder CIA 1:s timer A och B och
CIA 2:s timer A, är 7–29 byte, och alla återskapas byte för byte. **Test:** `test/delay.test.ts`, med Spindles mall.

### 8.4 Evidenspass (konstantpropagering)

Efter varje spårning körs ett linjärt pass över instruktionerna i adressordning med en enkel registermodell `A/X/Y = {värde, källa}`:

- `LDA #imm`, `LDX #imm`, `LDY #imm`, `TAX/TAY/TXA/TYA`, `INX/DEX/INY/DEY` uppdaterar kända värden; övriga instruktioner nollställer de register de skriver.
- En lagring av ett känt värde kommer passet ihåg för adressen (pekarpar, 8.5); en lagring av ett okänt värde, eller en läs-ändra-skriv-instruktion, glömmer det. Annars bildade ett inaktuellt värde ett pekarpar som inte finns.
- Tillståndet återställs vid hoppmål. **Undantag:** täta loopar (alla inkommande kanter är bakåtbranches inom 24 byte) behåller tillståndet för register som loopkroppen inte skriver. Det gör att `lda colors,y / ldx $d012 / wait: cpx $d012 / beq wait / sta $d020` korrekt kopplar tabellen till färgregistret.
- `LDA tabell,X` markerar A som "indexerad läsning från tabell", och nästa konsument ger tabellen evidens:

| Konsument | Evidens | Resultat |
|---|---|---|
| `JSR $FFD2` (CHROUT, också `$E716` och `$AB47`) | petscii | Textblock (PETSCII, eller mixed case när programmet skriver ut med gemener), så långt som loopens räknare eller slutbyte säger (8.5) |
| `STA $0400–$07E7,X` | screen | Textblock (screen codes) |
| `STA $D020–$D02E` | color | Färgtabell (värden < 16) |
| `STA $D000–$D00F` | spritepos | Kurvtabell (sinus) |
| `STA $D012` | raster | Rasterradstabell |
| `STA $D400–$D418` | sid | SID-tabell |
| `BEQ/BNE` direkt efter | zt | Nollterminerad sekvens |

### 8.5 Pekare, vektorer och hopptabeller

- **Omedelbara pekarpar:** `LDA #lo / STA X / LDA #hi / STA X+1` (eller hi först). Destinationer i I/O-området ignoreras (annars blir `$d011/$d012` en falsk pekare). Operanderna exporteras som `#<label` / `#>label`.
- **Vektorer:** skrivs paret till `$0314` (IRQ), `$0316` (BRK), `$0318` (NMI), `$FFFE`/`$FFFA` köas målet som `irq_xxxx` / `nmi_xxxx`.
- **Strängar till utskriftsrutiner** (`packages/core/src/analyze/strings.ts`): parametrarna vid ett anrop säger var strängen är, och rutinen hur lång den är.
  - `LDA #<t / LDY #>t / JSR $AB1E` (STROUT, också `JMP $AB1E`): texten slutar vid 0 eller `"`, som STROUT. `LDA #n / LDX #<t / LDY #>t / JSR $FFBD` (SETNAM): filnamnet är `n` byte. ROM-rutinerna gäller också när programmet ligger under ROM:en, där spårningen följer anropet in i RAM.
  - **Programmets egna utskriftsrutiner:** en rutin som sparar strängens adress från två register (`sta $fb / stx $fc`), eller läser den från ett nollsidespar som anroparen sätter, och skriver ut `lda ($fb),y` genom CHROUT. Hur strängen slutar läses ur loopen: det första testet av tecknet på en väg ut ur loopen (`beq`, `cmp #k / beq`, `cmp #0 / bne loop`) är slutbytet, medan ett test som leder tillbaka in i loopen (ett tecken som rutinen skriver ut på sitt eget sätt, `cmp #$0d / beq cr`) inte är det. `cpy #n` eller `cpy len` före hoppet tillbaka är antalet, och anroparen lagrar `len`. En rutin som lämnar sina register vidare till en annan sådan rutin innan den ändrar dem (`jsr $ab1e` först) tar över dess parametrar. Rutinerna heter `print_xxxx` (`setnam_xxxx` för SETNAM), och loggen säger var adressen och längden finns (*Print routine at $0840: the string's address in A/X, ended by $00*). Vid anropet blir registrens laddningar `#<txt_xxxx` / `#>txt_xxxx`. Tecknet räknas som utskrivet om någon väg genom loopen (den närmaste först) lämnar det i A till CHROUT, `$E716` eller `$AB47`, också på en grens sida: en loop som skriver ut vissa tecken på sitt eget sätt (`cmp #$01 / bne out`) skriver ut de andra där.
  - **Strängen efter JSR:en:** en rutin som drar sin returadress av stacken (`pla / sta $22 / pla / sta $23`, efter högst tre lagringar som lämnar stacken, `sty $24`) läser byten efter anropet. Skriver den ut dem (`ldy #0 / iny / lda ($22),y / beq slut …`) är strängen text, från returadressen plus det index loopen börjar med, och koden fortsätter efter den (rutinen lägger tillbaka adressen efter slutbytet): spårningen går vidare där, och JSR:en får kommentaren *prints the string after it* (loggen: *JSR $8604 prints the string after it ($9e03-$9e15); the code goes on at $9e16*). Rutinen avkodas från sina byte när den inte är spårad än. En rutin som räknar upp pekaren innan den läser nästa tecken (`inc $fb` före `lda ($fb),y`) börjar strängen ett steg längre fram, och en rutin som lämnar över till en sådan rutin (`jsr setcursor / jmp print`) skriver ut strängen också. Fairlights cartridge skriver ut alla sina menyer och meddelanden så (`jsr $8604 / .text "FILENAME PLEASE: " / .byte 0`).
  - **Byte som rutinen hoppar över:** en rutin som drar sin returadress av stacken före första grenen eller anropet och lägger tillbaka den längre fram (`pla / clc / adc #2 / tax / pla / adc #0 / pha / txa / pha`: en RTS fortsätter k + 1 byte efter adressen JSR:en lade dit), eller hoppar via den (`jmp (zp)`), läser byten emellan. De blir data, och spårningen fortsätter efter dem (*JSR $8eca reads the 2 bytes after it ($80de-$80df); the code goes on at $80e0*). Det är så Fairlights cartridge anropar en annan bank (`jsr $8eca / .word $801e`). Rutinen följs en gång genom varje instruktion, aldrig ett varv till i en loop, men vidare in i en rutin den hoppar till. En rutin som lägger tillbaka adressen som den var återvänder som vanligt. Hittas varken en sträng eller ett antal byte stannar spårningen som förut (*JSR $xxxx pops its return address; inline data follows $yyyy*).
  - En pekare som sätts i samma körning (`stx $fb / sty $fc / ldy #0 / lda ($fb),y / jsr $ffd2`) och en tabell som skrivs ut med `lda t,x / jsr $ffd2` ger strängar på samma sätt; en tabells räknare (`cpx #n`) räknas från det index loopen börjar med.
  - Strängen blir ett Textblock så långt som parametrarna eller loopen säger, om minst 80 % av byten är PETSCII-tecken (också grafik och styrkoder): en loop som skriver en fil genom CHROUT kan skriva vad som helst. En tom sträng, bara slutbytet, blir ingen text. Strängen fortsätter över objektstarter i den (ett tecken som koden ändrar), och resten blir text med skälet *the rest of the string at $xxxx*. Skälet säger rutinen och anropet: *printed by STROUT ($ab1e) from $0a0f*, *printed by the routine at $0840 from $0a7c*, *the file name given to SETNAM ($ffbd) from $c006, 4 bytes*.
  - **Gemener eller versaler** (`printCase` i `strings.ts`): skärmen visar teckenuppsättningen med versaler och grafik tills programmet växlar till den med gemener, där `$41–$5a` är gemener och `$c1–$da` versaler. Utskriven text (en sträng till en utskriftsrutin, en tabell som skrivs ut genom CHROUT, och resten av en sträng) blir *Text (PETSCII, mixed case)* (`petscii_mixed`, 11.2) i stället för `petscii_upper` när
    - strängen själv visar det: en `$0e` i den (den första av `$0e` och `$8e` avgör, och `$8e` ger versaler), eller ett ord som börjar med versal, alltså en skiftad bokstav (`$c1–$da` eller `$61–$7a`) följd av två oskiftade (*Abyss*, lagrat `$c1 $42 $59 …`, som med versalerna blir ett grafiktecken före *BYSS*). Skälet säger det när strängen skiljer sig från programmet: *printed by STROUT ($ab1e) from $c009, mixed case ("Abyss")*.
    - annars när programmet växlar till gemener och aldrig bort från dem. Till gemener: `$0e` i A vid `JSR` eller `JMP` till CHROUT (`$FFD2`, `$E716`, `$AB47`), en `$0e` i en sträng till en utskriftsrutin, ett `$x6`/`$x7` som lagras i `$d018` (ROM:ens gemener) eller `lda $d018 / ora #$02 / sta $d018`. Bort från dem: `$8e` på samma sätt, `$x4`/`$x5` eller `and #$fd` i `$d018`, och varje annat värde i `$d018`: en egen teckenuppsättning eller en bitmapp, vars bokstäver ligger där versalernas gör. Med bankspårning (8.7b) räknas en `$d018`-lagring bara där I/O syns, och i VIC-bank 1 eller 3, där ROM:ens tecken inte syns, är varje värde en egen teckenuppsättning.
    - Ett program som växlar åt båda hållen skriver ut med versaler, utom där en sträng visar annat. Passet vet inte vilken växling som gäller när en viss sträng skrivs ut, och en laddares meddelanden (*SCANNING…*) skrivs ofta ut innan programmet växlar. Loggen säger valet första gången en sträng som inte själv visar något tar det: *The program switches to the lower case characters ($0e sent to CHROUT ($ffd2) at $c002): the text it prints is mixed case*, eller *… ($d018 = $17 at $c002) and away from them ($d018 = $15 at $c015): the text it prints is upper case unless a string shows otherwise*.
    - Att en sträng läses bättre med gemener avgör bara den strängen, inte programmets övriga text. I en korpus på 882 program ur arkivet (147 med utskriven text, 624 textblock) var ett ord som börjar med versal alltid text för gemener, men inget program hade sådana ord utan en växling i koden, så det finns inget som visar att resten av programmets text (versaler eller gemener, som läses lika bra åt båda hållen) skrivs ut med gemener. Ett program som växlar i BASIC-raden eller i ett tidigare program får gemener bara i de strängar som visar det.
- **Lo/hi-tabeller:** `LDA tA,X / STA p / LDA tB,X / STA p+1` → `tA` = lo-tabell, `tB` = hi-tabell. Längden är kortaste dataserien. Om ≥ 75 % av paren pekar in i laddat minne är det en pekartabell och exporteras som `.byte <fx_0919, <fx_091a, …`.
- **Hopptabeller:** om pekartabellens destination används av `JMP (p)`, eller är en vektor, köas alla mål som kod (`fx_xxxx` / `irq_xxxx`). Rasterkedjor med IRQ-tabeller hittas på samma sätt.
- **`.word`-hopptabeller:** `LDA t,X / STA p / LDA t+1,X / STA p+1` (indexet dubblat) följt av `JMP (p)`, eller med en vektor som `p`, är en tabell av ord. Den slutar vid nästa byte som koden refererar till, eller vid ett ord som inte är en laddad adress (högst 64). Alla mål köas som kod, och `t+1` blir `t+1`, inte en egen etikett. Tabellen klassas som Word table (*every word points at an instruction*).
- Spårning, evidens och tabellupplösning itereras tills inga nya startpunkter tillkommer (fixpunkt, max 8 varv).

### 8.6 Musikdetektering (SID)

`detectMusic()` (`packages/core/src/analyze/music.ts`) körs efter spårningen. En spelare börjar med en hopptabell på `B`:
`JMP init`, sedan `JMP play` (upp till fyra `JMP` i rad) eller play-koden direkt efter dem (`B+3`, `+6`, `+9` eller
`+12`). En låt vars sång ligger färdig i datan kan i stället för `JMP init` ha en **init som inte gör något**: `rts`,
`nop / rts` eller `nop / nop / rts` i början av en sida, med play direkt efter (`B+3`; Booze Designs låtar, där
programmet bara anropar play). En sådan tabell räknas bara när den spelar (se *Körningen*), och den är aldrig en annan
spelares anropare. Koden som ingångarna når avkodas från tabellen där spårningen inte kom fram. Spelaren hittas därför också när
init kördes innan en VICE-snapshot togs (bara play är spårad), när play anropas från ett avbrott som spårningen inte
hittade, och när inget spårat når den alls. Avkodningen stannar vid JAM, BRK, instabila opkoder, mitten av en spårad
instruktion (utom BIT-skip-idiomet) och data-overrides. Fler än två sådana vägar, eller fler odokumenterade opkoder än
var åttonde instruktion, diskvalificerar.

**Play** är den ingång som IRQ:n anropar, alltså spårad avbrottskod eller hanteraren som vektorerna `$0314`/`$0318`/`$fffe`/`$fffa`
i minnet pekar på (en snapshots). Annars är det en ingång som programmet anropar, och annars en som ospårad kod anropar
(en `JSR`/`JMP` till den någonstans i minnet). Om ingen anropas blir play den ingång som skriver flest SID-register: en
volym- eller ljudeffektsingång skriver få. **Init** är `B`. Anrop räknas *utifrån*: från kod som inte är spelarens egen,
och inte från en `JMP` i en tabell strax före (högst 12 byte).

**En `JMP` som programmet skriver dit** (`writtenJmps()`): tre byte som spårad kod anropar eller hoppar till, där varje
skrivning till var och en lägger samma konstant (`lda #$4c / sta`), `$4c` i den första, och där filen inte har någon
`JMP`. Musikdetekteringen läser dem som den `JMP` programmet skriver, både i tabellerna och i körningarna, och en ingång
som är en sådan `JMP` blir dess mål, som blockets egna byte spelar från. Mathematicas demo (Reflex, 1995) skriver
`JMP $081d` över BASIC-nollan på `$0800`, där spelarens `JMP init` stod, och anropar sedan `$0800` med låt 0; NMI:n anropar
play på `$0803`. Utan regeln togs tabellen från `$0803` med play som init och en röststart (`$0809`) som play, och den
spelade ingenting. Nu är init `$081d` och play `$0803`, och blocket `$0800-$1d22` spelar i VICE. En byte som får två
olika värden (en `JMP` som slås av och på med `BIT`) eller skrivs indexerat räknas inte.

| Signal | Poäng |
|---|---|
| Hopptabellen | +2 |
| Både init och play anropas med JSR utifrån | +2 (en av dem: +1) |
| `B` är sidjusterad (t.ex. `$1000`) | +1 |
| Koden skriver ≥ 4 olika SID-register | +3 (1–3 register: +1) |
| Koden läser en notfrekvenstabell | +2 |
| Init och play spelar när de körs (se *Körningen*) | +4 |

En indexerad skrivning (`sta $d400,x`) räknas som tre register, eller som alla som slingan skriver när en `cpx`/`cpy #n`
följer inom fyra instruktioner: en buffrad spelares `sta $d400,x` till `cpx #$19` skriver 25.

**Notfrekvenstabellen** finns i varje trackerspelare. `noteTables()` letar efter högbytena: minst 24 stigande byte, en
isär (låg- och högbyte i egna tabeller) eller två (i par), där en byte är ungefär dubbelt så stor som den tolv toner (en
oktav) före, minst sex gånger. Nollor i början av en sådan följd räknas inte. Koden läser tabellen när en `lda`
(absolut eller indexerad) når den eller högst `$20` byte före.

Tröskeln är 5 poäng. Dessutom gäller:
- **Något anropar tabellen** (spårat eller inte). Annars måste koden läsa en nottabell och `B` börja en sida, där
  spelare läggs. Ett `JMP`-par i annan kod som skriver till SID, t.ex. en rensning av registren, gör inget av det.
- **En tabell som koden före rinner in i** (eller som en gren når) och som ingen anropar är ett `JMP`-par inne i annan
  kod. Rinner koden före in i en tabell som anropas är det ett program som startar init så, och det räknas.
- **Play-kod direkt efter en enda `JMP`** kräver att både init och play anropas, eller en nottabell och en anropare.
  Slutet på en rutin och början på nästa ser ut så i all kod.
- **Programmets egen start** (BASIC SYS-målet eller laddadressen) är aldrig init, utom när den spelar (nedan).
- **Koden måste hålla ihop.** Den ska ligga inom `B−$800`…`B+$2000`, med högst 16 instruktioner utanför. Är mer än 8
  spårade instruktioner i regionen kod som tabellen inte når, får det vara högst var fjärde av dem. Några ingångar som
  programmet anropar direkt går bra.

**Körningen** (`runPlayer()` i `packages/core/src/c64/sidrun.ts`). En tabell vars kod skriver till SID körs också på
Sindris 6510: init med låt 0 i A, sedan varje ingång efter init som play, en gång per bildruta i 3 s (150 anrop). Den
körs i en kopia av minnet, med en snapshots nollsida, stack och andra byte som projektet inte har med. VIC, CIA och SID
svarar så långt spelare frågar (rasterraden går vidare för varje läsning, oscillator 3 ger brus), och inget avbryter.
En körning **spelar** när init (inom 400 000 cykler) och varje play-anrop (inom en bildruta) återvänder utan BRK, JAM,
RTI eller kod i byte som inte är laddade, och den skriver minst 8 SID-register och startar minst 2 toner (en röst vars
gate-bit slås på). En låt kan börja lugnt: en körning som skriver minst 8 register men startar färre toner hörs i en
minut (som stannar efter 10 s utan någon SID-skrivning). Den ingång som spelar mest blir play, men play är den ingång
IRQ:n anropar när också den spelar: körningens bästa kan vara en del av play-rutinen. IRQ:n anropar play också när den
anropar koden som play-ingångens `JMP` går till (ett program kan anropa spelarens play-rutin direkt).

En tabell som spelar är en spelare vad som än anropar den, också när koden inte klarar reglerna ovan. Det hittar en
musikfil som laddats ensam från en trackmo-disk (ingen BASIC-rad, så laddadressen är programmets start och inget
anropar den), en spelare vars play-kod skriver om sig själv vid första anropet (som The Labs: koden reglerna läser når
inte play-rutinen) och buffrade spelare. Körningarna sparas mellan analysens varv (samma minne, samma ingångar):
utfallet för upp till 8192, och de som spelade med sina byte (de som ger blockets omfång eller avgör vem som anropar
vem) för 128.

**En del av en spelare** spelar ofta också när den körs: The Labs spelare har en `JMP` mitt i play-rutinen (`$10de`),
följd av rutinens fortsättning. I ett minne där låten redan har spelat en stund (en snapshot, eller ett program som
Sindri packat upp och kört tills det väntar) spelar den direkt, medan spelarens init börjar lugnt. Två regler håller isär
dem:
- **Körningen kör kod före tabellen** (högst `$800` byte före, samma fil): tabellen är en del av en spelare. Den kan inte
  ha någon anropare, och den kommer efter tabellerna som spelar på egen hand.
- **Play-koden är dit en annan tabells `JMP` går** (koden, inte en `JMP`), och ingen av den tabellens `JMP` går till
  dess init: det är `JMP`-instruktionen strax före en spelares play-rutin (SWiRL: `$11e7` före play-rutinen `$11ea`, som
  `$1000`-tabellens `JMP` går till). Den räknas inte. En tabell av `JMP` till både init och play är däremot den andras
  anropare.

**Flera tabeller:** alla tabeller prövas först.
- **Anroparen är ingen spelare.** En tabell vars kod hoppar till en annan spelares ingångar är den spelarens anropare,
  till exempel programmets starttabell eller en rutin som anropar init och play. Det gäller när hoppen kommer utifrån,
  koden inte kör in i den andra spelarens kod på annat sätt och de flesta SID-skrivningarna är den andras. Det gäller bara
  om den andra tabellen inleder sin kod. En tabell inne i en spelare, som spelarens egen kod hoppar till, har spelarkod
  före sig. En tabell som bara körningen hittade är ingen sådan spelare: spelarens kod hoppar in i den.
- **Anroparen, för tabeller som spelar:** en tabell vars körning körde den andras ingångar, där den andra spelar lika
  mycket på egen hand under en minut, aldrig kör den första tabellen och inleder sin kod (dess körning kör ingenting
  före den), är dess anropare. En spelare som spelar mer än en inre rutin den anropar är ingen anropare, och inte heller
  en tabell som klarar reglerna av en som bara körningen hittade, eller en tabell av en som ligger inne i den. En tabell
  med en init som inte gör något är aldrig någon anropare, eftersom en anropare startar spelaren den anropar. En `JMP`
  som dess play-kod kör igenom, följd av mer play-kod, är en del av den, också när den spelar lika mycket. I Codeboys
  ligger en sådan `JMP` på `$1145`, mitt i play-rutinen på `$1003`.
- **Ordningen där tabeller överlappar:** först de vars play IRQ:n anropar (programmets egna ingångar, inte en del av
  spelaren), sedan de som spelar på egen hand (den som spelar mest under en minut först: en del av en spelare kan starta
  några toner och sluta, en låt börja lugnt), sedan den starkaste. En tabell inne i en spelare som redan hittats, eller vars kod kör
  in i den, räknas inte. En spelares kod slutar där nästa spelares tabell börjar.

Regionen sträcker sig från `B` till slutet av spelarkoden och dess datareferenser. Sedan förlängs den över efterföljande
data tills något refereras utifrån, ny kod eller nästa spelares tabell börjar, eller 32 identiska byte (luckfyllnad)
hittas. För en spelare som spelar hör också de byte till blocket som körningen använde (körde, eller läste innan den
skrev dem) under tre minuter av låten, eller tills den gått runt (30 s utan en byte som används för första gången): data
före tabellen och låtdata efter koden som spelaren läser genom pekare, också förbi en byte som resten av programmet läser
(en synkning mot musiken). Koden som körningen körde nära tabellen (`B−$800`…`B+$2000`, samma fil) hör alltid till
blocket, med allt mellan: utan den hoppar spelaren ut ur sitt block. Därifrån växer blocket över använda byte så länge
luckorna är kortare än `$800` byte och det inte kommer kod som körningen inte körde, en annan spelare eller en annan
fils byte.

**Uppspelningen kontrolleras** (`musicPlayData()`): byten som spelas (blocket, och en snapshots rutin) körs ensamma i
minnet, som spelarens PRG har dem, i 150 bildrutor. Stannar körningen (kod utanför blocket, BRK, init som inte
återvänder) säger appen varför i en varning när blocket spelas, i stället för att spelaren i VICE kraschar utan förklaring.

**Låten i A, X och Y.** Spelarens PRG i VICE (`sidPlayer()`) anropar init med låtens nummer i A, X och Y. En del spelare
tar numret i X: Cybernoid II:s (C64com, uppackad hela vägen: blocket `$a620–$d7ff`, init `$a620` → `$a6ca`) läser
`lda $aeed,x`, och spelet anropar den med `ldx #$00 / jsr $a620`. Drivrutinen tystade SID:en med en loop som lämnar X på
`$ff` precis före init, så spelaren fick en låt som inte finns och var tyst i VICE (RMS 0), medan körningen i analysen
och DeepSID har X = 0 och spelade den. Nu spelar den i VICE (RMS runt 2 600 per sekund). Med låt 0 får init samma
register som i analysens körning (`sidrun.ts`, A = X = Y = 0).

**Registren som programmet ger init** (`regsAtCall()` i `music.ts`, `MusicInfo.initRegs`). En del spelare tar inte ett
låtnummer utan låtens adress: The Last Ninja (C64com, Triads crack sida A, uppackad till fuskmenyn på `$c857` med hela
spelet i minnet) anropar sin spelare med `ldx #$28 / ldy #$b7 / jsr $b000`, och init (`$b1dc`) läser låten genom
`($fc),y` med X/Y som pekare. Med X = Y = 0 läste den från `$0000`, och körningen gav 25 register men 0 toner: blocket
hittades (`$b000-$b93f`) men spelade inte, i VICE heller (RMS 0). Spelar en tabell inte med bara låtnumret läses varje
anrop av init utifrån (spårat, eller en `JSR`/`JMP` som spårningen inte avkodat): de konstanter som koden direkt före
laddar i A, X och Y, bakåt till där en annan väg kommer in (en gren, ett hopp eller anrop dit), ett anrop, ett hopp eller
en retur före, högst 12 instruktioner. `lda/ldx/ldy #`, `tax`, `tay`, `txa`, `tya`, `inx`, `dex`, `iny` och `dey` följs;
allt annat som skriver ett register gör det okänt. I kod som spårningen inte avkodat räknas bara laddningar med en
konstant direkt före anropet. Bara uppsättningar som sätter X eller Y (inte båda till 0, som körningen redan gav) prövas:
ett tal i A ensamt är en låt, eller argumentet till en ljudeffekt (`lda #3 / jsr sfx`), och varje spelare spelar sin
första låt. På korpusen nedan gjorde de A-försöken bara analysen långsammare, i spelares och effektrutiners inre
`JMP`-par (upp till 23 försök i ett program). Varje uppsättning prövas en gång i 3 s (högst fyra, de som sätter flest
register först, ingen minut för en lugn början), och den första som spelar ger körningen, blocket och `initRegs`;
skälen säger var anropet är. The Last Ninjas block blir
`$b000-$bc49` (låtdatan som körningen läste), med 2 467 toner på tre minuter. Uppspelningen (`musicPlayData()`) ger init
dem: A blir första låten (`MusicPlayData.song`, `.sid`-filens startlåt), och X och Y laddas av en rutin direkt efter
blocket (eller före det), `ldx #$28 / ldy #$b7 / jmp $b000`, som blir init (`MusicPlayData.regs`) i VICE och DeepSID.
Spelarens skärm säger `SONG $00 (A AT INIT), X $28 AND Y $B7`; i VICE ger blocket nu RMS 500–1 900 per sekund, i vsid
1 000–2 600. Exportens `.sid` är fortfarande blockets egna byte (programmet anropar init själv). På 428 uppackade program
(Year-top20 rank 1–6 och Onefile-top200) ändras ingen musik: alla som spelar gör det redan med låtnumret.

**Spelare utan hopptabell** (5.8c, `calledPlayers()` i `music.ts`, `MusicInfo.songs`). Bomb Jack (Elite, 1986;
Preservers `Bomb Jack - Elite.D64`, uppackad med Sindri) har ingen hopptabell. Spelets IRQ anropar play på `$7448`
(`jsr $7448` på `$1664`), och varje låt startas av en egen rutin i spelets kod, långt från spelaren: `$08f1`, `$08ff`,
`$090e`, `$092c` och `$093b` gör `sei`, slår av BASIC, anropar låtens uppsättning (`$8400`, `$8c4f`, …), kopierar
låtens pekare dit play läser dem (`$0e7b`, till `$7e2f`–`$7e32`) och slår på BASIC igen. Analysen tog i stället två
`JMP` inne i spelarens och ljudeffekternas kod (`$7735` och `$7ec3`): den första var tyst i VICE (spelarens variabler
på `$73a0`–`$7447` låg utanför blocket), den andra spelade en ljudeffekt. Nu:
- **Play** är en rutin som IRQ:ns spårade kod anropar med `JSR`, som skriver minst 8 SID-register och håller ihop sin
  kod som en tabells (högst 16 instruktioner utanför `−$800`…`+$2000`). Den anropar ingen tabells ingång (den tabellen
  är spelaren) och är ingen tabells ingång, mål eller kod: The Last Ninjas IRQ anropar play-koden som tabellen på
  `$1000` kör in i. Av en rutin inne i en annan tas den som skriver fler SID-register, den inre när de skriver lika många.
- **Låtarnas rutiner** är rutiner som programmet anropar (spårat, `JSR`), utanför play, vars spårade kod skriver minst
  två av de byte som play läser (absolut och nollsida, och pekarna den läser genom). De 24 som skriver flest körs som
  init med play efter i 3 s. De som spelar toner som hörs (rösten har en frekvens och volymen är inte 0 när anropet
  återvänt, `PlayerRun.heard`) är låtar. Onscreen 5k bygger sina frekvenstabeller medan det kör, och Black Gold sätter
  volymen i en annan rutin: i filen är de 0, och utan kravet blev de tysta block.
- **En rutin och en som den anropar:** den som anropar är låtens när den skriver byte som play läser och som den
  anropade inte skriver (Bomb Jacks `$08f1` kopierar pekarna efter `$8400`), annars den anropade. Rutiner som lämnar
  samma byte med samma värden till play startar samma låt. Minst en låt ska spela 30 toner som hörs på en minut: en
  ljudeffekt slutar.
- **Blocket** är det som play körde och läste i alla låtarnas körningar (tre minuter var), också variabler som rutinen
  skrev först. Inom `−$800`…`+$2000` tas det med vad som än ligger emellan (Bomb Jacks låtdata ligger efter
  ljudeffekternas kod), därefter som för en tabell: `$73a0-$96e5`. Rutinerna själva är programmets kod och ingår inte.
  Varje låts `state` är det rutinen lämnar till play: byte som den skrev och play läste, SID-register som den skrev, och
  byte utanför blocket som play läste, med programmets värden (högst 256; inte stacken, I/O eller `$fffa`–`$ffff`).
  Bomb Jacks fem låtar lämnar 27 byte var. Init (`MusicInfo.init`) är första låtens rutin.
- **Uppspelningen** (`musicPlayData(…, songs)`, `MusicPlayData.songs`): en rutin direkt efter blocket (eller före det)
  skriver låt A:s byte och blir init i VICE och i DeepSID (`cmp #k / beq / jmp` förbi varje låt efter den första, låt 0
  sist, också för ett nummer efter den sista). `.sid`-filen har lika många låtar. Ligger en låts byte utanför blocket
  under BASIC eller KERNAL anropas play genom en rutin efter den som sätter `$01` till `$35` under anropet: Untouchables
  (Ocean) har sina variabler på `$feea`–`$ffc4`. Bomb Jacks fem låtar spelar i VICE (RMS 1 200–3 400 per sekund; låt 3
  är en kort slinga som tystnar efter 11 s). Spelets ena skärm anropar play två gånger per bildruta (IRQ:n `$0958`, en av
  tre i rad, som spårningen inte når): där går låten dubbelt så fort som Mimir spelar den.
- **Mätt (2026-11-22)** på 444 program uppackade med Sindri (CSDB:s Top200-spel, 70 Preservers-spel och Onefile-top200),
  gammal kärna mot ny: 431 lika och 13 ändrade, alla spelade i VICE med båda. Nya block som spelar: Robocop, Creatures 2,
  Muddy Racers, Mars Saga, Magnum Force, Caveman Ughlympics, Desert Fox (ett andra block, 12 s) och Untouchables (en 4 s
  lång slinga, som i Sindri). Tysta förut, spelar nu: Bomb Jack, Pirates (blocket `$18a5-$18fe` var 90 byte), Return of
  the Jedi (`$5df3`, en annan tabell) och LSR 64 Ketto (tystnade efter 2 s). Tenebra 2 byter tabell och är tyst med
  båda. Tiden är inom bruset utom där en sådan spelare hittas (Bomb Jack +150 ms första gången).

**I DeepSID** (`electron/main/deepsid.ts`) går `.sid`-filen till sidans Load SID, och när den listats klickas dess rad. DeepSID
hämtar sin mapplista med jQuery-anrop när sidan öppnas, och ett klick på en rad spelar `browser.songs[rad − subFolders]`.
En mapplista som kommer fram efter att Load SID börjat sätter tillbaka mappens antal undermappar (160 i roten): klicket
spelar då ingenting (DeepSID kastar ett fel i `onClickRow`, efter att ha vridit ner volymen), och det blev tyst för
låtar som spelades direkt efter att fönstret öppnats, fast filen var rätt (Comaland sida 1, 2026-11-08: alla tre låtarna
spelar i DeepSID med WebSid och Hermits emulator när de klickas i rätt läge). Därför lämnas filen över först när inget
jQuery-anrop är ute på 400 ms, raden klickas när inget är ute igen, och en Load SID-lista (som inte har några mappar)
med ett överblivet `subFolders` får 0, som DeepSID:s egen hanterare ger det. Efter klicket frågas DeepSID:s spelare om
den spelar (`SID.isPlaying()` och en speltid över 0 inom 8 s); gör den inte det säger appen det och var filen finns för
Load SID för hand, i stället för att säga att den spelar. E2e-testets ersättningssida har samma kapplöpning: med den
gamla överlämningen kom filen fram men spelades inte.

**En snapshots spelare** har redan kört, och init startar inte alltid om låten: The Labs första spelare skriver om sitt
play-anrop vid första anropet, och init går sedan genom det. För den spelare som blir block körs låten därför en minut
med init och en minut utan, med play från där den var. Startar init färre än 30 toner på en minut och play utan init
fyra gånger fler, spelar den vidare från snapshoten: `MusicInfo.resume` får de byte utanför blocket som play läser innan
den skriver dem (nollsidan och andra variabler, högst 256; inte stacken, `$0314`–`$0319`, `$fffa`–`$ffff` eller I/O) med
snapshotens värden, och SID-registren från snapshotens SID-modul (volym och filter som bara init satte). Uppspelningen
(`musicPlayData()` i `c64/sidplayer.ts`, i VICE och i DeepSID) lägger då en rutin direkt efter blocket (eller före det)
som skriver tillbaka dem och återvänder, som init: låten går vidare där demot var, och en tangent startar den där igen.
Exportens `.sid` är blockets egna byte. Spelar init lika bra, eller saknar projektet snapshoten, används init.

**Samplingsspelare (digis, 5.8b).** En samplingsspelare har ingen play-rutin som anropas en gång per bildruta. Init
startar en CIA-timer vars avbrott (CIA 2:s NMI, eller CIA 1:s IRQ) skriver ett sampel till SID tusentals gånger i
sekunden, läst ur minnet: volymen på `$d418` (4-bitars sampel), en rösts pulsbredd (PWM) eller annat. Inget av det har
en hopptabell, och spårningen når ofta inte avbrottet. Voodoo People (1995) kopierar sin NMI till `$0080`, sätter
`$fffa` dit med KERNAL urkopplad och blandar fyra kanaler sampelsidor (en orderlista på `$ff00`, mönster på `$7c00`–
`$89ff`, sampel på `$8a00`–`$cfff` och `$e000`–`$feff`) till två rösters pulsbredd, 6158 gånger i sekunden. Analysen
hittade ingen musik alls där.
- **Kandidater** (`samplePlayers()` i `music.ts`): bara i ett program där spårad kod lagrar en konstant under 8 i en
  timers högbyte (`$dc05`, `$dc07`, `$dd05`, `$dd07`: en timer snabbare än `$800` cykler), de rutiner (subrutiner,
  programmets start, användarens ingångar) vars spårade kod når en lagring av en konstant med bit 7 och en timers bit i
  `$dc0d`/`$dd0d` (avbrottet slås på), de tre minsta per lagring.
- **Körningen** (`runDigi()` i `c64/sidrun.ts`): rutinen körs som init med `$01` som programmet startar med (Unpacks
  `entryPort`, annars `$37`; en snapshots eget). Ett anrop in i ROM:en där `$01` visar den återvänder direkt (en init
  som rensar skärmen med KERNAL). Sedan tas timern: CIA 2:s när init startat den med avbrottet påslaget och den är
  snabb nog, annars CIA 1:s (timer A, annars B). Vektorn som init lämnat, som `$01` visar den (`$0318`/`$0314` med
  KERNAL inne, annars `$fffa`/`$fffe`), ger hanteraren. Den körs som timern anropar den, var `latch + 1`:e cykel, med
  återhoppet och flaggorna på stacken (och A, X, Y genom KERNAL:s IRQ-ingång), tills `RTI` eller någon av KERNAL:s
  utgångar (`$ea31`, `$ea7e`, `$ea81`, `$febc`). Avbrottsregistret ger `$81` till hanteraren som läser det. Vektorn läses
  vid varje avbrott, som processorn gör: Wonderland IV:s NMI är två halvor som pekar `$0318` på varandra (först sampelns
  låga nibble, sedan den höga), och Macho Programmings byter `$fffb`.
- **En init som inte återvänder** (programmets start, som sätter upp spelaren och sedan går i sin huvudslinga) tas där
  den är efter 400 000 cykler (`DigiRun.loop`), med minnet, SID-registren den skrev sist och timern som den lämnade dem.
  Blocket är då byten runt hanteraren som hanteraren använde (inte programmets kod). Det hanteraren läser och som init
  ändrat eller som inget laddat (nollsidan, en kopierad hanterare), vektorn, `$01` och SID-registren blir
  `MusicInfo.resume` (högst 512 byte). Youthquake (1989) och Jerkland II (1994) är sådana.
- **En sekvenserare i programmets IRQ**: en hanterare som körs men inte spelar, eller skriver till SID i färre än nio av
  tio avbrott, körs igen med programmets IRQ en gång per bildruta (de IRQ-hanterare spårningen känner, och med en init
  som inte återvänder den vektor init satt). Spelar det klart mer (en fjärdedel fler avbrott med SID), är det IRQ:n som
  startar samplen: `digi.irq`. Det prövas också när samplen tystnar under den långa körningen. Wonderland IV:s raster-IRQ
  (`$16ca`) sätter NMI:ns pekare, slut och takt ur tabeller var tredje bildruta; utan den skriver NMI:n samma värde.
- **En samplingsspelare** är en körning där init återvänder (eller tas där den är), timern kommer var 41:a–2001:a cykel
  (fler än ~490 gånger i sekunden: långsammare är en play-rutins), varje avbrott återvänder inom en bildruta, minst var
  fjärde avbrott skriver till SID (Kalle Kloakks gör det i ungefär hälften), ett register får minst 8 olika värden (ett
  4-bitars sampel genom `$d418` har 16), och hanteraren läser högst 32 byte från `$0200` som varken laddats eller skrivits
  av init. En NMI för något annat (som skriver samma värde varje gång) är ingen, och inte heller en som spelar genom en
  tabell programmet bygger medan det kör (Macho Programmings på `$0400`): ensam spelar den en ton.
- **Samplen som tystnar**: skriver hanteraren till SID i färre än hälften av avbrotten under den långa körningen, säger
  skälen när de tystnade (*its samples stop after 14 s*): det som startar dem igen körs inte med (Jerkland II spelar ett
  sampel i 14 s, Wonderland V ett intro på 11 s, som demona själva gör).
- **Blocket** är de byte runt init som init och hanteraren använde eller skrev, med luckor under `$800` och fram till kod
  som körningen inte körde, en annan spelare eller en annan fils byte. Init är rutinen, play är 0 (inget anropas per
  bildruta). Det init och hanteraren läste utanför blocket (samplen, låten, källan till en kopierad hanterare) blir
  `MusicInfo.digi.parts`, det de skrev utanför blocket `digi.wrote`. Körningen pågår, som en vanlig spelares, i upp till
  tre minuter eller tills låten gått runt (30 s utan en byte som används för första gången), och sparas mellan analysens
  varv.
- **En vanlig spelare vars init också startar sampel** (digitrummor) behåller sin play och får `digi`.
- **Samplen är data** (`classify.ts`): byten i `parts` som är data eller grafik blir datablock med skälet *samples and
  song of the sample player at $1213: its NMI reads them*, vad de än liknar (inga sinuskurvor, fyllnader eller bitmappar
  där). Kod förblir kod.
- **Skälen** säger vad körningen såg, t.ex. *a sample player: init $1213 starts CIA 2's timer (every 160 cycles, 6158 Hz)
  with its NMI at $0080 (vector $fffa)*, *the NMI writes samples to $d402, $d403, $d409, $d40a (pulse width) in every
  interrupt: 228 different values in 97 s* och *it plays from $7c00-$7dff, $7f00-$cfff, $e000-$ff19 too (28.5 KB: its
  samples and song)*. Översikten säger *A sample player: its NMI plays 6158 samples a second*, inspektorn visar
  hanteraren, takten, registren och delarna.

**En samplingsspelare spelas** med sina delar (`musicPlayData(…, digi)`). Utan play läggs en rutin bredvid blocket som
init (`MusicPlayData.wrapped`): den sätter `$01` som spelarens PRG har det, anropar spelarens init och slår av
rasteravbrottet (och CIA 1:s avbrott bredvid en NMI). Ett demos init startar ofta sina egna effekter samtidigt (Voodoo
Peoples sätter `$fffe` till demots IRQ), och den koden finns inte i det som spelas. Med en sekvenserare i programmets
IRQ sätter rutinen i stället IRQ-vektorn (`$0314` eller `$fffe`) till den och slår på rasteravbrottet, och med en init
som inte återvänder anropar den rutinen som lägger tillbaka det init lämnade (`resume`, `$01` sist så att SID-registren
skrivs med I/O synligt) och startar timern igen (latch, avbrottsmask, kontrollregistret med `$11`). Spelarens PRG (`sidPlayer()`) lägger
då blocket och delarna där de körs när det ryms i PRG:ns utrymme (`$0c00`–`$cfff`), och resten i luckorna där ingen del
ska ligga, så att ingen flytt skriver över något som ännu inte flyttats. Ett block utan delar ligger som förut i en följd
från `$0c00`. Drivrutinen läggs utanför delarna, deras platser i PRG:n och det init skriver. Utan play har drivrutinen
inget rasteravbrott och anropar inget per bildruta. När en låt startas om stoppas båda CIA:ernas avbrott innan init
körs. Skärmen visar *NO PLAY* och *SAMPLES: ITS NMI, 6158 HZ*. Kontrollen kör det som spelas ensamt med `runDigi()`.
I DeepSID spelas den som en **RSID-fil** (`musicSidFile()`, en riktig C64:s avbrott, play 0) med blocket och delarna
från den lägsta till den högsta, nollor emellan. Exportens `.sid` är som förut blockets egna byte (en PSID med play 0).
Delarna delas där PRG:ns utrymme börjar och slutar, så att det av dem som ligger i det stannar där det körs (Kalle
Kloakks sampel börjar på `$0a00`, under PRG:ns egen kod: utan delningen fick de 32 KB inte plats).

**Mätt (2026-11-13), med en init som återvänder** på 1785 program: varje utgåvas första program i CSDB:s Year-top20
(1987–2026) och Onefile-top200, uppackade med Sindri och startade från Sindris start, som appen gör. 194 program har en
kandidat. Fyra demos (sju program, eftersom listorna har några demos två gånger) har en samplingsspelare: The Megademo (1988, `$c200`, `$0318`, 8210 Hz,
`$d418`), Kalle Kloakk (1990, `$c000`, NMI på `$9095`, 7758 Hz, `$d418` i 93 % av avbrotten), Amiga Works (1991, `$1220`,
7408 Hz) och Voodoo People. Inget annat program fick musik. Alla fyra spelar i VICE (6581) som demot självt gör: Kalle
Kloakks RMS per sekund 1522, 1476, 1475, 1591, 2369 mot demots 1523, 1474, 1476, 1597, 2368, och Voodoo Peoples (8580)
1461, 1608, 1646, 1714 mot 1134, 1655, 1735, 1603 när demot laddat klart. Exporten bygger alla fyra byte för byte, med den
inbyggda assemblern och med KickAss.jar. Mot Sindris körning (`mimir measure`) läses 26 byte som kod i stället för 125
(Voodoo Peoples NMI-källa var kod), och The Megademos åtta NMI-instruktioner räknas som data, som all kod i ett
musikblock. Steget tar 4,3 s av analysens 558 s på hela korpusen; 0,4–1 s första gången för de fyra, under 0,1 s för
resten.

**Mätt igen med init som inte återvänder och sekvenserare (2026-11-13)**, samma 1785 program mot koden före
samplingsspelarna: nio demos (16 program) får musik eller en samplingsspelare till, och alla andra programs musik är
densamma. Till de fyra ovan kommer Youthquake (1989, init `$0810` som går i en slinga, NMI på `$4fd5`), Wonderland IV
(1989, init `$1664`, sekvenseraren i IRQ:n på `$16ca`; spelaren på `$1c67` är kvar), Wonderland V (1990, ett intro på
11 s), Jerkland II (1994, ett sampel på 14 s) och Just Dance 64 (2011, NMI:n skriver röst 2 och 3:s frekvens- och
kontrollregister 3910 gånger i sekunden). Alla nio spelar i VICE (6581) som demot självt, RMS per sekund:
- Youthquake 2006, 2342, 1983, 1579 mot 1924, 2178, 2196, 1601;
- Wonderland IV 2881, 2910, 2958, 2847 mot 2967, 2919, 2914, 2923;
- Wonderland V 2790, 2962, 3032, 2071 mot 2888, 2876, 3094, 1965, båda tysta efter 11 s (demot går sedan vidare till
  nästa del);
- Jerkland II ljud i 13 s och sedan tyst, som demot (14 s);
- Just Dance 64 1085, 1007, 890, 1034 mot 1151, 991, 930, 1004, med samma tysta stycke efter 9 s.

Macho Programming (2003) tas inte längre: dess NMI spelar genom en tabell på `$0400` som programmet bygger. Ensam gav den
en ton på 6,8 kHz (nollgenomgångar 6850 i sekunden mot demots 1500). Exporten bygger alla nio byte för byte, med den
inbyggda assemblern och med KickAss.jar. På de 194 program som har en kandidat tar analysen 46,3 s mot 39,8 s förut. De
nio demona står för 5 s, mest Wonderland IV (1,2 s med IRQ:n körd i tre minuter), de andra för under 0,3 s var. Övriga
program kör inget nytt.

`MusicInfo.run` säger vad körningen gav (register, toner, sekunder). Fyndets skäl (`MusicInfo.why`, i inspektorn och analysloggen) säger hur spelaren hittades, t.ex. *Music detected at $1000-$1fff (score 9: JMP init / JMP play table, called from outside, page aligned, writes 13 SID registers, 4 instructions decoded from the table (the trace did not reach them), note frequency table at $14bb, init and play run: 13 SID registers and 3 notes in 3 s)*. En snapshots spelare som spelar vidare har *init does not start it again (11 SID registers and 3 notes in 60 s), play goes on from the snapshot: 22 SID registers and 596 notes in 60 s*, och en som hittats på sin kod men inte spelar *running init and play plays nothing (…)*. Exporten skriver en **PSID v2-fil** (`music/music_1000.sid`, init/play, PAL, 6581) och laddar den idiomatiskt:

```
.var music = LoadSid("music/music_1000.sid")
        jsr music.init
        jsr music.play
.pc = music.location "Music"
        .fill music.size, music.getData(i)
```

Referenser in i musiken som inte är init/play blir `music.location+$xx`. Användaren kan när som helst byta blocktyp till Code för att disassemblera spelaren.

**Test:** `test/music.test.ts` bygger en spelare med en PAL-nottabell. Den testar:
- init och play anropade, och en VICE-snapshot tagen efter init där bara play är spårad, från IRQ:n. Källkoden får där
  `jsr music.play`, och verifieringen ger samma byte;
- en spelare som inget spårat når, på en sidgräns, och en sidförskjuten som bara körningen hittar;
- en musikfil som laddats ensam, med tabellen på laddadressen (programmets start);
- en låt vars init inte gör något (`rts` med tempo och rad i de två byten efter, `nop / rts`, `nop / nop / rts`) och
  vars play-kod kör igenom en `JMP` som spelar när den körs som tabell. Låten testas laddad ensam och med play anropad
  från IRQ:n, och blocket spelar ensamt. Regeln från före ändringen väljer `JMP`-instruktionen, med blocket från
  variablerna efter `rts`. En tom init räknas inte utanför en sidgräns, och inte när koden efter den inte spelar;
- en buffrad spelare (`sta $d400,x` till `cpx #$19`): 25 register, och hittad ensam genom körningen;
- låtdata som spelaren läser genom en pekare, förbi en byte som programmet läser: blocket når låtens slut;
- en lös fil vars låt börjar efter 100 tysta bildrutor, med en `JMP` mitt i play-rutinen som spelar genast: spelarens
  tabell väljs, blocket spelar ensamt, och skuret före koden som `JMP`-instruktionen går till säger kontrollen var det
  tar slut (med regeln från före ändringen väljs delen);
- en snapshot där init inte längre startar om låten: `resume` får nollsidans byte, och spelardatan med rutinen som
  lägger tillbaka dem spelar ensam i minnet, men inte utan den;
- play efter två och efter fyra `JMP`, och play-kod direkt efter `JMP init`;
- IRQ:ns ingång före en volymingång som programmet anropar;
- programmets starttabell och en rutin som anropar play, som inte är spelare;
- ett `JMP`-par i kod som rensar SID, som inte är någon spelare;
- notfrekvenstabeller i båda layouterna, och att en ramp, en fyllnad och en sinus inte är det;
- en samplingsspelare som Voodoo Peoples (NMI kopierad till `$0080`, `$fffa` med KERNAL ute, sidor med sampel på
  `$4000`–`$5fff` till två pulsbreddsregister): init, play 0, takten, registren, blocket med NMI:ns källa, samplen som
  del och som data, och att den spelar ensam med sina delar; en genom KERNAL:s `$0318` med 4-bitars sampel till volymen
  i blocket; en vanlig spelare vars init också startar en NMI med trumsampel (den behåller sin play och får `digi`,
  med samplen som del); en spelare vars init inte återvänder (programmets start går i en slinga): blocket är NMI:n,
  `resume` har `$01`, vektorn och pekaren i nollsidan, och rutinen bredvid blocket startar CIA 2:s timer igen; en
  sekvenserare i programmets IRQ som startar ett sampel var 25:e bildruta, med en NMI i två halvor som pekar vektorn på
  varandra (rutinen sätter `$0314` och slår på rasteravbrottet); en NMI som spelar genom en tabell som inget laddat
  (ingen spelare); och att en NMI som skriver samma värde varje gång, eller en timer en bildruta lång, inte är någon;
- en spelare utan hopptabell (som Bomb Jacks): IRQ:n anropar play på `$1000`, och programmets rutiner på `$0900` och
  `$0920` startar två låtar (pekaren, flaggan som play läser, volymen). Blocket är play och låtarna, inte rutinerna;
  rutinen efter blocket spelar låt 0 och 1 ensam (låt 7 ger låt 0), `.sid`-filen har två låtar, och en byte under
  KERNAL ger play genom `$01 = $35`. En rutin som bara startar fyra toner (en ljudeffekt) ger ingen spelare.

`test/sidplayer.test.ts` spelar en samplingsspelare vars init också startar ett rasteravbrott (en JAM utanför blocket):
delarna på `$e000` och `$4000` hamnar rätt, NMI:n spelar, rasteravbrottet körs aldrig och skärmen säger *NO PLAY*, i
Sindris C64 och i riktiga VICE (debugcartridge efter 4096 sampel). Delarna ligger i PRG:n där de körs, eller i luckan
från `$0c00`. En spelare vars init inte återvänder spelar från det som läggs tillbaka (vektorn, pekaren) med timern
startad igen: drygt 140 avbrott per bildruta.

`test/sidrun.test.ts` testar körningen: register, toner och använda byte för en spelare, play utan init, och varför en
körning som inte är någon spelare slutar (init återvänder inte, BRK, ingen SID-skrivning, kod utanför det laddade).

Det differentiella testet låter referensen anropa den nya detekteringen (avvikelse 18), så att resten av analysen
jämförs som förut.

**Mätt på riktiga program:** 1060 program ur referensarkivet (intron, demos och spel, uppackade med unp64). 57 av dem har
en `.sid`-fil bredvid sig som facit (adress, init, play). Den nya detekteringen hittar 54 av dem rätt, mot 30 förut. Av
de tre andra:
- en `.sid`-fil har en egen init (`$dff6`) som demot inte använder (demot anropar `$e000`/`$e003`, som hittas);
- en spelare saknar hopptabell;
- en spelare har play direkt efter `JMP init` utan nottabell, med bara init anropad.

**Mätt med körningen (2026-11-06).** Facit är en körning av varje hopptabell i filen (init, sedan play i tre sekunder;
den som startar flest toner), eller den `.sid`-fil som ligger bredvid programmet:
- **Lösa musikfiler från trackmo-diskar** (The Lab sida 1–3, 1337, Multiverse sida 1–2, Viva Las Vegas; Bitfire-filerna
  uppackade och analyserade en och en, som när de laddas från en monterad disk): 12 av 12 låtar får rätt init och play,
  mot 5 utan körningen. 3 fick förut en inre tabell (tyst), 4 hittades inte. Ingen av dem läser byte utanför sitt block
  under en minut, och de spelar i VICE.
- **Montera, ladda första filen, packa upp** (Sindri kör startprogrammet med disken i en 1541 tills demot väntar): The
  Lab sida 1 ger `$1000–$1d1a`, init `$1000`, play `$1003`, och spelar i VICE. Förut valdes delen `$10de` av play-rutinen,
  vars block saknade koden på `$1012–$1025`: spelaren körde in i en BRK på `$101c` och kraschade. Sindri sparar också det
  som tidigare lager lämnat och som programmet fortfarande kör, och det ett lager självt laddar och kör efter start (se
  Sindris avsnitt). Därför finns musiken med också där den laddats av ett tidigare lager (1337: lager 4, `$0e00–$1c7a`,
  medan del 1:s kod är `$7400–$ffff`). Av tio trackmos och demos på disk spelar nio i VICE: The Lab, 1337 (`$1000`),
  Eyes, Multiverse, No Bounds (`$0900–$1fff`), Viva Las Vegas (`$0c00–$1b09`), i27, O-tech III och Ranx. Codeboys
  valdes fel (init `$109b`, 3 toner och sedan tyst) tills tabeller med en init som inte gör något kom till (nedan).
- **VICE-snapshots** av The Lab (efter 30, 60, 90 och 120 s), Viva Las Vegas (40 och 80 s) och Multiverse (40 och 80 s):
  alla 8 rätt init och play. The Labs första spelare spelar vidare från snapshoten (init startar 3 toner på en minut, play
  utan init 596); förut var den tyst. Blocken når låtdata som förut föll utanför: The Labs andra låt `$0600–$1a1c`
  (förut `$0fff`, tyst efter 15 s), Viva Las Vegas `$0c00–$1b09` (förut `$1485`, fel efter 0,2 s).
- **Program med en `.sid` bredvid sig** (565 `.sid`-filer i CSDB-intron, CSDB-demos och CSDB-spel, uppackade med Sindri):
  i 88 av dem finns `.sid`-datan i programmets minne. 82 får `.sid`-filens init och play, mot 79 utan körningen, och i 75
  av dem täcker blocket hela `.sid`-datan, mot 48 (oftast var det låtdatans sista byte som saknades). Inget program fick
  sämre resultat. Av de sex andra har tre en egen init i `.sid`-filen (`$0ff6`, `$dff6`) som programmet inte använder (dess
  egna ingångar hittas), och tre saknar en vanlig hopptabell.

**Mätt med en init som inte gör något (2026-11-07).** HCL:s spelare i Booze Designs demos har ingen hopptabell. På
sidans start ligger en `rts` (ibland `rts / nop / nop` eller `nop / nop / rts`), och play börjar direkt efter med att
räkna bildrutor. Förut valdes en `JMP` inne i play-koden, som bara kör en del av rösterna.
- **BoozeLoader-diskarnas filer,** 1 281 filer från de 57 olika diskarna, öppnade en och en som från fliken
  *Booze script*: 8 fynd ändrades, och alla fick init på sidans start och play på `+3`. Codeboys fem låtar (file25
  `$1000`, file1e `$e000`, sida 2:s file03, file05 och file0b) spelade 3 toner och sedan inget, och spelar nu med 22–24
  register. Andropolis `$4000` och Mekanix `$8000` hade fått en inre `JMP` (`$400d`, `$800d`). Mekanix `$1000` hade fått
  init `$1003`, en `JMP` till play-koden. Musik hittas i 111 filer, lika många som förut.
- **Startprogram,** 865 stycken (CSDB:s Top 500 och Booze Designs, uppackade med Sindri): 2 fynd ändrades. Codeboys
  `$1000–$1baa` med play anropad från IRQ:n hade förut init `$109b`. Mekanix `$0800–$1f07` hade förut `$0af7`, en `JMP` mitt
  i play-koden. Musik hittas i 659 program, lika många som förut.
- **I VICE** (`vsid`, 20 s) är file25 med det gamla fyndets init `$1145` och play `$1148` nästan tyst (RMS omkring 200
  efter första sekunden). Med init `$1000` och play `$1003` spelar den hela tiden (RMS 1 500–2 800). Alla tio nya block
  spelar ensamma (`musicPlayData()`).
- **Tid:** ingen skillnad (startprogrammen 339 s mot 344 s, filerna 143 s mot 145 s).

**Tid.** Utan körningar tar detekteringen 10–20 ms för en hel snapshot. Körningarna lägger till 30–300 ms första gången
ett minne analyseras (mest de tre minuterna av låten som ger blockets omfång, och för en snapshot två minuter för att
pröva init), och knappt något i analysens följande varv, som får körningarna ur sparade resultat.

### 8.7 VIC-II-evidens och grafik

Konstanta skrivningar ger exakta adresser:

| Register | Tolkning |
|---|---|
| `$DD00` | bank = 3 − (v & 3), bankbas = bank × `$4000` |
| `$D018` | skärm = bankbas + ((v >> 4) & 15) × `$400`; tecken = bankbas + ((v >> 1) & 7) × `$800`; bitmap = bankbas + ((v >> 3) & 1) × `$2000` |
| `$D011` bit 5 | bitmappsläge (annars teckenläge) |
| `$D016` bit 4 | multicolor |
| skärm + `$3F8…$3FF` | spritepekare: data på bankbas + v × 64 |

**En VICE-snapshot** (13.7) ger också det dess VIC-II visade när den sparades, när skärmen var på och läget giltigt:
skärmen (också på `$0400`, som annars inte räknas), teckensetet (512 byte med ECM; inte teckens-ROM:en) eller bitmappen,
och varje påslagen sprite, med skälet *the snapshot's VIC shows the screen at $0400 ($d018=$1c)* respektive *… shows
sprite 7 from pointer $07ff = $87*. Banken, `$d018`, bitmappsläget, multicolor och spritarnas multicolor (`$d01c`) räknas
in i VIC-evidensen, och spritarna blir spritepekare. Programmets egna skrivningar kommer först: ett fönster som båda ger
får kodens skäl.

Med bankspårning (8.7b) räknas en `$D018`-skrivning som bitmapp bara när den `$D011`-skrivning som ligger närmast i koden slår på bitmappsläget. En delad skärm (en bitmapslogga ovanför text) ger då både bitmappen och teckenuppsättningen. Utan bankspårning gör bitmappsläge någonstans varje `$D018`-värde till en bitmapp. Teckenuppsättningar på `$1000–$1FFF` i bank 0 och 2 är ROM-skuggor och ignoreras. Inget fönster läggs över nollsidan och stacken (`$0000–$01FF`), som CPU:n ändrar hela tiden: `$d018=$30` i bank 0 (teckensnitt på `$0000`) eller en bitmapp på `$0000` blir ingen grafik, och loggen säger det när fönstret täcker laddade byte (*$d018=$30 would put the charset at $0000, over the zero page and the stack, …*). Ett fönster (teckensnitt, skärm, bitmap eller sprite) får sin typ bara på byte som fortfarande är data, och bara om det mesta av det som är laddat i fönstret är data, inte kod eller musik. En bit mellan kod som är kortare än ett tecken eller en bitmappscell (8 byte) förblir data. En variabel mellan två rutiner i fönstret blir alltså inget Charset-block på en byte. Varje bit får fönstrets skäl (*$d018=$1c selects charset at $3000*). Utan registerevidens används storlek och justering, med lägre konfidens: 8000 byte på 8K-gräns → bitmap, 2048 byte på 2K-gräns med tecken-lika celler (≤ 6 olika bytevärden per 8-bytecell i > 80 % av cellerna) → teckensnitt. Inspektorns förhandsvisning (Sprite/Chars/Bitmap, hires/multicolor) låter användaren bekräfta eller hitta grafik som heuristiken missat.

### 8.7b Minneskonfiguration ($01) och VIC-bank

Samma adress kan betyda olika saker beroende på 6510-porten `$01`: bit 0–2 (LORAM, HIRAM, CHAREN) väljer en av 8
konfigurationer (utan cartridge, DDR `$2F`). `$A000–$BFFF` är BASIC-ROM eller RAM, `$D000–$DFFF` I/O, tecken-ROM eller RAM,
`$E000–$FFFF` KERNAL-ROM eller RAM. Skrivningar till ROM-områdena går alltid till RAM under.

**Dataflöde (pass 2, efter spårningen i pass 1).** `analyze/banks.ts` följer för varje instruktion vilka konfigurationer
och VIC-banker den kan köras med, som mängder (bitmasker). Varje register bär de möjliga värdena på sina bit 0–2, så
`lda #$35 / sta $01`, `dec $01` / `inc $01`, `lda $01 / and #$f8 / ora #$05 / sta $01` och `ldx #$34 / stx $01` följs exakt;
allt annat gör registret okänt. Där vägar möts slås mängderna ihop.

- Programmet startar med `$37` och VIC-bank 0. En VICE-snapshot fortsätter i stället med det `$01` och den VIC-bank som snapshoten har (`$DD00` och `$DD02` ur modulen CIA2, `snapshotVicBank`), från programstarten, från PC och från avbrottsrutinerna som dess vektorer pekar på.
- Subrutiner lämnar tillbaka sitt tillstånd till varje anropare (via sina RTS); anrop utanför filerna (KERNAL) lämnar `$01` orört men registren okända.
- Avbrottsrutiner startar med det huvudkoden satt, begränsat av vektorn: `$0314/$0318` kräver KERNAL (HIRAM = 1), `$FFFE/$FFFA` kräver den urkopplad (HIRAM = 0). En rutin som kvitterar sitt avbrott (skriver `$D019` eller läser `$DC0D`/`$DD0D` innan den ändrar `$01`) körs dessutom med I/O synlig. Annars skulle avbrottet aldrig kvitteras och komma igen direkt. En huvudloop som växlar mellan `$35` och `$34` för att nå RAM under I/O, som en loader gör, ger därför inte IRQ-rutinens `sta $d012` en RAM-etikett (`var_d012`) med *RAM or I/O*.
- Kod kan bara köras där CPU:n ser RAM: kod på `$E000–$FFFF` körs med KERNAL ute, på `$A000–$BFFF` med BASIC ute, på `$D000–$DFFF` med allt RAM.
- VIC-bank: `$DD00` bit 0–1 ger bank 3 − v; tricket med `$DD02` (bankbitar som ingångar, läses som 1) ger bank v & 3 och antar att `$DD00` bit 0–1 är 0. En skrivning dit räknas bara där I/O syns.
- **BankZone** (användarens ord, högerklick → *Memory banking* → *Memory configuration ($01)* / *VIC bank*, eller inspektorn för ett kodblock): ersätter det detekterade tillståndet för instruktionerna i intervallet och flödar vidare till koden de når.

**Användning.** En operand i ett växlingsbart område namnges efter vad instruktionen når: alltid I/O eller ROM → hårdvaru-
eller ROM-namnet (`VIC_BORDER_COLOR`, `CHROUT`), aldrig etiketten på RAM-bytes under; alltid RAM → etikett eller adress,
aldrig ett hårdvarunamn (CPU-vektorerna `$FFFA–$FFFF` behåller sina namn). En åtkomst som alltid når I/O eller ROM ger
inte heller någon etikett där: ett block över I/O-området i en minnesdump (till exempel en charset över `$2000–$FFFF`)
delas därför inte av `charset_d020:`-rader för registren som koden skriver. Går det inte att avgöra, för att konfigurationerna
skiljer sig eller `$01` är okänt, räknas `$D000–$DFFF` som I/O (`reachesForName`): registret behåller sitt namn
(`sta VIC_RASTER`, inte `sta var_d012`) och ingen etikett skapas där, också när RAM under I/O är laddat (som i en
snapshot). Bara kod som säkert körs med RAM där (`$30`, `$34`) får RAM-etiketten. I övriga växlingsbara områden behålls
det vanliga namnet när det varierar. I båda fallen får raden kommentaren t.ex. `RAM or I/O: $01 is $34 or $37 here`. Skrivningar till `$01`/`$DD00`/`$DD02` får kommentaren
`memory $35 (RAM · I/O · RAM)` respektive `VIC bank 1 ($4000-$7fff)` och en rad i loggen; ett värde som inte går att följa
ger ett tips om att sätta konfigurationen. VIC-evidensen (8.7) använder banken där `$D018` och spritepekare skrivs, eller den
som en `$DD00`/`$DD02`-skrivning högst 5 instruktioner efter `$D018`-skrivningen väljer (`sta $d018 / lda #$00 / sta
$dd00` räknas i bank 3), och bortser från VIC-skrivningar med I/O urkopplat. Statusraden visar `$01` vid markören.

Namnen ändrar aldrig byten, så round-trip-garantin gäller oförändrad. Inställningen *Follow the memory configuration
($01) and VIC bank* (`bankTracking`, på som standard) stänger av allt detta; differentialtestet mot prototypen kör med
den avstängd. Utan den skrivs kodens åtkomster till I/O inne i de laddade bytes (en minnesdump över `$D000–$DFFF`) som
etiketter, t.ex. `sta charset_d020`. Analysen varnar då en gång (`ioLabelNotice`, kategori `banks`) med antal och de
första adresserna. I Problems har raden knappen **Turn on**, som slår på inställningen (ångras med `Ctrl+Z`).
Inställningen sparas i projektet och följer med till nästa PRG som öppnas.

### 8.8 Dataklassificering

Kvarvarande data delas vid objektstarter (adresser som refereras av kod, pekarmål, textpekare, tabellstarter) och varje del klassas med en beslutslista i prioritetsordning:

1. Lo/hi-tabell (8.5) · 2. Text med kodevidens (PETSCII eller screen codes, inklusive terminator; en sträng till en utskriftsrutin så lång som parametrarna säger, 8.5) · 3. Fyllnad: alla byte lika (≥ 3 byte orefererat, ≥ 8 refererat) eller inre serier ≥ 32 byte · 4. Färgtabell (evidens + alla värden < 16) · 5. Kurvtabell: jämn kurva (medel |Δ| ≤ omfång/6, få teckenbyten) · 6. Ordtabell där varje ord pekar på en instruktion · 7. Orefererad PETSCII-text (≥ 8 byte, > 60 % bokstäver) · 8. Grafik efter storlek/justering · 9. Variabler (lästa och skrivna, ≤ 4 byte; intilliggande slås ihop) · 10. Övrig data (`.byte`).

### 8.9 Etiketter och namngivning

| Prefix | Betydelse |
|---|---|
| `start` | Programmets startpunkt (SYS) |
| `irq_` `nmi_` `brk_` | Avbrottshanterare från vektorer eller tabeller |
| `sub_` | JSR-mål |
| `fx_` | Mål i en hopptabell |
| `loop_` / `skip_` / `l_` | Bakåtbranch / framåtbranch / blandat eller JMP |
| `smc_` | Instruktion som modifieras av annan kod |
| `txt_` `sine_` `colors_` `tbl_` `var_` `data_` | Data efter klassificering och åtkomst |
| `ptrlo_` / `ptrhi_` | Lo/hi-pekartabeller |
| `spr_` `charset_` `bitmap_` `screen_` | Grafik |
| `ptr_xx` / `zp_xx` | Nollsidesvariabler (pekare respektive övriga) |

Namnen innehåller adressen och är därför unika. Användarens namn ersätter dem överallt; validering kräver giltig Kick-identifierare, inget mnemonic-namn och ingen dubblett.

**Inuti en bitmapp** får en adress som koden läser eller skriver ingen egen etikett, bara bitmappens start har en. Koden
räknar i stället från närmaste etikett före adressen, hur långt bort den än är: `sta bitmap_6000+328,x`. Ett annat
datablock får fortfarande en etikett där koden läser det. Kod som ritar i en bitmapp (The Lab, med bitmappen på `$6000`)
läser och skriver över hela den, en del med 919 adresser. Varje sådan etikett blev en egen rad som delade bilden i
listningen. De som låg mitt i en cell hamnade i en lång rad under bilden, och ett klick på en av dem markerade bara den
cellen. Utan etiketterna är bilden hel igen, och bitmappen kan sparas som en binärfil (`.import binary`), eftersom det
inte finns något inuti den att definiera. En etikett som användaren själv satt i bitmappen finns kvar, och koden räknar
från den efter den. Test: `packages/core/test/bitmap-labels.test.ts` (även referensens avvikelselista) och *a bitmap the
code draws into* i `apps/desktop/test/gfxlines.test.ts`.

### 8.10 Konfidens och förklaringar

Varje block har `conf` (0–1) och `reason`. Inspektorn visar dem som "high / medium / low confidence" och en "Why"-rad. Block med låg konfidens får en `?`-markör i listningen så att användaren vet var granskning lönar sig.

### 8.11 Diagnostik

| Diagnos | Regel |
|---|---|
| Komprimerat program | Oklassad data ≥ 2 KB med entropi > 7,2 bitar/byte → råd att packa upp först. |
| Kodö (ospårad kod) | Ett datablock som börjar med en rutin blir kod, se nedan. |
| Trolig oupptäckt kod | Datablock som avkodas till ≥ 6 dokumenterade instruktioner och slutar med RTS/JMP men inte klarar kodöns krav → hint med ett klick "Mark as code". |
| Oupplöst indirekt hopp | `JMP (ind)` utan känd tabell → varning. |
| JAM, BRK, överlapp, kod in i data | Fel/varning med klickbar adress. |

**Kodöar** (`codeIslands()` i `analyze/diagnostics.ts`, inställningen *Decode unreached code that reads as a routine*,
`Settings.codeIslands`, på som standard). Kod som inget spårat når blir data, till exempel en startrutin som redan har
körts när en snapshot tas. Ett datablock (inte användarens) som börjar med en rutin blir därför kod.

Rutinen får börja efter fyllnad (3+ lika byte) och efter byte som koden läser eller skriver, på någon av de 8 följande
adresserna. Den ska ha minst 6 dokumenterade instruktioner och sluta med RTS eller JMP. RTI räknas bara om rutinen
kvitterar ett avbrott: `$40` avslutar många tabeller. Dessutom gäller:
- **ingen BRK** (nollor);
- **allt inom blocket**, och varje gren landar i det (efter starten) eller på spårad kod;
- **ingen JSR/JMP** in i mitten av en spårad instruktion, eller in i en musikspelare annat än dess init och play (en
  kopia av spelarens kod);
- **ingen 1541-kod:** högst en åtkomst till driverns VIA (`$1800–$180F`, `$1C00–$1C0F`) eller `bvc *`, för en
  snabbladdares drivkod är data för C64:an.
- **över en utskriven sträng efter en JSR:** en `jsr` till en rutin som skriver ut strängen efter sig (8.5) hoppar över strängen, och strängen räknas som fyra instruktioner: `jsr print / "WRONG FILETYPE", 0 / jmp error` blir en ö. Ett `jmp` vidare till en sådan rutin räknas likadant (`jsr setcursor / jmp print`), och byte som en rutin läser efter anropet (8.5) hoppas över. Sådana starter prövas först i blocket, och en annan ö i blocket får bara gå in i en av dem vid dess start.
- **inte över en utskriven sträng:** en ö som hittas i samma varv som anropet som skriver ut en sträng (8.5) kan börja
  inne i strängen och avkodas vidare in i koden efter den (*HUS...*, `$0d`, `$0d`, `$00` blir `pha / eor $53,x /
  rol $2e2e / ora $000d` före `inc $01`, i en cartridgebank utan egen start). Byten i strängar till utskriftsrutiner som
  kod spårats över (minst 4 byte, nästan bara bokstäver, siffror, skiljetecken och styrkoder) håller öarna sig därför
  utanför i nästa analys: den vanliga analysen görs om en gång när det händer, och en djupanalys tar med byten till nästa
  varv (`textUnderCode()` i `strings.ts`).

Starten blir en ingångspunkt av sorten `guess` (etikett `code_xxxx`, i inspektorn *Unreached code* med knappen *Mark
as data*). Spårningen fortsätter därifrån, så också det rutinen installerar (en IRQ via `$fffe`) och anropar hittas.
Sedan klassas minnet om för att hitta nya öar, i högst 4 varv, och 5.8–5.11 körs en sista gång. Spelare som hittats
behålls. Loggen får en rad per ö (*Unreached code at $0197: 26 instructions ending in RTS, so it is decoded as code.
Mark it as data (D) if it is not.*). Markerar användaren blocket som data (`D`) blir det data, och spårningen går inte
in i det. Det differentiella testet kör med inställningen av.

**Mätt** på 1060 riktiga program ur referensarkivet: 734 av dem får kodöar (3 495 öar, en fjärdedel mer kod). Alla
734 återskapas byte för byte, musikdetekteringens facit är oförändrat (54 av 57), och analysen tar i snitt 1,5 gånger
så lång tid (250 ms för en hel snapshot).

### 8.11b Packade program och uppackning

`detectPacking()` (`packages/core/src/packing.ts`) körs efter analysen och ändrar ingenting i den. Den avgör om en fil
är en uppackare (decruncher) framför komprimerad data. Tecknen är kalibrerade på några hundra PRG:er ur CSDB-arkivet:

- **Komprimerad data:** andelen 1 KB-fönster med minst 7,2 bitar entropi per byte. Kod ligger nära 6, text och grafik
  lägre, och moderna crunchers ger 7,5–7,95 rakt igenom.
- **Nästan ingen spårbar kod:** uppackaren kopierar sig själv och hoppar till kopian, vilket en statisk spårning inte
  kan följa. En packad fil visar därför några dussin byte kod. Äldre crunchers ger mindre entropi, ungefär 6,5–7.
- **Ett packarnamn i filen** (ASCII, PETSCII eller skärmkoder): Exomizer, PuCrunch, ByteBoozer, TSCrunch, Subsizer,
  Level Crusher, Time Cruncher, Dali, ZX0, Cruncher AB, Matcham, Sledgehammer eller "crunched/packed by".
- **En känd uppackares kod vid programstarten** (`stubSignature()`): Action Replays backuper (Datels frysmodul,
  *DISK SAVE – TURBO* och *STANDARD*) är en PRG på `$0801` vars kod på 2061 flyttar den packade datan till toppen av
  minnet, återställer VIC, SID och CIA, stänger av modulen och fortsätter i nollsidan på `$008e`. Koden söks vid
  programstarten och på 2061 i en fil på `$0801` (där BASIC-raden ibland är ändrad: NOP:ar, en REM). Deras packade data
  har mestadels 6,5–7,4 bitar per byte (median 6,9), så tecknen ovan gav förut *packad* för 606 av arkivets 2700
  backuper, *kanske* för 898 och ingenting för 1196; nu blir 2699 packade med namnet *Datel Action Replay backup*.
  Freeze Machines backuper (Eveshams frysmodul) börjar likadant, lägger tillbaka nollsidan, stacken och färgerna ur
  filen, återställer SID, CIA och VIC och fortsätter i nollsidan på `$007e`, vilket ingen AR-backup gör. En *Split
  Freeze* är två filer: den första har toppen av minnet och en laddare som laddar den andra, en hel backup, över sig
  själv och fortsätter på 2061; dess kod från `$0850` är kvar från en backup, också `jmp $007e`. Av arkivets 133 filer
  som unp64 kallar Freeze Machine (124) eller Freeze Machine Split Freeze (9) gav tecknen förut *packad* för 31 (3 av
  dem genom texten "a cruncher"), *kanske* för 60 och ingenting för 42; nu blir alla 133 packade med namnet *Evesham
  Freeze Machine backup*, liksom en backup på en Kick Off-disk som unp64 inte känner igen. Ingen av de 2700 AR-backuperna
  och ingen av 1978 andra filer ur arkivet får ett annat besked än förut.
  Super Snapshots backuper (LMS frysmodul, *SNAPSHOT* i menyn) är en PRG på `$0801` vars kod på 2061 också stänger av
  CIA1:s avbrott (`sei / lda #$7f / sta $dc0d / sta $dd0d / lda #$34 / sta $01`), flyttar den packade datan till toppen
  av minnet, lägger tillbaka nollsidan, stacken och färgerna, återställer SID, VIC och CIA och fortsätter i nollsidan på
  `$008e`, med Action Replays uppackare där men ett annat slut. En backup som delats i två filer (*BREAK INTO 2 FILES*)
  har Action Replays split freeze-laddare först (8.11c) och en hel backup som andra fil. Av de 250 filer i arkivet som
  börjar så och har `jmp $008e` (249 som unp64 kallar Super Snapshot och ett spel sparat som "snap") gav tecknen förut,
  för de 246 som Mimirs D64-läsare öppnar, *packad* för 66 (5 av dem med fel namn: "a cruncher" och Matcham),
  *kanske* för 118 och ingenting för 62; nu blir alla 250 packade med namnet *LMS Super Snapshot backup*. Ingen av 55
  andra filer som börjar med samma instruktioner men inte har `jmp $008e` och ingen av 2959 andra filer ur arkivet får
  ett annat besked än förut.

*Packad* betyder en känd uppackares kod, eller att minst hälften av fönstren ser komprimerade ut, eller lite kod och
minst 7 bitar per byte, eller ett namn tillsammans med komprimerad data. *Kanske packad* betyder minst 20 % av fönstren i en fil med lite kod (under 10 %),
eller lite kod och minst 6,4 bitar per byte. Demon och vanliga program blir inte packade. Filer under 1 KB bedöms inte.

**Sindri, den inbyggda uppackaren** (`packages/sindri`, `@mimir/sindri`) kör varje öppnad fil i en emulerad C64, i en egen
Web Worker. Med C64-ROM:arna från användarens VICE (mappen `C64` bredvid x64sc i inställningarna, annars en VICE den
hittar; huvudprocessen läser dem, kanalen `toolchain:roms`) startar den maskinen, laddar filen och skriver `RUN` eller
`SYS` (se *Hur Sindri startar filen* nedan); utan
dem kör den med små ersättare för KERNAL och BASIC. Ett nytt lager börjar när processorn hoppar in i kod som det
körande lagret skrev och inte har kört, eller med `JMP`, `RTS` eller `RTI` in i kod som det körde förut och sedan
skrev om till annan kod (12 av de 16 byten därifrån skrivna sedan dess, och minst hälften av byten där instruktioner
började är nu andra): The Last Ninja 3 +6 Censor anropar sin laddare på `$0400`, kopierar spelet den laddade över den
och återvänder in i spelet där. Ett `JSR` in i sådan kod är ett anrop som förut (många laddare kopierar en rutin på
plats före varje anrop), och samma kod kopierad dit igen är samma program. En uppackare som rensar BASIC:s variabler
med `JSR $A659` (CLR) och sedan hoppar till programmet den packade upp får tillbaka sitt anrop fast CLR flyttar sin
returadress till en ny stack på `$01fa`: lagret är koden den hoppar till, inte ett BASIC-program (förut sparades The
Last Ninja 3:s trainermeny, Max Torque och andra som program att starta med `RUN`, och nästa körning misslyckades).
Varje lager får en sort (*mover*, *decoder*, *decruncher*, *jump*, sist
*program*) och ett fingeravtryck av opkoderna det körde, som de var när det körde dem (så behåller en uppackare i
nollsidan sitt fingeravtryck fast programmets egen nollsida skrivs över den innan nästa lager börjar); `data/signatures.json`
har 332 kända fingeravtryck från 138 packare, och ett lager som liknar ett av dem till minst 80 % får dess namn. Båda
lagren i en Action Replay-backup (`$080d` och `$008e`) heter *Datel Action Replay backup*, i 2640 av arkivets 2700.
Båda lagren i en Freeze Machine-backup (`$080d` och `$007e`) heter *Evesham Freeze Machine backup*: med disketten i 99
av arkivets 124 och 1 till med `-e 2061` (ändrad BASIC-rad); i 24 slutar körningen i det andra lagret, som då är sist
(programmet) och inte får något namn, för 22 av dem är BASIC-program som fortsätter i BASIC-ROM:en utan att ett nytt
lager börjar. En Split Freeze packas bara upp med sin diskett (den laddar sin andra fil): 6 av 9 får båda namnen (3 av
dem med `-e 2061`), i 3 slutar körningen i det andra lagret; utan disketten stannar de vid laddningen. Inget lager i
en AR-backup heter Freeze Machine eller tvärtom, och på 1978 andra filer ur arkivet behöll alla 1801 namngivna lager
sina namn. Båda lagren i en Super Snapshot-backup (`$080d` och `$008e`) heter *LMS Super Snapshot backup*: 3
fingeravtryck lärda av arkivets 250 och 3 sparade med en Super Snapshot V5 i VICE (första lagret körde likadant i alla,
det andra på två sätt) namnger båda i 252 av de 253 och i den sista med `-e 2061`; inget av dem heter Action Replay
eller tvärtom. En backup sparad som två filer (Super Snapshots *BREAK INTO 2 FILES*, Action Replay 4:s split freeze)
laddar sin andra fil med namnet den själv laddades med, där BASIC:s LOAD lämnade det. Sindri laddar därför en fil från
en disk som `LOAD"namn",8,1` gör: namnet ur diskens katalog ligger under `$a000` och `$b7`, `$bb` och `$bc` pekar på
det (det sparade programmet får tillbaka det som låg där, om inte programmet laddade en fil med namnet eller själv
skrev de byten). Med sina disketter packas
104 av arkivets 106 Action Replay-delningar och 29 av 31 Super Snapshot-delningar upp med båda lagren namngivna (5
fingeravtryck för första lagret, där laddaren och backupens uppackare körde som ett); förut fick laddaren inget namn.
På 100 demodisketter ur CSDB:s Top 200 gav ändringen samma lager och start; 92 sparade samma byte, och i 8 har det
sparade programmet namnet under `$a000`, där programmet självt flyttade minnet ut och tillbaka, som det skulle på en
C64. En fil som den skalar ett
lager av visas som
packad, även om tecknen ovan inte räckte, med lagren i notisen (`unpackSummary()` i `packages/core/src/sindri.ts`:
"Sindri peels off 2 layers: Exomizer v3.0 (a decruncher at $0100) …; the program starts at $1000") och
packarnamnen i rubriken. Skalar den inget lager av fast den körde programmet tills det stod still (eller gick tillbaka
till BASIC) och tecknen bara räcker till *kanske*, visas ingen notis.

*Inte packat* (`notPacked()` i Sindri) är ett program som bara har ett lager, sig självt: det hoppade aldrig in i kod
det själv skrev, och körningen slutade där program hamnar, stilla eller tillbaka vid READY, utan att det sprang på en
BRK på vägen. Kod det skrev och anropade som subrutin, eller byte det ändrar i sina egna instruktioner, gör inget nytt
lager. Lagerrapporten slutar då med `not packed: it ran as it is and never jumped into code it wrote` i stället för
`nothing was unpacked`, och lager 0 kallas inte uppackare (förut stod det *unknown depacker* under ett program som
inte var packat). **Unpack** säger att filen inte är packad (rubriken *X is not packed: Sindri ran it, and it never
jumped into code it wrote (it stopped: …). There is nothing to unpack.*, en vanlig notis), inte att Sindri misslyckades;
notisens rad lyder *Sindri finds it not packed: …*. En körning som slutade på en gräns, en laddning, en reset eller en
krasch säger ingenting åt något håll och heter som förut *nothing was unpacked* (*Sindri could not unpack*): programmet
kan ha packats upp senare. Med ROM:arna tar KERNAL:ens BRK-rutin en krasch till READY, så en BRK som KERNAL:en tog
(`UnpackResult.brk`) räknas inte som ett slut: annars kallades program som Sindri startade på fel adress inte packade
(Channel 42:s intro, som börjar på `$0450` och som unp64 packar upp med CruelCrunch). Morning Stretching (Samar, Zoo
Party 2024), ett *one block intro* på 249 byte med rasterstreck och SID-ljud, gav förut *Sindri could not unpack*.
Över 1 086 utgåvor ur arkivet (Misc-top200, Onefile-top200, demodisketterna och spelen i CSDB:s Top200 och 317
intron, första programmet med sin disk) är 120 inte packade (92 stilla, 28 tillbaka vid READY; 60 är på högst 256
byte), 924 packas upp och 42 säger ingenting (7 av dem är BRK-krascherna ovan); unp64 packar inte upp något av de 120.
Fyra av dem (Dame Kitty, Kolmiolaake, Rewind, demo._pxp: demos med komprimerad data som de själva packar upp) har
ändå tecknen för *packad*, och notisen står kvar med Sindris rad.

Mot unp64 på 550 intron och demos ur arkivet ger
den samma startadress och samma byte för 488 och går ett lager djupare för 17; på 473 andra filer namnger den 429
packare precis som unp64, 2 med samma familj och ingen fel.

**Diskettstationen.** En fil som öppnas från en monterad D64 packas upp med den disken i en emulerad 1541 på
seriebussen: en egen 6502 med 2 KB RAM och DOS-ROM:en från VICE:s mapp `DRIVES`, VIA 1 på seriebussen (ATN, CLK, DATA
och stationens automatiska svar på ATN), VIA 2 på läshuvudet (stegmotor, motor, densitet, SYNC och byte ready på
processorns overflow-flagga) och disken som GCR-spår som 1541 formaterar dem, med D64-filens felbyte inskrivna.
Stationen går efter C64:an i sin egen takt (1 MHz) och hinner ikapp till rätt cykel varje gång C64:an läser eller
skriver seriebussen, så snabbladdare som räknar cykler fungerar. Startfilen läggs i minnet som `LOAD"*",8,1`, och
programmet laddar resten själv, med KERNAL eller sin egen laddare. På första disken av CSDB:s 190 bäst betygsatta demos
kommer 151 längre än startfilen (laddaren laddar och startar nästa del); utan stationen väntade 151 i startfilen, 35
gick tillbaka till READY och 4 kraschade. Ett skydd som
kräver mer än en D64 rymmer kommer igenom med skivans G64 (13.5, 13.5h): huvudet läser då spåren bit för bit, halvspår
och spår utan SYNC med.

**Nästa sida.** Ett demo på flera disketter eller sidor ber om nästa när det kommer dit ("PLEASE TURN DISK...",
"INSERT DISKSIDE 2 AND PRESS SPACE"). Mimir ger Sindri utgåvans följande sidor (13.5), och Sindri vänder disken när
programmet står still, alla tangenter är provade och textskärmen ber om det (vänd eller byt disk, sätt i en, disk 2,
sida B): disken glider ut förbi skrivskyddssensorn, stationen står tom en halv sekund och nästa glider in, så att DOS:en
ser en ny disk; sedan provas tangenterna igen. Lagerrapportens rad *Drive* säger när (`then "IT'S SHOWTIME!" at
23.6 s`). Av årsettorna i CSDB:s Year-top20 packas Mathematica (1995) upp så, från sida A: SuperCrunch och introt på
`$b000`; Tower Power 100% (1994) når sitt program på `$902d`, och Edge of Disgraces disk 0 går vidare till första
delen på disk 1A. Void och Neon vänder sida i slutet av sida 1 men sparar samma program som förut.

**Timing.** Kod som tajmar sig till cykeln behöver att C64:an tar ett avbrott i samma cykel som en riktig gör, mätt i
VICE 3.10 med testprogram (Sindris `test/timing.test.ts`): ett rasteravbrott som kommer i en instruktions sista cykel
väntar till nästa instruktion, och en tagen branch inom sidan känner av det en cykel tidigare än så. En CIA-timer som
laddas av skrivningen (force load) börjar räkna en cykel senare än en som bara startas, och en indexerad läsning över
en sidgräns läser I/O i sin extra cykel. Det C64:an gör med ATN, CLK och DATA når stationen en cykel efter skrivningen,
som i VICE. Så packas The Wild Bunch (2006), Megaparts 2 (1990), en kopia av Royal Arte (2001) och Uncensored (2014,
som återvänder till READY med ett eget avbrott igång) upp nu; på 675 andra filer kom 8 längre och ingen kortare.
En skrivning till en CIA:s kontrollregister som laddar om en timer som går (force load) eller stoppar den behåller ett
underflöde som den gamla räkningen hann till upp till två cykler efter skrivningen (omladdning) eller en (stopp)
(`Cia.write` med skrivningens cykel i instruktionen). Förut sattes timern om innan C64:an hade räknat fram den
skrivande instruktionens tidigare cykler, så ett underflöde i dem försvann. Mätt i VICE 3.10 med timer A som one-shot
från 562, startad med `STA $DD0E`: omladdad 563 cykler eller mer efter den skrivningen, eller stoppad 564 eller mer
efter, visar `LDA $DD0D` direkt efter underflödet; Sindri tappade det upp till 568 cykler. Firebirds bandladdare
startar om timern vid varje puls och tar ett underflöde som en etta: på Preservers dump av Seabase Delta kom en
FLAG-flank just efter att avbrottsrutinen läst `$dc0d` för ett timer A-avbrott, nästa omstart kom 96 cykler sent, och
en lång puls (664 cykler) lästes som en nolla; laddaren hittade sedan inte nästa block och bandet tog slut. Nu laddas
den hel. En läsning av `$dc0d`/`$dd0d` ser på samma sätt ett underflöde som timern når i den läsande instruktionens
egna cykler, till och med läsningens cykel, och tar det: flaggan kommer inte upp igen efter läsningen (`Cia.read`,
`ackA`/`ackB`). Mätt i VICE: `LDA $DD0D` som läser 565 cykler eller mer efter starten ser underflödet, och en andra
läsning 8 cykler senare ser det bara när det kom efter den första. Förut såg Sindri det först från 569 cykler, och ett
underflöde i den läsande instruktionen kom upp efter läsningen och stod kvar till nästa (`test/timing.test.ts`).

**Varje körning börjar likadant.** C64:an står vid READY efter sin uppstart, och stationen startade en stund innan,
har just läst diskens ID och har motorn igång, som efter `LOAD`. Den första körningen i en process (i appen den första
uppackningen efter start) startar upp båda en gång, var för sig (`bootC64()` och `bootDrive()` i Sindris `session.ts`),
och varje körning, den första också, fortsätter därifrån. Förut fortsatte den första körningen från sin egen uppstart:
stationen satt på bussen genom C64:ans hela uppstart, med seriebussens ledningar nere under C64:ans reset, och kom ur
takt med de senare körningarna, och Sindris kontroller (var 4096:e instruktion) räknades från strömpåslaget. Samma
disk kunde då packas upp olika beroende på vad som packats upp före: Xcusemo kom ett lager längre, Multiverse sparades
från `$0611` i stället för `$06be` och I'm Back stannade efter 4,1 i stället för 5,3 s.

Nu blir varje körning som de senare blev förut. På 144 demodisketter ur CSDB:s topplistor (startfilen med disken) och
641 intron och demos utan disk är lager, stopp och sparat program desamma som en senare körning gav förut, och lika i
den första körningen och de senare. Mot en första körning förut sparas 34 demos annorlunda: 28 med 1–81 byte som
programmet ändrar medan det kör (sprite-pekare, operander, spelarens variabler); Multiverse från `$06be`; Out of Contex
och Continuum laddar vidare (den första körningen stannade efter 167 785 lästa byte) och sparas från `$0200`,
Continuum ett lager längre; Datastorm Leftovers kör in i sin JAM senare och behåller mer av det den laddat; Abstracto
och Xcusemo stannar i sin ram, där en första körning råkade nå nästa del (Abstracto väntar vid `$c088` en sekund innan
delen på `$4000` startar; Xcusemo mitt i en färgtoning, då inget nytt skrivits på 1,5 miljoner cykler sedan motorn
stannat). Utan disk ändras inget sparat program, bara ögonblicket då körningen stannar (oftast en kontroll tidigare
eller senare).

**Hur Sindri startar filen.** Som man gör efter `LOAD"…",8,1`: `RUN` för ett BASIC-program, annars `SYS` till
laddadressen. Ett BASIC-program är en fil som laddas där BASIC börjar (`$0801`), eller som laddas under och över den
med en `SYS` in i filen på någon av de första raderna och en nolla eller ett kolon på `$0800` (`RUN` fortsätter från
byten före första raden som från slutet av en sats; allt annat ger `?SYNTAX ERROR`). Cybernoid II +17HDF laddas på
`$05b8`, mitt i skärmen, där ramens byte blir `JSR` in i packad data, och har `239 SYS2061` på `$0801`: förut skrev
Sindri `SYS1464` och körde in i en JAM. Kör `RUN` ingen maskinkod provas `SYS` till laddadressen. Bland de 2380
olika filer i arkivet som regeln gäller (första PRG:n på varje D64 och lösa PRG:er) packas 2030 upp, förut 451; ingen
som packades upp förut slutar göra det, och där starten ändrades börjar unp64 på samma rad. Har projektet en
programstart i filen (den som *Unpack* satte, eller användarens) startar Sindri den där med `SYS`, som Build & Run gör.
Då står en fil som laddas över BASIC:s start i minnet som den är: BASIC:s LOAD vid prompten länkar annars om raderna
därifrån (LINKPRG) och skriver länkpekare i det som ligger på `$0801`, vilket VICE:s `-autoload` och Build & Run inte
gör (över en fil som inte når dit länkar den om ett tomt program och ändrar inget, och får göra det som förut). Ett program
som Sindri sparat kan ha kod där: Cybernoid II:s spel (`$0208-$ffff`, start `$1400`) körde in i en JAM på `$08e3`
när Sindri körde det igen, och kommer nu förbi trainermenyn till spelet på `$0476`.
Av samma skäl står filen i minnet som den är när hoppet kommer: Sindri skriver `LOAD` och `SYS` vid prompten, så BASIC:s
`READY.` efter laddningen (rad 8, `$0540`) och den inskrivna raden (rad 9, `$0568`, och i inmatnings- och
tangentbuffertarna) hamnar över ett program som täcker skärmen; Build & Run laddar ett sådant program från VICE:s
monitor och skriver inget efter det. Precis före hoppet (`JMP ($0014)` på `$e144`) lägger Sindri därför tillbaka de
byte i filen som KERNAL och BASIC skrivit över sedan laddningen, och räknar vad programmet gör med dem därifrån
(`$0014-$0015` står kvar: hoppet läser dem). Deltas spel (`$02a1-$ffff`, start `$1770`, som Sindri sparar ur
bandets laddare) har sin ljudrutin på `$0403-$059a`: 13 byte av den blev `READY.` och `SYS6000`, spelet körde in i dem
vid första ljudet efter fire och slutade i en BRK på `$0118`. Nu kommer det in i spelet och väntar i sin huvudslinga
på `$17cc` som när Sindri kör bandet; i x64sc kör samma program startat från monitorn spelet efter fire, och med de 13
byten skrivna dit kraschar det. Mätt gammalt mot nytt på 655 filer ur arkivet (115 spel-D64:or ur CSDB Top200, 145
band ur Preservers och 116 ur C64Tapes-org, 161 demos ur Onefile-top200, 118 OneLoad64-spel): de 501 program Sindri
sparade som startar på en adress kördes var för sig från sin start. Från `$0800` och uppåt är alla 186 likadana. Under
`$0800` (315) lades byte tillbaka i 239, och 297 slutar som förut. Av de 18 andra körde 6 förut in i `READY.`:s eller
`SYS`-radens byte och stannade på en JAM, och kör nu (Bubble Bobble, MASK, Joe Blade 2, Gore n Goners, Transcend the
Game, Asterix and the Magic Cauldron); 3 som förut packades upp hoppade genom KERNAL:s IRQ-vektor till `$0000`, en
krasch: Great Gurianos (två kopior) når nu spelet, Way of the Exploding Fist stannar i stället på en JAM på `$902c`
efter RETURN som Sindri trycker; i 4 har nästa lagers sparade program inte längre `READY.` och `SYS`-raden i sig
(Driller, Out Run två gånger, Octapolis); 5 går vidare annorlunda i sin egen kod (Bionic Commandos stod förut still på
`$0370` och spelar nu vidare). Inte packade 322 → 330, uppackade 74 → 71, misslyckade 105 → 100.
Ett `$01` som också slår bort KERNAL (`$35`: The Last Ninja 3:s spel på `$0400` med RAM överallt) satt förut på
`$e144` innan SYS:s `JMP ($0014)` kördes, så processorn körde RAM:et där; nu gör Sindri hoppet själv. Av 122 körningar
från en sparad start med ett sådant `$01` i 1 112 utgåvor ur arkivet startade 55 aldrig och 22 stannade på en JAM; nu
kör 92.
Får BASIC text efter `RUN` från skärmraden det skrivs på skriver Sindri `RUN:`, som VICE:s autostart gör med
`-autostartwithcolon`: RETURN ger BASIC hela den logiska raden, och en fil som laddas in i skärmen kan ha sin text där.
Channel 42 Intro (FBI Crew) laddas på `$0450` med sin text över rad 2-24 och har `6000 SYS2061` på `$0801`; `RUN`
följt av texten är `RUN` till ett radnummer, `?UNDEF'D STATEMENT ERROR`, också i VICE när man skriver `RUN` och med
autostartens förval, och förut skrev Sindri då `SYS1104` och stannade på en BRK på `$cad3`. Med `RUN:` går den genom
CruelCrunch till samma program som unp64 sparar (`$0801-$27e3`, start `$080b`, varenda byte) och vidare genom ECA
Compactor till introt på `$0900`. Vad BASIC får är det skärmeditorn läser (`$e63a`: ett inverterat tecken som det vanliga
utanför citattecken) minus det tokeniseraren stryker (`$a582`: `$80-$fe` utanför citattecken), så efter en rad med
grafik och inverterade mellanslag skrivs `RUN` som förut. `SYS` får inget kolon: talet slutar vid första bokstaven och
programmet startar, och kolonet vore en byte till av filen som skrivs över (Coop Demo av Digitech har sin laddares
tabell på den raden; en sjunde byte borta och laddaren stannar på en BRK). Mätt på arkivets intros och demos (första
programmet på varje D64 och T64 och lösa PRG:er, 57 095 olika): av de 1527 som laddas över skärmen packas 1154 upp,
förut 1061; ingen slutar packas upp, 1433 körs precis som förut, och 200 andra program ur arkivet likaså. Av de 94 som
sparar ett annat program är 84 byte för byte vad unp64 sparar (81 det lager unp64 återvänder till, 2 ett annat lager,
1 där båda har byte), 4 skiljer bara där unp64 skriver om BASIC-raden (`SYS`-talet eller länken), 2 är identiska fast
unp64 inte anger någon återhoppsadress, 2 känner unp64 inte igen, och i 2 slutar Sindris lager vid ECA-uppackaren eller
skiljer 87 byte (We Hate Cats, Rawhead; Intro 1988, Depredators). Picture Demo (The Discmonsters, `0 SYS2061`) är den
enda där `RUN` med texten efter också startade (`RUN` till rad 0): den sparas med ett kolon i stället för ett E.
Raden skrivs i tangentbuffern, och sedan hålls RETURN nere i tangentbordsmatrisen tills KERNAL:s avbrott läser av
tangentbordet och hittar den, som när någon skriver `RUN`: programmet startar där i timer A:s period som på en C64.
En packare kan tävla med det avbrottet. Subway Arts Exomizer-stubb på `$01be-$01ec` i stacksidan gör `CLI` med
avbrottet väntande och anropar CLR; tar timern slut igen medan CLR ligger djupt i stacken skriver avbrottets push
`$ea33` över stubbens `JMP $A7AE`, och demot slutar i en BRK (med 236-410 cykler kvar av timer A vid `CLI`). Förut
lade Sindri RETURN i bufferten med raden där prompten råkade vänta efter laddningen, och 355 var kvar; hittad av
avläsningen lämnar RETURN 14 730-15 526, vilken rasterrad programmet än startar på (168 provade). Sindris tidtagning
var inte felet: startad från VICE:s tillstånd på `$080d` (timer A, rasterrad och cykel) är Sindri vid `CLI` cykel för
cykel som VICE. Kommer ingen avläsning (inget KERNAL-avbrott) läggs RETURN i bufferten efter två bildrutor.
En VICE-snapshot laddas och startas inte: Sindri fortsätter från dess maskin (se *Snapshots* nedan). `RUN` skulle starta
programmet från början, för från `$0200` har snapshoten programmets `SYS`-rad på `$0801`.

**Snapshots.** En snapshot tagen i ett crackat spels intro eller trainermeny har ofta spelet kvar packat i minnet,
bakom menyn. Sindri fortsätter därför från snapshotens maskin där den togs (`UnpackOptions.resume`, `vsfMachine()` i
Sindris `src/vsf.ts`): RAM (allt räknas som laddat, också en uppackare i nollsidan och den packade datan), färg-RAM,
CPU:ns register och port, VIC-II:ns register, rasterrad och rastercykel, jämförelserad och avbrottsflaggor, och båda
CIA-kretsarna med portar, timrar, latchar, kontrollregister, avbrottsmask och flaggor (modulerna `C64MEM`, `MAINCPU`,
`VIC-II` 1.3 och `CIA1`/`CIA2` 2.x som x64sc skriver dem; färg-RAM 761 byte in i VIC-II-modulen). Sedan kör den som
vanligt: lager, och tangenter när programmet väntar innan något packats upp. Det kräver ROM:arna. Packningsnotisen
gäller en snapshot bara när en decruncher eller decoder läste packad data (`packedData()`: det de läste i följder om
minst 256 byte), inte när programmet bara flyttade kod, och den säger var datan låg: "Going on from the snapshot (the
CPU at $07f8), Sindri peels off 2 layers: …; the packed data was at $090e-$390c; the program starts at $0810". Filens
egna tecken (entropi, lite kod) räknas inte för en snapshot. *Unpack* ger programmet med sin start, som för en PRG; en
snapshot packas inte upp av sig själv när den öppnas. Lagerrapporten har raden `Snapshot: going on from where it was
taken, the CPU at $xxxx`, och `mimir unpack` och Sindris kommandorad tar en `.vsf` (känd på huvudet).

Mätt på 270 snapshots som x64sc 3.10 tog av 60 spel och 30 demos ur CSDB:s topp-200 (första disken, autostart, efter
ungefär 3, 8 och 20 sekunder i warp): 60 togs medan något laddades från disken, där fortsätter Sindri inte (1541:an tas
inte ur snapshoten, och KERNAL står och väntar på den). Av de 125 spelsnapshots som togs i ett körande program får 73
notisen (39 av 60 spel), med packarens namn i 44 (Exomizer, ByteBoozer), median 47 KB packad data. Filens egna tecken
hade sagt *packad* i 9 av dem, *kanske* i 32 och ingenting i 32. För 14 spel jämfördes programmet med det som *Unpack*
två gånger ger ur originalfilen: lika (95-100 % av byten, skillnaderna är variabler och skärm) i 10. Av 85
demosnapshots får 2 notisen: trackmos laddar nästa del från disken medan en del kör, och utan 1541:ans tillstånd går
laddaren fel (23 av 85 kör in i en JAM). En körning tar median 0,3 s, högst 1,9 s. Testerna: Sindris `test/vsf.test.ts`
skriver en snapshot av en egen maskin och läser tillbaka den; `fixtures/vsf/packed-menu.vsf` är
`fixtures/prg/packed-menu.prg` i x64sc, stoppad i tangentväntan på `$07f8` (`make-packed-menu.mon`), och ger demon
tillbaka i core-testet och i e2e.

**Vad Sindri sparar.** Det sparade programmet är minnet som det var när det nyaste lagret startade, från den första
till den sista byte som hör till programmet (små delar långt från resten räknas inte): det som lagret före skrev och
inte körde självt, och orörda delar av den laddade filen, men inte packad data som uppackarna förbrukade, deras egen
kod eller vad C64:an skrev själv. I en trackmo laddar ett tidigare lager det som programmet sedan använder: musiken
som spelar i avbrottet, laddaren som ligger kvar på `$0200`. Därför hör också delar av ett tidigare lagers program
(eller av den laddade filen) dit, när programmet körde minst 16 byte kod där som det inte skrivit självt; av en sådan
del räknas de byte som fortfarande håller det de höll när det lagret startade, utom de som körts eller lästs sedan dess
av någon annan än programmet (delens egen startkod, data som en uppackare kopierade därifrån). Det avgörs när lagret
slutar, och lagerrapporten säger det på programmets rad: `keeps what earlier layers left that it ran: $0200-$03d5
(layer 3), $0e40-$1c7a (layer 4)` (`LayerReport.kept`). Startfilen med disken i stationen, som när man monterar disken,
laddar första filen och trycker *Unpack*:

| Demo | Sparat förut | Sparat nu | Musik som Mimir hittar |
|---|---|---|---|
| Fairlight 1337 (disk A) | `$7400-$ffff` | `$0200-$ffff` | `$1000-$1c7a`, spelar |
| Viva Las Vegas (sida 1) | `$2000-$9473` | `$0b01-$9473` | `$0c00-$1b09`, spelar |
| O-tech People III | `$e000-$f6e3` | `$0200-$f6e3` | `$1000-$1c07`, spelar |
| Codeboys & Endians (sida 1) | `$0200-$0bff` | `$0200-$bfff` | musiken vid `$1000` finns nu i programmet |
| No Bounds (sida 1) | `$0255-$fffb` | `$0200-$fffb` | `$0900-$1fff`, spelar: se nedan |

The Lab, Eyes, Multiverse, I'm Back och Ranx sparas som förut (musiken låg redan i det sparade).

**Vektorerna på `$FFFA-$FFFF`.** Startar programmet med KERNAL:n bortkopplad (`$01`:s HIRAM låg, som `$35` eller
`$3C`) tar CPU:n NMI, RESET och IRQ ur RAM:et där, så de sex byten hör till programmet när det har dem, hur långt
från resten de än ligger (`saveRange` behåller den delen som delen med starten). Elites avkodare sätter IRQ `$A8FA` och
NMI `$AB33` innan den hoppar till spelet på `$886F` med `$01 = $3C`; utan dem slutade sparandet på `$F8FF`, och
första avbrottet gick in i det RAM:et höll där. Med KERNAL:n inkopplad tar CPU:n vektorerna ur ROM:en, och de räknas som
förut. Mätt 2026-11-22 på 696 program (297 slumpvisa skivor ur `Games` och `Demos`, 400 enfilsdemor och intron): 24
sparas med KERNAL:n bortkopplad, 4 sparas annorlunda, och i alla fyra pekar vektorerna på en riktig avbrottsrutin i det
sparade (Christmas Megademos The Santas, två skivor, IRQ `$02E5`; Kannanotto, `$01 = $15`, IRQ `$9C00`; Double Image,
RTI på `$1702`). Sindris `test/unpack.test.ts` prövar båda fallen.

**I/O-läget vid starten** (`Saved.io`, `packages/sindri/src/io.ts`). En PRG har minnet, inte det VIC-II, CIA:orna,
SID och färg-RAM:et ställts in på innan programmet startade. Elites laddare stänger av CIA:ornas avbrott och väljer
VIC-bank 1, och spelets init, som avkodaren anropar, sätter bitmappsläge och rasteravbrottet innan spelet startar på
`$886F`. Startat från READY med bara minnet tittade VIC i bank 0, KERNAL:ns timeravbrott gick in i spelets
rasterrutin, och skärmen blev skräp. Sindri jämför därför I/O-läget när det sparade lagret startade med läget vid READY
(maskinen Sindri startar från) och sparar skillnaden som steg från READY: CIA-avbrott som ska bort stängs av först
(`$7F` till ICR), sedan skrivs registren (VIC:s `$D000-$D02E` utom avbrottsflaggor och kollisioner, `$D011`:s
nionde bit och `$D012` som rasterjämförelsen, CIA:ornas tidslatchar och kontrollregister med force load, CIA 2:s
portar och båda CIA:ornas riktningsregister, SID:s filter och volym `$D415-$D418`), sedan kvitteras det som väntar
(läsning av ICR, `$0F` till `$D019`) och sist slås programmets avbrott på (CIA 2:s är NMI, som SEI inte håller
undan). Med det följer om avbrotten var på (I-flaggan) och färg-RAM:et när det inte är som vid READY (1000 hexsiffror).
Inte med: TOD-klockorna, timrarnas räknare, CIA 1:s portbitar (tangentbordets kolumn sätter programmet självt) och SID:s
röster. Ett BASIC-program som startas med RUN får inget. Elites spel: 43 steg och färg-RAM:et; utan färg-RAM:et blev
ramens översta rad, som visas i instrumentpanelens läge, ljusblå (READY:s färg). Lagerrapporten säger det
(*…, and the I/O it started in (43 steps: VIC bank 1, 34 VIC registers, the raster interrupt on, CIA 1's interrupts off,
CIA 1's timer B, the SID's volume 15)*, `ioSummary`). *Unpack* behåller det med starten (`Project.entryIo`, i
projektfilen) som `$01`, Sindris nästa körning från starten sätter det före hoppet (`UnpackOptions.io`), och en egen
start glömmer det. Mätt 2026-11-22 på 696 program (297 slumpvisa skivor, 400 enfilsdemor och intron): av 562 sparade program (inte BASIC) startar 267 i ett eget I/O-läge, median ett steg (oftast ramfärgen som packarens blinkande lämnade), högst 48; 132 med eget färg-RAM, 32 i en annan VIC-bank, 14 med rasteravbrottet på och 14 med CIA 1:s avbrott av. Körda igen från starten i Sindri hamnar 227 där program hamnar både med och utan I/O-läget och 39 i inget av fallen. Ett slutar annorlunda: Happy Fathers Day tar, med skärmen av som packaren lämnade den, emot mellanslaget Sindri trycker och nollställer C64:an, som demon gör på mellanslag.

I No Bounds laddar programmets eget lager (ramverket vid `$ff40`) delarna och musiken efter att det startat och anropar
dem med `JSR`; de återvänder till ramverket och blir inga egna lager, och musiken spelar i delarnas avbrott. Minnet när
lagret startade har inget av det, och det sparade programmet kan inte göra det igen, för det kommer från disken. Därför
hör också det dit som lagret laddade efter att det startat och sedan körde, när stationen pratade på seriebussen medan
lagret körde: stationen ändrade sin DATA- eller CLK-ledning minst 256 gånger (en sektor är tusentals; slutet på en
laddning som började före lagret några få). Det är sträckor av byte som lagret skrev efter att det startat, utanför
programmet det startade med och utanför delarna det behöll från tidigare lager (hela deras omfång: det en sådan del
skriver i sig själv är dess variabler), med luckor på högst 256 byte, där lagret körde minst 16 byte kod efter att det
skrev dem. De sparas som minnet höll dem när lagret slutade, för det nyaste lagret när körningen stannade; programmets
egna byte och de behållna delarnas behåller värdena från lagrets start. Lagerrapporten säger det på programmets rad:
`keeps what it loaded after it started and ran, as it was at the end: $02ff-$2aff $3fff-$a446` (`LayerReport.loaded`).
Utan disk ändras inget: det ett program skriver senare gör det av det som det sparade redan håller.

I No Bounds skilde 2180 av 2304 byte på `$0900-$11ff`, där SID-skrivningarna kommer ifrån, mellan det sparade och
minnet när körningen stannade. Nu hittar Mimir musiken på `$0900-$1fff` (init `$0900`, play `$0903`; körd ger den 25
register och 1604 toner, också när blocket körs ensamt). De åtta trackmos ovan sparas som förut och har samma musik,
både när C64:an startar från början och från den start som Sindri sparar efter första körningen. Sparat är nu två
ögonblick: en laddares pekare kan leda in i det som låg där när lagret startade, och en del som laddas över programmet
lagret startade med sparas inte (de byten behåller sina startvärden).

På 138 demodisketter ur CSDB:s topp-200 och topp-500 (startfilen med disken) sparas 18 annorlunda: 4 slutar högre, 6
börjar lägre, 8 har samma omfång med andra byte, inget blir mindre och inget lager, stopp eller tid ändras. Mimir
hittar musik i 7 som inte hade någon: No Bounds, CatYa Dancing Queen, Uncle PETSCIIs Christmas Show och RGB spelar när
de körs, Good King Wenceslas spelar inte när den körs, Datastorm Leftovers ger bara 2 toner, och Black Celebrations
block spelar inte heller och varnar att det kör in i en JAM ensamt. I 10 är musiken densamma. I Xcusemo slutar
musikblocket på `$0f07` i stället för `$16c8` (samma init, play och toner, men spelaren läser till `$16c8`): laddaren
som programmet lagt på `$0200` följer nu med, och analysen följer dess `JMP $1003` in i melodins data. Samma block får
gamla Sindri när C64:an startar från början, för då sparas laddaren också. På 741 intron och demos utan disk ändras
inget.

På 103 demodisketter ur CSDB:s topp-200 och topp-500 (startfilen med disken) sparas 42 annorlunda, alla demos i
flera delar vars program kör sin kvarliggande laddare eller musiken från ett tidigare lager: 36 börjar lägre (oftast
laddaren på `$0200`), 11 slutar högre (en laddare högst upp i minnet, kod som en tidigare del packade upp), inget blir
mindre. På 617 intron och demos utan disk ändras 2: ett intro blir byte för byte lika med unp64 (`$0801-$3fff`, förut
slut vid `$22fe`), och i ett där Sindri går ett lager djupare än unp64 följer programmets kod på `$8000-$eaff` med.
Inget lager, stopp eller tid ändras.

**unp64 som externt verktyg.** När uppackaren i inställningarna är unp64 frågar appen den i stället (`unp64 fil -i`, som
inte packar upp något) vilken packare varje öppnad fil har. unp64 känner hundratals packare vid namn. En fil den känner igen visas som packad med det
namnet, även om tecknen ovan inte räckte. Känner den ingen packare och tecknen bara räcker till *kanske*, visas ingen
notis. Prov mot unp64 på 100 PRG:er ur arkivet:
- Av de 90 som unp64 känner igen fann igenkänningen 88.
- Av de 10 den inte känner räknades 9 som opackade.
- Av de uppackade resultaten räknades 65 som opackade. 20 hade ett packlager till som unp64 också känner igen, så de är
  rätt. Bara 9 var tveksamma: 5 *kanske* som unp64 inte känner (visas inte) och 4 *packad* (visas med "unp64 does not
  know the packer").

Med unp64 kan Unpack alltså behöva köras igen på resultatet, eller med unp64:s `-c` som packar upp alla lager. Sindri
går igenom alla lager på en gång.

Appen visar det på tre ställen: en notis över listningen med skälen och var uppackaren börjar, märket *packed* eller
*packed?* på filen i Explorer, och en rad i Problems. CLI:ns `analyse` skriver en `[pack]`-rad (och `packing` med `--json`),
och `mimir unpack fil.prg [-o ut.prg] [--no-roms]` packar upp med Sindri och skriver lagerrapporten
(`mimir unpack demo.d64 [--file NAMN]` tar diskens första PRG med disken i stationen, `--disk` sätter i en disk).

**unp64 följer inte med.** Tidigare installationer innehöll unp64 2.40 av iAN CooG, vars licens bara tillåter
icke-kommersiell spridning, och pekade uppackaren på den (`bundledUnpacker` i `settings.json`). Nu är Sindri
standard och unp64 ingår inte. Står inställningen fortfarande på den medföljande kopian töms den en gång
(`electron/main/settings.ts`), så att Sindri tar över; en uppackare användaren valt själv behålls. Ett e2e-test mot
den installerade appen kontrollerar att `resources\unp64` saknas, att inställningen är tom och att *Unpack* packar upp.

**Uppackning.** Knappen **Unpack** i notisen (eller i kommandopaletten) tar programmet som Sindri sparade
när filen öppnades: lagret där programmet startar, med dess start som programstart (ett BASIC-program som startas med
`RUN` får ingen, analysen hittar dess SYS-rad). Lagerrapporten (`unpackLog()`, som Sindris egen kommandorad skriver
den) visas under *Layer report*. Med ett externt verktyg (13.1: *Extern uppackare*, vanligen unp64) skriver knappen
**Unpack with unp64** i stället en kopia av PRG:n i en ny byggmapp och kör verktyget där med argumentlista, aldrig via
ett skal. Med `{out}` i argumenten används den filen; annars den största nya fil som verktyget skrev. Startadressen läses
ur filnamnet (unp64 skriver `namn.prg.xxxx` där xxxx är JMP-adressen, efter flera pass den sista), annars ur unp64:s
`return to mem: $xxxx`, annars `jmp`/`start`/`sys $xxxx` i utdata. unp64:s `Entry point:` är den packade filens start och
används inte. Packarens namn tas ur raden `<packare>, unpacker=$xxxx`. Ett projekt med en fil
ersätts av den uppackade filen med startadressen som programstart (8.2); i ett projekt med flera filer byts bara filen ut,
och det går att ångra. Den uppackade filen heter `namn-unpacked.prg`; packas den upp igen räknas uppackningarna i namnet
(`namn-unpacked_2.prg`, `namn-unpacked_3.prg` …) i stället för att `-unpacked` upprepas (`unpackedName()`, som också
namnger `mimir unpack`s fil; ett gammalt `-unpacked-unpacked` räknas som två). Verktygets kommandorad och utdata visas i en rad över listningen. Den uppackade filen räknas som
en laddning (14.1): *Files* fälls ihop, och *Loaders* och *Program start* öppnas när programmet som packaren gömde har
en loader eller en känd start.

Sindri kör sedan den uppackade filen från programstarten som *Unpack* satte. Ett program som väntar på en tangent
framför mer packning, som trainermenyn i ett crackat spel framför det packade spelet, är där den första körningen
stannar (inga tangenter när något redan packats upp), men från sin start trycker Sindri sig förbi det, och nästa
*Unpack* tar nästa lager. Cybernoid II +17HDF blir spelet efter tre: trainermenyn på `$2000` (`$03dc-$f700`), ett lager till på
`$080d` (`$0200-$e000`) och spelet på `$1400` (`$0208-$ffff`). Förut kördes den uppackade filen från laddadressen
`$03dc` och Sindri hittade inget där. E2e-testet packar upp `fixtures/prg/packed-menu.prg` (demon packad två gånger
med en tangentväntan på `$07f8` mellan, `test/sindri.test.ts`) i två steg.

**Trainermenyer som frågar en sak i taget.** Sindri trycker tangenterna i tur och ordning (mellanslag och fire först,
sedan RETURN, N, F1, Y, F7, 1) tills programmet reagerar på en; då går listan om igen, från mellanslag när ett nytt
program startat, annars från tangenten det tog. En meny som frågar *Unlimited lives (Y/N)* och sedan nästa sak
reagerar på N med lite: den skriver nästa fråga. Det räknas som en reaktion när programmet skrev mer än det gör av sig
självt (nya byte i följd: åtta fler än dubbelt så många som under väntan före trycket) och skärmen visar en rad som
inte syntes vid något tidigare tryck och som står still: inte samma klagomål på fel tangent igen, samma *insert side 3*
på nästa rad eller en rulltext. Högst 24 tryck, och ett till för varje besvarad fråga (högst 32). Cybernoid 2 från
C64com (crackad av Ikari, trainer av Powerplant, nio J/N-frågor och två sifferfrågor) stannade förut i menyn efter att
varje tangent tryckts en gång. Nu får den N på J/N-frågorna och 1 på sifferfrågorna, och tredje *Unpack* ger spelet:
`$1800` (`$0800-$d8e6`), trainermenyn på `$c000` (`$03a6-$f500`) och spelet på `$a2ab` (`$0400-$ffff`, `$01=$36`),
som startar i VICE. Mätt mot förra versionen på 1013 program (613 spel från C64com, 187 från CSDB:s Games Top200,
213 intron från CSDB), var och ett uppackat upp till tre gånger som med *Unpack* (2227 körningar): 14 körningar
packar nu upp där inget packades upp förut, alla spel bakom trainermenyer (Cybernoid 2, Rainbow Islands, Operation
Wolf, Night Breed, Count Duckula, Ball Fever, Genloc …); fyra av sex som provades startar i VICE till titelbilden
(Rainbow Islands och Night Breed gör det inte ur den sparade filen). En slutar packa upp, Maze of the Mummy V2.0, vars
"program" förut startade på `$0001` (en krasch). Åtta sparar andra byte i samma intervall med samma start, de flesta
för att menyn nu får N där den fick Y, så att trainerns ändringar inte står i spelet. C64-tiden är 2,6 % längre.
Testerna `test/unpack.test.ts` i Sindri: en meny med tolv J/N-frågor och en sifferfråga, och en meny som bara klagar
på fel tangent (Sindri går vidare till nästa tangent i stället för att trycka samma igen).

**Program som väntar på tiden.** Ett program som inte skriver något nytt på 1,5 s vilar, men ett som väntar på tiden
får en halv minut från sitt senaste framsteg: dess kod utanför avbrottsrutinerna läser klockan (KERNAL:ns jiffy-klocka
`$a0-$a2`, en CIA:s time of day), eller så går BASIC runt i en FOR-slinga (dess NEXT på `$ad1e`), och ingen av den
koden läser tangentbordet, en joystick, paddlarna eller tangentbuffern (`C64.mainReads`; avbrotten följs med
`Session.call`, `READ_KIND` i `c64.ts`). Boulder Dash-bandet visar sin bild tills jiffy-klockans mittbyte är 3
(`lda $a1 / cmp #$03 / bne`, 12,8 s), och Kennedy Approach räknar `FOR I=0 TO 7000` (7 s) innan de laddar vidare;
båda vilade där förut. En meny som räknar en kort FOR-slinga mellan sina GET läser tangentbordet och vilar som förut.
En väntan som fått sin halva minut utan framsteg vilar, och nästa får tiden först när programmet gjort framsteg igen
(ett tangenttryck räknas inte). Ett program som läser inmatningen i sin avbrottsrutin och tittar på vad den lämnat i en
FOR-slinga får också halva minuten: Pirates meny (`FOR I=0 TO 20:IF PEEK(VB+14) THEN I=999`) vilar där den gjorde,
30 s senare. En huvudslinga som väntar på en byte som avbrottsrutinen räknar upp (en bildräknare) räknas inte som en
väntan på tiden: på 491 program ur arkivet väntade den regeln 429 gånger, de flesta i demor som väntar på nästa
bildruta mellan sina effekter, gjorde C64-tiden 2,5 gånger så lång och körde fem demor till tidsgränsen, fast sju
program kom längre (Dominion och Super Slalom till sina spel). Mätt 2026-11-17 mot versionen före på 703 program ur
arkivet (Games Top200:s 229 diskar, Onefile-top200:s 161 demor, 213 intron, 100 Year-top20-diskar): 6 körningar väntade
på tiden och ett resultat ändrades, ett BASIC-intro (Fuck 'Em All) vars uppstart räknar FOR-slingor och som nu når sin
GET-slinga, och det sparade programmet har koden vid `$c000-$c730` som det anropar; C64-tiden växte med 1,5 %. Banden:
se 13.5f. Testerna `test/unpack.test.ts` i Sindri: väntan på jiffy-klockan (inga tangenter), en bildräknare (tangenter
som förut), klockan och tangentbordet (tangenter), en väntan som aldrig tar slut (vilar efter 30 s), BASIC:s FOR-slinga
före nästa del och en FOR-slinga mellan GET (vilar som förut).
Ett program som räknar ner i några byte i RAM väntar också på tiden: dess kod utanför avbrottsrutinerna skrev 1 till 8
byte RAM i fönstret (stacken oräknad, `C64.mainWritten`), läste inget I/O-register (`READ_IO`), ingen byte som en
avbrottsrutin skrev senast (`READ_IRQ`, `C64.readKind`) och körde ingen BRK (`RAN_BRK`), i det sista fönstret eller
det före (räkningen kan ha tagit slut i det sista, och programmets arbete efter den har inte hunnit bli ett framsteg).
Thrusts Firebird-jingel väntar mellan tonerna i tre nästlade `dec abs / bne` på `$6118` (3 byte, 12 s i allt) innan
laddaren läser vidare; förut vilade Sindri där efter 1,5 s, nu laddas båda Thrust-banden hela och når spelet. En
huvudslinga som räknar medan den väntar på rastern eller på sin avbrottsrutin läser ett I/O-register eller det rutinen
skrev, och en krasch som går runt en BRK genom en vektor i RAM (I.C.U.P.S: `$ffff ISC $252f,X` / `$0002 BRK`) skriver
en byte varje varv men kör en BRK: de vilar som förut. Mätt 2026-11-17 mot versionen före på samma 703 program: 15
väntade på en nedräkning, 72,7 s C64-tid till (1,1 %), och ett resultat ändrades: RaytraceNightmare (No Bounds, 2023)
räknar vidare och det sparade lagret når `$ffff` i stället för `$c7df`. Sindris hastighet per instruktion är densamma.
Av de 57 banden med Firebirds laddare laddas nu 51 hela (48 förut; Thrust ×2 och Preservers Seabase Delta, se *Timing*
ovan), inget förlorat. Testerna: en nedräkning före uppackningen (inga tangenter), en räknande slinga som väntar på en
bildräknare (tangenter), en räkning som aldrig tar slut (vilar efter 30 s) och en krasch runt en BRK (vilar direkt).

**`$01` vid programstarten.** Sindri säger vilket `$01` det uppackade programmet startar med (`saved.port`, i
lagerrapporten `start with SYS 41643 = $a2ab, $01=$36`). *Unpack* sparar det med programstarten när det inte är `$37`
(`Project.entryPort`; bara när den uppackade filen blir projektets enda), och *Unpacked …* säger *starting at $a2ab
with $01 = $36*. Då startar Build & Run programmet med det (13.2), Sindris nästa körning från programstarten likaså
(Sindris `port`: värdet skrivs i `$01` precis före BASIC:s `JMP ($0014)` på `$e144`, eller med ersättnings-ROM:arna
vid deras SYS; CLI: `--port`), och analysen följer koden från starten med den minneskonfigurationen. Förut startades
Cybernoid 2:s spel med `$37`, och både VICE och Sindri körde BASIC-ROM:ets byte på `$a2ab` och hamnade i READY.
`fixtures/prg/packed-rom.prg` (`packages/core/test/sindri.test.ts`) packar upp till ett program på `$a000` som startar
med `$01 = $36`; e2e-testet packar upp det och startar det med Build & Run.

**Packa upp när filen öppnas.** Med Settings → General → *Unpack packed files when they are opened* (av från början,
sparas per användare, `autoUnpack`) packas en fil som öppnas eller läggs till upp direkt, som *Unpack* gör, när den är
packad: Sindri har kört den och skalat av ett lager (med en extern uppackare: när analysen och verktygets
identifiering säger *packed*). En fil Sindri inte kan packa upp, och en som inte är packad, står kvar som den öppnades.
Raden över listningen säger *as it was opened (Settings → General)*. I ett projekt tar Ctrl+Z tillbaka den packade
filen, som då inte packas upp igen (i arbete utan projekt går uppackningen inte att ångra, som med knappen). Den uppackade
filen packas inte upp en gång till. Flera filer packas upp en i taget.

Testerna packar demon med `fakePack()` (`test/helpers/fake-packer.ts`). Det är en liten men riktig packare: en
uppackare i 6502-kod kopierar sin loop till `$0340` och avkodar programmet (xor en 16-bitars LFSR-nyckelström, ungefär
8 bitar per byte) på plats, och demon kör i VICE efteråt. Sindri ger tillbaka demon byte för byte i
`test/sindri.test.ts`, med ersättarna och med VICE:s ROM:ar när VICE finns, och känner igen en Exomizer-fil (när Exomizer
finns) på fingeravtrycket. Den riktiga unp64 packar upp den i `test/unpack.test.ts` när unp64 finns, och testet hoppas
över annars. E2e-testet packar upp med Sindri och sedan med en ersättare för unp64
(`test/helpers/fake-unp64.cjs`) som skriver sitt resultat och sin utdata som unp64, så att det inte beror på vad som är
installerat.

### 8.11c Loaders

`findLoaders()` (`packages/core/src/analyze/loaders.ts`) körs sist i analysen (`AnalysisResult.loaders`). Den letar upp
snabb-, IRQ- och bandladdare och KERNAL:s LOAD. Varje fynd (`LoaderFinding`) har ett namn och säger hur loadern
fungerar. Dess delar (`LoaderPart`) har adress, roll och beskrivning:

- **resident:** loadern på C64:an, med mottagarloopen;
- **drivecode:** koden som skickas till 1541:an och körs där;
- **command:** drivkommandona `M-W`, `M-E` och `M-R`;
- **install:** koden som skickar drivkoden och kommandona;
- **tape**, **kernal**, **text** (loaderns namn).

**Kända loaders**, igenkända på sin egen kod. Byte-mönstren kommer från deras källkod eller utgåvor. Bara byte som inte
beror på var koden ligger finns med, och `..` står för valfri byte:

| Loader | Känns igen på |
|---|---|
| Spindle 3 (lft) | den fasta sidan som börjar `lda #$18 / nop #1 / cmp #$38` (`A9 18 80 01 C9 38`); mottagarloopen `eor $dd00 / sax $dd00` (`4D 00 DD 8F 00 DD`). Delen är hela sidan (standard `$0200`, `jsr` dit laddar nästa del) |
| Spindle 2 (lft) | `ldx $dd00 / sty $dd00 / eor tabell,x` (`AE 00 DD 8C 00 DD 5D`), de två fasta sidorna `$0c00–$0dff` (läst ur spin.exe i 2.3) |
| Krill's loader (Krill/Plush) | `ora $dcc9,x / stx $dd02 / ror / ror / ldx #$3f / sax` och `adc $dd00 / stx $dd02 / iny / beq` (v194, hal-c64-c128.inc); installationen skickar `"M-E" $020b "KRILL."`; version 146 på installerarens versionstext `"Krill's Loader, version "` i PETSCII med stora och små bokstäver (GoatLight, 13.5l) |
| Bitfire (Bitbreaker/Oxyron) | `adc $dd00 / stx $dd02 / lsr / lsr / dey / cpy #$01`, `ora $dd00 / stx $dd02 / ror / ror / ldx #$3f / sax` (resident.asm), och den äldre `ldy #$37 / lda $dcc9,y / sty $dd02` |
| Sparkle (Sparta/OMG) | `lda $dd00 / sty $dd00 / lsr / lsr / dex / nop / ldy #$c0 / ora $dd00 / sty $dd00` och `and $dd00 / sta $dd00 / ora #0 / sta buffer,x / bvc` (sl.asm), i en senare version `inx` och `ora #1`, i Memento Mori `inx` och `ldy #$00`; blockuppackaren på `$0200` (`lda $0300,x / beq / cmp #$f8 / bcs / lsr / alr #$fe / tay / eor #$ff / adc`, och i All Hallows Eve och senare `lda $0300,x / bpl / sty / alr #$7c / lsr / cmp #2`), som en del sparad från `$0200` har utan mottagarloopen; texten "sparkle". En Sparkle-disks bundlar läses som 13.5i säger |
| BoozeLoader (HCL/Booze Design) | mottagarloopen `dey / ldx #8 / lda $dd00 / stx $dd00 / lsr / lsr / iny / nop / ldx #0 / eor $dd00 / stx $dd00 / lsr / lsr`, där ATN skrivs till `$dd00` som klocka, och dess fjärde läsning `lda #$c0 / and $dd00 / sta $dd00 / ora #0 / sta buffer,y`; hur den skickar en bit av filnumret (`ldy #0 / bcc / ldy #$10 / lda #8 / sta $dd00 / bit $dd00 / bpl / sty $dd00 / rts`); ByteBoozer 1:s och 2:s offsettabeller, som bara räknas med loaderns egen kod; drivkommandot `"M-E" $020b` med sina egna byte, som låter DOS:en läsa drivkoden från 18/18, 18/15 och 18/12. Mönstren kommer ur Booze Designs demos 2008–2025 (källkoden är inte offentlig). Drivkoden finns aldrig i C64:ans minne, och skriptet i koden läses som 13.5d säger |
| Pirate Slayer (Electronic Arts) | drivkodens nyckelkontroll `bvc * / clv / lda $1c01 / cmp #$d7 / bne / bvc * / clv / lda $1c01 / cmp #$d7 / beq / cmp #$eb / bne` (`50 FE B8 AD 01 1C C9 D7 D0 .. 50 FE B8 AD 01 1C C9 D7 F0 .. C9 EB D0`) och nyckelns 12 sista byte `55 AE 9B 55 AD 55 CB AE 6B AB AD AF`; drivens sändrutin `lda #1 / sta $1800 / bit $1800 / bne / stx $1800 / txa / asl / and #$0f / sta $1800`; C64:ans mottagarloop `sec / ldx $02 / lda $d012 / sbc #$32 / bcc / and #$07 / beq / stx $dd00` och stack-bootens handskakning `lda $dd00 / and #$07 / ora #$08 / sta $dd00 / lda $dd00 / bmi / dey / beq / bit $dd00 / bvs …`; texten `PIRATESLAYER`. Mönstren kommer ur drivkoden och laddarna som bootarna på fyra EA-skivor laddade upp och körde (Sindri med deras G64:or, 13.5h). Super Snapshot-kopierarens tecken `lda $1c00 / ora #$0c / sta $1c00 / lda #$ee / sta $1c0c` (motor och lampa på) räknas nu bara med kopierarens egen kod: Pirate Slayers drivkod börjar likadant |
| Para-Protect (Paranoid) | laddarstubben `sei / lda dest,x / sta $8f / lda sidor,x / pha / lda spår,x / pha / ldy sektor,x` (`78 BD .. 02 85 8F BD .. 02 48 BD .. 02 48 BC .. 02`); C64:ans mottagning `bit $dd00 / bpl / sec / lda $d012 / sbc #$31 / bcc / and #7 / cmp #2 / bcc / lda $90` och sändning av en halvbyte i taget; drivens steg `jsr $f24b / lda tabell,x / sta $c2 / clc / lda sektor / adc #steg / cmp $c2` (eller med DOS:ens antal, `A5 0A 20 4B F2 85 C2 18 A5 0B 69 08 C5 C2`); bootets STOP-kod `lda $af / cmp #3 / bne / lda $ae / cmp #$3b / bne`; svagt namnet `D0 41 52 41 2D D0 52 4F 54 45 43 54` ("Para-Protect" i PETSCII). Mönstren kommer ur Bangkok Knights, Thundercats och Better Dead than Alien körda från sina G64:or i Sindri (13.5o) |
| Disk-Speed (Morse Technology) | C64:ans mottagning av en byte `lda #$27 / sta $dd00 / bit $dd00 / bvc / lda #$03 / sta $dd00 / ldx #$07 / dex / bpl` (`A9 27 8D 00 DD 2C 00 DD 50 FB A9 03 8D 00 DD A2 07 CA 10 FD`) och av 128 byte (`A0 80 A9 27 8D 00 DD 2C 00 DD 50 FB A9 03 8D 00 DD A2 0A CA D0 FD`); tabellens mottagning (`20 00 04 85 BE 20 00 04 85 FB 20 00 04 85 FC`); öppningen av buffert 2 (`A9 08 20 0C ED A9 F2 20 B9 ED A9 23 20 DD ED`); svagt drivkommandot `B-E 2 0 14 0`. Bootet avkodar sig självt först, så mönstren finns i det Sindri avkodar (lager 1). De kommer ur Elite och Fighter Pilot körda från sina G64:or (13.5p) |
| Covert Bitops loader (Cadaver) | badline-väntan `lda $d011 / clc / sbc $d012 / and #$07 / beq` följd av `lda #$10 / ora $dd00 / sta $dd00` (3.0–3.01) eller `lda $dd00 / ora #$10 / sta $dd00` (version 2 och 3.02–3.06), `M-W` lagrat baklänges (`"W-M"`), version 2:s `20 00 00 "W-M" 05 00 "E-M"` och dess 1-bitsloop `lda #$10 / eor $dd00 / sta $dd00 / asl / ror` (räknas bara med koden); läst ur loader.s i alla releaser 2.05–3.06 och prövat på deras testprogram (13.5l) |
| Action Replay fastload (Datel) | byten tas emot på en rad utan badline: `bit $dd00 / bvc / sec / lda $d012 / sbc $aa / bcc / and #$07 / beq` (MK4: `cmp #$31 / bcc / and #$06 / cmp #$02 / beq`); ett block till `$0200` (`… ora $dd00 / sta $0200,y`); stackkoden som kopierar blocken med cartridgen avbankad (`lda #$23 / sta $de00`, 128 byte till `$013f`); drivkoden: starten vid `$0150` (`sei / jsr $01xx / lda #$7a / sta $1802`), 1541-koden vid `$0300`, 1581-koden vid `$0500` (`sta $4001`); installationen som skickar `M-`, `-` och `W`/`E`/`R` var för sig |
| Action Replay Warp*25 (Datel) | mottagarloopen som lägger tre byte per varv på stacken (`… eor $dd00 / pha / lda $dd00 …`); avkodningen `inc $01 / pla / eor #$f9 / dey / sta ($ae),y` (MK4 `dec $01`); stackkoden (`ldx #$20 / stx $de00`); 1541-koden vid `$0400` (768 byte); `B-E 2 0 18 5/6` i loaderfilen, som bara räknas med koden (andra loaders har samma B-E) |
| Action Replay, bandbackuper (Datel) | loadern i bandets header (`$0351–$03fa`, början `lda #$0b / sta $d011 / lda #$05 / sta $01 / sta $c0`), synkbyten `"RB"`, biten genom CIA2:s timer B (`lda $dd0d / stx $dd0f / lsr / lsr / inc $d020`), första filen som skriver över vektorerna vid `$0300` och hoppar till `$0351`; sparrutinen. Turbo och superturbo har samma loader (pulslängden står på bandet) |
| Action Replay turbo tape (Datel) | LOAD/SAVE med TAPE TURBO ON. 5.1 och 7.5: biten genom CIA1:s timer B, synk `$10 … $01`, sparrutinen. 7.2: Turbo Tape 250:s format (tröskel `$0107`, ledarbyte `$02`, synk `$09 … $01`), biten genom CIA2:s timer B med volym och ram som blinkar (`sta $d418 / sta $d020`); andra turbor läser biten likadant men utan blinket, och synken ensam räcker inte |
| TapeTool (Martin Piper) | biten genom CIA1:s timer A som one-shot (`pha / lda #$10 / bit $dc0d / beq / lda $dc04 / cmp $dc04 / beq / clc / lda #$19 / sta $dc0e`, TapeLoaderCIACommon.a), IRQ-laddarens bit (`lda $dc0d / ldx #$19 / stx $dc0e / lsr / rol`, TapeLoaderCIAIRQ.a); väntan på synken `$aa` och TinyHeader `$69` räknas bara med dem (13.5g) |
| Novaload (Novagen) | biten genom toppbiten i CIA1:s timer A (`bit $dc0d / beq / lda $dc05 / stx $dc0e / eor #$80 / asl / pla / ror`); timern satt till `$81f4`, som bara räknas med biten. Action Replay 7.2:s Nova transfer läser band med samma kod |
| Novaload, IRQ-versionen (Novagen) | avbrottet som läser bandet och väntar på synkbyten `$aa` (`cmp #$aa / beq / lda #$02 / bne / lda #$37 / sta … / lda #$7f / sta zp / lda $dc0d / pla / tay / pla / rti`) och lagringen med pip på SID:en och summa (`ldy zp / sta (zp),y / sta $d401 / clc / adc zp / sta zp / iny / sty zp / bne`), båda i bootfilens bandhuvud; och avbrottet i dess LOAD (LOAD-vektorn `$0330`, Paperboys vid `$0334`): bitläsningen, summan och steget det är på, ledaren och synken (`eor #$02 / lsr / lsr / ror zp / bcs / lda zp / sta zp / adc zp / sta zp / ldy zp / lda zp / sec / bcs … / cmp #$80 / bne / lda #$08 / bne / sbc #$aa / beq`, samma kod på 126 band i arkivet). Elite, Encore, US Golds Americana, Epyx, System 3, MicroProse … (texten NOVALOAD i minnet) |
| Freeload (Ocean) | bitläsningen i avbrottet: bit 1 i CIA1:s timer A:s höga byte (`lda $dc05 / ldy #$19 / sty $dc0e / eor #$02 / lsr / lsr / rol`, delad med US Golds laddare och räknas bara med det egna), och väntan på ledaren `$40` och synken `$5a` (`cmp #$40 / beq / cmp #$5a / beq`). Ocean, Imagine, Mastertronic, Domark, CRL, Gremlin (texten FREELOAD i minnet) |
| US Golds bandladdare | Freeloads bitläsning med ledaren `$20` och synken `$ff` (`cmp #$20 / beq / cmp #$ff / beq`): 720, Masters of the Universe, Super Huey II, Turbo Out Run |
| Mega-Save | väntan på ledaren `$63` och synkbyten `$64`…`$ff` i laddaren i bandhuvudet (`cmp #$63 / bne / ldy #$64 / jsr … / cmp #$63 / beq / cpy zp / bne`), och bitläsningen i bootfilen (`lda $dc0d / and #$10 / beq / lda $dd0d / stx $dd07 / lsr / lsr / lda #$19 / sta $dd0f / rts`: en puls startar om CIA2:s timer B, svag). Palace (Cauldron), Hewson, Level 9, Alligata, Llamasoft, CRL (TAPCleans namn; Final TAP kallade den CHR, efter Cauldron, Hewson och Rainbird) |
| Cyberload | bitläsningen `lda #$10 / bit $dc0d / beq / lda $dc04 / cmp $dc04 / beq / clc / lda #$19 / sta $dc0e / php` (TapeTool har samma utan `php`, och med `pha` före), och bootfilens dekryptering av laddaren i bandhuvudet (`ldy #… / eor $0350,y / sta $0350,y / dey / bne / eor #… / sta $dc0d`). Tredje och fjärde steget läser bandet i ett avbrott: bitläsningen `lda $dc0d / lsr / lda #$11 / sta $dc0e` (svag) och sökandet efter ledarbyten `$0f` bit för bit innan det går över till hela byte genom att skriva om sina egna grenar (`cmp #$0f / bne / lda #$18 / sta … / lda #$00 / sta … / lda #$01 / sta zp`), så att Tuskers `$f800` och `$fd00` också heter Cyberload. Thalamus, Activision, Hewson, System 3, Silverbird, Virgin, Elite, Accolade, MicroProse (texten "CYBERLOAD NOW LOADING …" i skärmkoder i bootfilen). Bandformaten i 13.5e |
| Wildload (Interceptor Micros) | bitläsningen `sty $d020 / eor #$02 / lsr / lsr / ror`, minst signifikanta biten först, väntan på ledaren `$a0` (`cmp #$a0 / bne / lda #$27 / sta $0119`), och bootkoden i bandhuvudet som läser laddaren med KERNAL:ns `$f84a` och dekrypterar den till stacksidan (`lda $00ff,y / eor …,y / sta $00ff,y / dey / bne`). Activision, Thalamus Hits, Electric Dreams, Domark, Image Works, Incentive, Mirrorsoft (texten "WILD SAVE (C) INTERCEPTOR MICROS 1987 WRITTEN BY ANDREW CHALLIS JANUARY 1987" i bandbufferten, som varje kedjas första block fyller). Formatet heter Wildload i TAPClean och läses i 13.5e; Interceptors egna spel har ett annat, Microload |
| Microload | avbrottet i bandhuvudet (`$0351`): bitläsningen `lda #$91 / sta $dd0e / lda $dd0d / lsr / lda $dc0d / ror zp` (CIA2:s timer A startas om vid varje puls; svag) och väntan på ledaren `$a0` och synken `$0a`…`$01` genom grenar den skriver om (`cmp #$a0 / bne / lda # / sta / bne / cmp #$a0 / beq / cmp #$0a / beq`; svag), och lagringen som räknar upp den negativa längden (`sta (zp),y / eor zp / sta zp / inc zp / bne +4 / inc zp / dec zp`). Rainbow Arts, Magic Bytes och Golden Goblins bootfiler har de två svaga (så de heter inte Microload). Interceptor Micros egna spel, Electric Dreams, Epyx, Players. Bandformatet i 13.5e |
| Mastertronics bandladdare | bitläsningen `lda #$10 / bit $dc0d / beq / lda #$11 / sta $dd0e / lda $dd0d / lsr / bit $dc0d / rol` (CIA2:s timer A som one-shot från `$01b6`) och 9 bitar per byte (`ldx #$09 / jsr … / inc $d020 / dex / bne`). Mastertronic, M.A.D., Codemasters, Firebirds och Silverbirds budgetband, Durell (17 band) |
| Firebirds bandladdare | avbrottet `lda $dc0d / pha / and #$01 / ora zp / sta zp / pla / clc / and #$10 / beq / lda #$19 / sta $dd0e / lda $dd0d / lsr / rol` (FLAG-linjen, sedan CIA2:s timer A) och väntan på en ledarbyte och dess komplement (`cmp zp / beq / eor #$ff / cmp zp / bne`, svag); samma kod i första steget och i den andra laddaren programmet anropar (Bubble Bobbles `$1c00` och `$4900`). Firebird, Silverbird, Rainbird, Psygnosis, Odin, Thor, Activision, Melbourne House. Den piper inte (ingen SID-skrivning), så den kallas inte Bleepload. Bandformaten i 13.5e |
| Super Snapshot turbo (LMS) | Turbo V5, LOAD och SAVE. LOAD tar emot fyra byte per handskakning till `$aa–$ad` (`bit $dd00 / bvs / ldy #$03 / nop / bit $80 / lda $dd00 / lsr / lsr / nop / nop / ora $dd00 …`), och koden den kopierar till `$0200` lägger dem i minnet med ROM:en avbankade (`lda #$34 / sta $01 / lda $aa / sta ($93),y …`, 51 byte); filens första byte byts en bit i taget (`sta $a6 / ldx #8 / bit $dd00 / bvc …`): laddadressen, och bit 7 för Warp*25. En byte till GET, katalogen och filkopieraren och en från SAVE, båda på en rad utan badline (`bit $dd00 / bpl / sec / lda $d012 / sbc $26 / bcc / and #$07 / cmp #$02 / bcc`, sedan `lda $2a` respektive `lda #$07 / sta $dd00`); drivkoden skickas två halvbyte i taget med MK4:ans badline-väntan (`cmp #$31 / bcc / and #$06 / cmp #$02 / beq`); kommandona `M-R $fffe`, `M-W $0150` och `$0173` (35 byte var) och `M-E $0150`; drivkoden: starten vid `$0150`, 1541-koden vid `$0300` och `$0400`, SAVE:s vid `$0500`, 1581-koden vid `$0503` (`lda #$d2 / sta $4001`). En fil med bit 7 satt läses som Action Replays Warp*25 med Action Replays kod (mottagarloopen och avkodningen ovan; drivkoden är densamma, omflyttad), och de delarna blir turbons |
| Super Snapshot copiers (LMS) | diskkopieraren tar emot en sektor till `$0500` (`lda $dd00 / bmi / ora #$17 / sta $dd00 / lda $dd00 / bpl / and #$07 / sta $dd00` … `eor $dd00 / eor #$f9 / sta $0500,y`) och skickar den tillbaka (`ldy #0 / lda $0500,y / pha / ldx #$27 / stx $dd00 / bit $dd00 / bvs`); dess drivkod vid `$033f` (544 byte, `lda $1c00 / ora #$0c / sta $1c00 / lda #$ee / sta $1c0c`) och `$057c` (352 byte); filkopierarens drivkod vid `$0400` (768 byte, märkt `"2A" $9c` först) |
| Split freeze loader (Action Replay, Super Snapshot) | första filen i en backup sparad som två (Super Snapshots *BREAK INTO 2 FILES*, Action Replay 4:s *split freeze*): `sei / inc $01 / ldx #n / ldy #0 / lda $0847,y / sta $d000,y …` kopierar dess n sidor till `$d000` med I/O avbankat; `lda $bb / bne / dec $bc / dec $bb / inc $b7 / lda #"1" / sta ($bb),y` sätter en "1" framför namnet den laddades med, och `jmp $ffd5` med `$080c` på stacken laddar den filen, resten av backupen, över sig själv och fortsätter på `$080d`. Den laddar med KERNAL:s LOAD, så drivkod och drivkommandon räknas aldrig till den |

**I en VICE-snapshot** som öppnats från `$0200` (13.7) finns nollsidan och stacken bara i snapshoten. Sparkle har sin
mottagarloop i stacken (`$0160`). En känd loaders mönster (inte de fasta sidorna) söks därför också i snapshotens
`$0000–$01ff`. Delen som hittas där har `outside`: Explorer visar den utan länk, som *not opened*, och säger att
*VICE snapshots: include the zero page and the stack* i Settings → Analysis tar med den nästa gång snapshoten öppnas.

Den klassiska 2-bitsloopen `lda $dd00 / lsr / lsr / eor $dd00 …` finns i Covert Bitops-loadern men också i många äldre
loaders. Ensam ger den därför bara en okänd loader, med loopen beskriven. Ett namn ensamt, till exempel "KRILL." eller
"sparkle" i en text, räcker inte. Det räknas bara med loaderns kod eller direkt efter ett drivkommando.

Action Replays mönster kommer ur cartridgens ROM (5.1, 7.2 och 7.5 har samma kod på olika ställen), ur backuper och
loaderfiler som de sparat i VICE och ur MK4:s loaderfil. Koden som ROM:et har för att kopiera till drivenheten eller
stacken är data där, så den delen är så många byte som koden är (till exempel 768 för Warp*25:s drivkod), utom när
koden spårats. I en cartridge hamnar varje loader i sin bank: fastload och Warp*25 i bank 2, bandloaders i bank 1 och 3.
På 2445 program ur arkivet ändrades fyra fynd: två crackares loaders som återanvänder Warp*25-koden och två spel med
Novaload kvar i minnet.

Super Snapshots mönster kommer ur V5:s ROM (4 banker à 16 KB) och ur det den körde och sparade i VICE: drivens minne
och C64:ans dumpades medan LOAD, SAVE, 1581-laddningen, diskkopieraren och filkopieraren körde och lästes tillbaka mot
bankerna. Turbon och filkopierarens drivkod ligger i bank 0, mallen för den delade backupens laddare i bank 2 och
diskkopieraren i bank 3 (den kör sin C64-kod från `$0801–$23ff`, kopierad ur bank 0, 1 och 3). V5 har ingen bandladdare
(`$dc0d`-läsningarna kvitterar avbrott), och nibblern och parameterkopieraren laddas från en systemdisk. Turbon läser
Action Replays Warp*25-format med Action Replays egen kod, så de mönstren hittas i SS5:s ROM. En känd loader kan därför
ta en annan loaders kod (`claims`): finns dess egen kod, blir den andras delar dess, med *(the Action Replay Warp*25's
code)* sist i beskrivningen, och den andra försvinner som eget fynd. Action Replays egna loaderfiler förblir Action
Replays. Den delade backupens laddare är densamma i båda cartridgarna: av arkivets 146 sådana filer har 106 en Action
Replay-backup som andra fil, 31 en Super Snapshot-backup och 9 ingen andra fil på disken.

**De stora bandförlagens laddare** lärdes in ur deras band (2026-11-07): 6 band per förlag för de 30 största förlagen i
arkivets *Preservers/Tap* (där förlaget står i filnamnet, 180 band) kördes i Sindri med bandet i datasetten, och koden
som läste FLAG-linjen (`$dc0d`) medan motorn gick fångades. Koden grupperades efter sina instruktioner (opkoder, I/O-
och omedelbara operander), och de byte alla band i en grupp delar blev mönstren. Namnet kommer från texten laddaren har i
minnet där den har en (NOVALOAD, CYBERLOAD, FREELOAD, "(C) INTERCEPTOR MICROS 1987"), annars från förlagen. Ett eget
mönster räknas också när det ligger i samma rutin som ett mönster som andra laddare delar (Freeloads bitläsning finns i
US Golds laddare), och det namnger då rutinen. Hittas en känd bandladdare blir det allmänna bandmönstret (FLAG-avbrottet
som slås på, timern) dess delar i stället för ett eget fynd. Av de 167 av banden som gick att köra har 144 turbodata;
en känd bandladdare namnges nu i 98 (i bootfilen med huvudet, eller i det Sindri packade upp), mot 10 (Novaload) före,
22 får bara det allmänna bandfyndet och 47 inget (23 av dem är band med bara KERNAL-filer). Turbo Out Run gav förut en
KERNAL-fil, 14 sträckor okänd turbodata och "A tape turbo loader"; nu läses LOADER och A–J, och laddaren heter US Golds.
På 600 program från diskar (demos, intron, spel) ändrades inget fynd.

**Andra diskladdare** känns igen på det som alla diskladdare har. De samlas i fyndet *A fast loader (not one of the known
ones)*. Är exakt en känd diskladdare hittad, eller flera av samma märke (Action Replays, Super Snapshots), blir de i
stället dess delar (Action Replays fastload, Super Snapshots turbo). Drivkommandon ensamma blir en loader bara när
något av dem lägger kod i drivenheten eller startar den: `M-E`, eller `M-W` med fler än 4 byte. `M-R` läser bara, och
ett kort `M-W` sätter ett värde (enhetsnumret på `$0077` i Super Snapshots verktyg, en byte i ett kopieringsskydd). På
2900 program ur arkivet ändrade det och Super Snapshots mönster 14 fynd: 9 *okända snabbladdare* som bara var ett
`M-R` eller ett `M-W` på 1–2 byte försvann, 4 delade backuper fick sin laddare och ett verktyg med Super Snapshots
byte-mottagare och filkopierarens drivkod blev Super Snapshots turbo. Det som alla diskladdare har:

- **Drivkod:** absolut åtkomst till 1541:ans VIA-register (`$1800–$180f`, `$1c00–$1c0f`) och GCR-väntan `bvc *` (`50 FE`),
  `lda $1c01` räknas dubbelt. Det gäller i data som C64-koden inte spårats in i. Minst tre åtkomster nära varandra (högst
  160 byte emellan) blir en del, som växer till blockets gränser när de ligger nära.
- **Drivkommandon:** `M-W`, `M-E` och `M-R` med en rimlig adress i drivens RAM eller ROM, i den ordningen eller baklänges.
  Delen säger vad kommandot gör (*M-W $0600, 32 bytes into the drive*, *M-R … reads the drive's ROM (which drive it is)*).
  Ensamma räknas bara de som lägger in eller startar kod (se ovan).
- **Mottagarloop:** minst fyra läsningar av `$dd00` inom 48 byte, också indexerade från `$dcc0–$dcff`. Den beskrivs som
  1-bit, 2-bit eller 2-bit + ATN genom `$dd02` (en enkel VIC-bankväxling läser `$dd00` en gång).
- **Installation:** spårad kod som anropar KERNAL:s LISTEN, SECOND, CIOUT, UNLSN, TALK, TKSA, ACPTR eller UNTLK. Den räknas
  bara när det finns en loader att skicka.

**Band:** spårad kod som väntar på CIA1:s FLAG-linje (`lda $dc0d / and #$10`, `lda #$10 / bit $dc0d` eller `lda #$90 /
sta $dc0d`) och läser eller startar en timer i CIA1 eller CIA2 högst 256 byte därifrån, utom där en känd bandladdare
redan hittats. **KERNAL LOAD:** varje `jsr $ffd5` i spårad kod, och i kod som en kopieringsloop flyttar innan den
körs (8.1b, inte flyttad än): avkodad där den är laddad, från där hoppet in i kopian går, längs grenar och hopp och
anrop in i den (`copiedCode()` i `copies.ts`). Delen ligger där byten är laddade och säger var den körs. The Last Ninja
+Triads uppackade fuskmeny kopierar laddaren från `$ca00` till `$0400`, där spelet anropar den med namnet satt direkt i
nollsidan (`$bb/$bc`, `$b7`, `$ba`, `$b9`): KERNAL LOAD på `$ca0a`, som körs på `$040a` (flyttad dit: `$040a`).

**Packade program:** loadern ligger packad tillsammans med resten, så den hittas inte förrän programmet är uppackat
(8.11b). Explorer säger det. Testerna med riktiga demos (lokalt) gav, uppackade med unp64, Bitfire i Fairlights *1337* och
*Eyes*, *Viva Las Vegas*, *Multiverse*, *O-Tech People III* och *The Lab*, och Sparkle i Genesis Projects *No Bounds*.

**Där det syns:**
- **Explorer → Loaders:** varje loader med namn, hur den fungerar och dess delar som länkar (de första tolv).
  *by its traits* betyder att den hittades på vad loaders gör, inte på sin egen kod. Utan fynd står det att ingen hittades,
  eller att programmet är packat.
- **Analysloggen:** en rad per loader (`Loader: Bitfire (Bitbreaker/Oxyron): …`).
- **Listningen och källkoden:** en kommentarsrad där varje del börjar (`// ==== Spindle (lft): resident page (jsr here to
  load the next part) ====`) och, för längre kod- och datadelar, där den slutar (`// ==== end of Spindle (lft): its part on
  the C64 ====`). Raderna sätts in som kommentarsrader (`Line.mark`), och `.byte`- och `.text`-rader bryts där. Bytena blir
  desamma. Filhuvudet listar loaderna. I listningen har markeringarna accentfärg, och blockrubriken för ett block med en
  loaderdel visar loaderns namn.

**Test:** `test/loaders.test.ts` bygger varje känd loaders loopar ur källkoden (odokumenterade opkoder som `.byte`). Den
testar också en okänd snabbladdare med drivkod, `M-W`/`M-E`, installation och 1-bitsloop, ett bandladdarmönster, KERNAL
LOAD, att demon, showcasen och en VIC-bankväxling inte ger något, och markeringarna i källkoden med verifiering byte för
byte. `fixtures/prg/loader-demo.prg` (Spindle 3-sida på `$0c00`, drivkod, kommandon och installation) är samma program
som testet bygger. E2e-testet öppnar den.

### 8.11d Rasteravbrott

`rasterIrqs()` (`packages/core/src/analyze/raster.ts`) körs sist i analysen (`AnalysisResult.raster`). Den listar varje
IRQ-rutin med rasterraden den körs på. Rutinerna är spårningens IRQ-ingångar och, i en VICE-snapshot, den som
snapshotens IRQ-vektor pekar på, också när koden som satte den inte spårats.

Ett pass över den spårade koden i raka sträckor, som evidenspasset (8.4), följer vad A, X och Y innehåller bit för bit.
Därför ger `lda $d011 / and #$7f / sta $d011` att bit 7 är 0, och `ora #$80` att den är 1.
- **Där en sträcka sätter en IRQ-vektor** (`$fffe/$ffff` eller `$0314/$0315`, båda byten konstanta) till en rutin, är
  sträckans skrivningar till `$d012` och `$d011` (de som ligger närmast) raden rutinen körs på.
- **En rutin som skriver `$d012` utan att sätta vektorn** körs igen på den raden (*itself*).
- **Raden** är `$d012` med bit 7 i `$d011` som bit 8. Skrivs inte `$d011` där räknas bit 8 som 0. Är `$d012` inte en
  konstant (en tabell) visas `?`.
- **Vem som sätter den:** IRQ-rutinen vars kod gör det (en rasterkedja), annars huvudkoden. En rutin utan någon rad
  står med *no line found* (till exempel ett timeravbrott).

Bottenpanelens flik **Raster IRQs** (med antal) visar en rad per avbrott, sorterade efter rasterrad:
- **Line** (decimalt och hex), **$d012**, **$d011** (värdet, *bit 7 = 0/1* när bara den biten är känd, `—` när den
  inte skrivs);
- **Handler**, **Set at** (skrivningen till `$d012`), **By** (huvudkoden, rutinen som sätter den, eller *itself*, och
  vektorn).

Ett klick på raden går till rutinen, ett klick på en adress dit. Demot ger en rad: rad 98 (`$62`, `$d011 = $1b`),
`irq_08b7`, satt av huvudkoden via `$0314`. **Test:** `test/raster.test.ts`: en kedja av tre med bit 8, en rutin som
sätter sin egen nästa rad, en rad ur en tabell, demot och en snapshots rutin som ingen spårad kod installerar.

### 8.11e Djupanalys

**Djupanalysen** (`packages/core/src/analyze/deep.ts`, `Settings.deepAnalysis`) byter hastighet mot noggrannhet. Den
är på för nya projekt i appen: ett projekt av filer som öppnas tar över det öppna projektets inställningar med
djupanalysen på (`newProjectSettings` i `store/project.ts`), och ett program som packas upp på sin plats behåller sitt
projekts. Sparade projekt behåller sitt värde. Biblioteket (`DEFAULT_SETTINGS`) och kommandoraden har den vanliga
analysen som standard (`--deep`). Den slås av och på med kryssrutan **Deep analysis** överst i fliken Problems eller i
*Settings → Analysis → Deep analysis (slower)*, och gäller projektet. Den är på som standard sedan den mätts mot
körningar (8.11h): den hittar lite mer av den körda koden än den vanliga analysen, med 43 % färre problem. Målet är så
få problem som möjligt i Problems (loggens varningar, fel och tips), utan att något döljs: varje beslut står i loggen
(kategori `deep`).

**Två steg i appen.** Den vanliga analysen av samma indata visas direkt, och djupanalysen, i en worker för sig, tar dess
plats när den är klar (`useAnalysis` i `lib/analysis.ts`). Under tiden säger Problems *Deep analysis running · the
normal analysis shows meanwhile* och statusraden *deep analysis…*. Ändras analysens indata medan djupanalysen körs
avslutas dess worker och en ny startar, så en djupanalys av gamla indata väntas aldrig in. En ändring som bara ritar om
(en etikett, en kommentar) ritar om den djupa analysen direkt. När den djupa analysen tar över står raden i vy
(markörens, annars den översta med byte) kvar på samma ställe på skärmen, fast raderna ovanför ändras (`holdView` i
`Listing`). Verifiering (F7), bygge och export väntar på djupanalysen. Varje djupanalys görs från början, utan vad en
tidigare lärt sig, så att samma projekt alltid ger samma listning. Mätt på ett spel där djupanalysen tar 11,6 s: den
vanliga analysen visas efter 0,9 s, och en ändring mitt i ger det djupa resultatet 12,7 s efter ändringen (inte efter
den gamla körningen).

Först görs en vanlig analys, som ger antalet problem och fel att jämföra med. Sedan görs hela analysen om i **varv**:
- **Gissningar spåras på prov.** En kodö (8.11), ett mål i en pekartabell, en IRQ-, NMI- eller BRK-rutin som koden
  installerar och laddadressen utan BASIC-rad spåras först i en kopia av spårningsläget (`trial()` i `trace.ts`). Den
  behålls bara om spårningen inte går in i något problem: JAM, BRK, ett hopp in i en instruktion, överlapp, data som
  användaren markerat, eller ett indirekt hopp via en pekare som ingen kod skriver (varken koden hittills eller den som
  spåras på prov). Annars blir den kvar som data, och
  loggen säger varför (*The routine-like bytes at $5001 (and 37 more starts up to $5152) stay data: traced on trial,
  they run into a problem (BRK at $6a68 ends the code path)*). Ett tips *Possible unreached code* ges inte för byte som
  spårats på prov och gått in i ett problem.
- **Kodöar.** Kodön där den vanliga analysen letar (den första rutinen bland ett datablocks första 8 adresser, 5.13)
  tas som den vanliga analysen tar den, utan prov, och spåras som koden hittills. Längre in i blocket letar
  djupanalysen efter rutiner som anropar känd kod (spårad kod som inte är en annan kodö, eller en rutin i ROM:en) och
  spårar dem på prov. Data som avkodas som en rutin anropar sällan kod: mätt mot körningar (8.11h) kördes de kodöar
  som anropar känd kod ungefär lika ofta som de bara lästes, de andra längre in i blocken 1 gång på 16.
- **Skulden läggs där problemet uppstår, för starka gissningar.** En avbrottsrutin som koden installerar och
  laddadressen är starka bevis. En sådan gissning fälls inte för ett problem bakom ett beslut. Det sista beslutet på
  vägen till problemet lämnas bort, och gissningen spåras på prov igen, högst 8 gånger. Beslutet är sidan av en gren som
  flaggorna inte avgör, eller byten efter en `JSR`, där rutinen då inte återvänder. Loggen säger det (*The IRQ handler
  at $081a is kept without the side of the BMI at $081d that goes to $081f: traced on trial, that runs into a problem
  (BRK at $081f ends the code path)*). Gissningen fälls när problemet ligger på dess egen raka väg. Ett indirekt hopp
  vars mål inte är känt fäller den inte, eftersom det inte är något fel. Den spåras på prov som koden hittills: en `JSR`
  eller `JMP` till BRK eller JAM går till en rutin som läggs dit vid körning, och en väg stannar tyst vid en instruktion
  som koden skriver. En avbrottsrutin spåras med de konfigurationer dess vektorer kräver, KERNAL inkopplad för
  `$0314`–`$0319` och bortkopplad för `$fffa`–`$ffff`, så att dess `JMP $ea31` går till ROM:en och inte till det som
  ligger under. Kodöar och mål i pekartabeller fälls som förut
  vid första problemet: deras byte ser ofta ut som kod några instruktioner innan de går in i ett problem, och mätt mot
  körningar (8.11h) gör samma regel för dem långt mer bara läst data till kod. `DeepReport.blamed` räknar sidorna.
- **Indirekta hopp via konstanter.** Skriver koden en konstant adress till pekaren som en `JMP (ind)` går genom, är
  adressen ett mål (spårat på prov), och hoppet varnas inte för som okänt.
- **Grenar med kända flaggor.** `CLC`, `SEC` och `CLV` sätter C och V, `LDA`/`LDX`/`LDY` med en konstant sätter Z och N,
  och instruktioner som inte rör flaggorna (`STA`, `PHA`, `SEI`, `NOP` …) behåller dem. En gren efter dem tar bara den
  sida flaggorna ger: efter `lda #$a9 / sta $6497 / bne` spåras inte byten efter `BNE`. Nås sträckan från något annat
  håll (ett hopp in i den, en BIT-skip, en ingångspunkt) eller skrivs instruktionen av kod, följs båda sidorna igen.
- **`$01` genom stacken och variabler.** Minneskonfigurationen (8.7b) följs också genom `PHA`/`PLA` (de två översta
  värdena) och genom variabler som koden bara skriver med `STA`/`STX`/`STY` (`lda $01 / sta save … lda save / sta $01`).
  Så försvinner tipset *$01 is written … with a value the analysis cannot follow* för den vanliga IRQ-rutinen
  `lda $01 / pha / lda #$35 / sta $01 … pla / sta $01`.

Det ett varv lär sig använder nästa varv redan när det spårar:
- **ROM:** en `JSR` eller `JMP` till ett mål som är ROM eller I/O i varje konfiguration instruktionen kan köras med
  följs inte in i RAM:et under (*The JSR at $c88a to $ffe4 reaches the KERNAL ROM there, so the RAM below it is not
  traced*). Ny kod antas köras med huvudkodens konfigurationer. En vektor i `$0314`–`$0319` som pekar på `$e000`–`$ffff`
  är KERNAL:ens egen rutin, för KERNAL:en anropar den med sin ROM inkopplad (`$ea31`).
- **Självmodifierad adress:** en `JSR` eller `JMP` vars operand koden skriver har sitt mål satt vid körning. Målet den
  har som den laddats är en gissning som spåras på prov, eftersom det ofta körs innan koden ändrar adressen (*The code
  at $080f writes the address of the JMP at $0817, so its target is set at run time; as loaded, $0830 is traced on
  trial and kept*, eller *… runs into a problem on trial (…), so it is not followed*). Att inte följa det alls tappade
  mer än hälften av den körda kod som djupanalysen inte hittade (8.11h). En väg som når en instruktion som koden skriver
  och som nu är BRK eller JAM stannar där, med en rad i loggen i stället för en varning.
- **Rutinen finns inte än:** ingen rutin börjar med BRK eller JAM, så en `JSR` eller `JMP` dit följs inte: koden läggs
  dit vid körning, av en uppackare eller en kopieringsslinga (*The JSR at $080d goes to $0900, which holds $00: the
  routine is put there at run time*). Det gäller inte en gissning på prov: där fäller det gissningen.
- **Rutiner som aldrig återvänder:** når alla vägar i en rutin bara loopar, utan `RTS`, `RTI` eller `JMP (ind)`, spåras
  inte byten efter en `JSR` dit.

Varven slutar när nästa varv skulle besluta likadant (samma snitt i varvets kod, samma huvudkonfiguration), efter högst
6. Ett snitt vars mål är kod ändå räknas inte, eftersom spårningen inte gör några snitt till kod den redan har. Resultatet är djupanalysens, utom när den vanliga analysen har färre **fel**: då är det den vanliga, med en rad om
det. Fel är varningar och fel som säger att kod läses fel (JAM, BRK, överlapp, ett hopp in i en instruktion …), inte
tips och inte indirekta hopp vars mål inte är känt: de kommer med koden som läses, och en djupanalys som hittar mer kod
hittar fler av dem. I Fairlights cartridge (bank 0) har djupanalysen 11 problem, alla indirekta hopp via RAM-vektorer och
tips, och den vanliga 9, varav en kodö som överlappar annan kod; den vanliga hittar 2 300 byte mindre kod (`isFault()`,
som går efter problemens koder, 8.11g).
På 2 360 program ur arkivet får 131 program mer kod så (200 157 byte, 157 fler textblock), och problemen i Problems blir
2 631 i stället för 1 134, alla tips och indirekta hopp: felen blir aldrig fler. Att räkna de indirekta hoppen också tar
bort en tredjedel av koden men bara 91 av problemen: de flesta är tips. `AnalysisResult.deep` (`DeepReport`) har varv, problem före och efter, gissningar som lämnats, snitt, grenar och
tid; Problems visar *150 → 0 problems in 3 rounds, 1.5 s: N solved, M decided · the Log tells what it left out*. Det
differentiella testet kör utan djupanalys, och den vanliga analysen är oförändrad.

**Lösta och avgjorda problem.** Problemantalet sjunker både när djupanalysen läser koden rätt och när den bara bestämmer
sig. Därför säger rapporten för varje problem som den vanliga analysen har och djupanalysen inte har varför det är borta
(`DeepReport.gone`, per `GoneWhy`):
- **löst**, koden läses rätt: problemet låg på en grensida som flaggorna aldrig tar (`flags`), bakom ett anrop in i ROM
  eller bakom en KERNAL-vektor som pekar på KERNAL:ens egen rutin (`rom`), bakom ett hopp vars mål koden skriver
  (`smc`), efter ett anrop till en rutin som aldrig återvänder (`noreturn`), eller vid ett indirekt hopp vars mål nu är
  känt (`pointer`) eller där `$01` nu följs (`port`);
- **avgjort** på en gissning: problemet låg i en gissning som lämnats som data (`rejected`) eller i ett tips om byte som
  nu läses som kod (`kept`), på en sida som lämnats bort för en stark gissning (`blamed`), i en rutin som antas läggas
  dit vid körning (`runTime`), eller i en krock mellan två läsningar där djupanalysen valt bort den ena (`chosen`);
- `other` när inget av det förklarar det.

Vad som ligger bakom ett beslut, både problemen och instruktionerna, tas från provspårningen för fällda gissningar (allt
den läste och gick in i) och för problemen på bortskurna sidor. Bortskurna sidor och snitten i huvudspårningen (flaggor,
ROM, mål som koden skriver, rutiner som inte återvänder eller läggs dit vid körning) spåras som den vanliga analysen
skulle, utan djupanalysens regler (`behind()` i `trace.ts`). De avgjorda räknas först, så ett problem som ligger bakom
både ett avgjort och ett löst beslut räknas som avgjort. Ett problem i kod som djupanalysen har kvar räknas efter vad den
vet där nu: ett indirekt hopp utan varning har ett känt mål (`pointer`), en `$01`-skrivning utan tips följs (`port`). En
BRK eller JAM som koden skriver är löst (`smc`). Ett tips om oanvänd kod knyts till en fälld gissning nära blockets
början, eller till det som tog bort koden före blocket. En krock knyts till det som ligger bakom den andra läsningen. Loggen säger det
(*Of the 3 problems the normal analysis has and this one does not, 2 are solved, the code read right (2 behind calls
into ROM), and 1 decided on a guess (1 in guesses left out as data)*), sammanfattningen likaså (*Deep analysis: 3 → 0
problems in 2 rounds (2 solved, 1 decided): …*), och `DeepReport.added` räknar problemen som djupanalysen har men inte
den vanliga. `DeepReport.decisions` har var besluten togs, så att `mimir measure` kan pröva dem mot körningen (8.11h):
hur många av de fällda gissningarnas starter, de bortskurna sidorna och rutinerna som antas läggas dit vid körning som
faktiskt kördes så som de laddades. När resultatet är den vanliga analysen är inget borta och inget beslut står kvar.

**Mätt** på 1060 riktiga program ur referensarkivet: 4 054 problem blir 620, och 733 program i stället för 341 har
inga problem alls. 105 av de 620 är *very high entropy* (packade program, som ska packas upp först). 7 % mer blir kod,
alla 1060 återskapas byte för byte, och analysen tar i snitt 4–5 gånger så lång tid (som mest drygt 2 s).
Användarens snapshot (en meny vid `$c800` med ett spel i minnet) går från 150 problem till 0 på 1,5 s. **Test:**
`test/deep.test.ts`: ett exempel per regel, att den vanliga analysen har problemen och djupanalysen inte, att allt
assembleras tillbaka byte för byte och att djupanalysen aldrig har fler problem; fuzz-testet slår på den slumpvis.

### 8.11f Spindle-skriptet (Pefchain)

Spindle (lft) länkar en trackmo med **Pefchain** efter ett skript: en rad per del med delens `.pef`-fil och villkoret
som avslutar den (`space`, `-` för direkt, `stay`, `adress = värde`, `@` för musikens interlock), `|` för att fortsätta
delen innan, `-` som namn för Pefchains tomma del och `NN:` för en etikett att söka till. Skriptet finns inte på disken.
Pefchain gör varje rad till en **driver**, ungefär 48 byte kod direkt efter delens kod: den installerar delens avbrott,
anropar dess setup, anropar laddaren och nästa dels prepare, väntar på villkoret, kör fadeout och cleanup och hoppar
till nästa driver. `findSpindle()` (`packages/core/src/analyze/spindle.ts`) läser tillbaka driverna i minnet till
skriptets rader (`AnalysisResult.spindle`, `SpindleDriver`), direkt efter startpunkterna (8.2).

- **Koden** är den Spindle 3.0 och 3.1 skriver (`pefchain.c`: `generate_drivers` och rutinerna den anropar,
  MIT-licens; `template/earlysetup.s` och `seek.s`, public domain). Den är kontrollerad mot driverna som
  `pefchain -v -v` skrev ut för egna testdelar. Spindle 2 bygger andra drivers, som inte läses.
- **Var de hittas:**
  - sidodörrar (`lda #$4c / sta zp / pla / sta zp+1 / pla / sta zp+2 / jsr zp`), där en sökning eller nästa
    disksida kommer in. Den första drivern har den tidiga setupen före och `clc / bcc` förbi sidodörren;
  - framdörrar som sätter `$fffe/$ffff` och gör `lsr $d019 / cli`;
  - de drivers som de hoppar till.
- **Krav:** hela drivern måste följa Pefchains mönster till slutet: `jmp` till nästa, `clc / bcc *`, ett söksprång
  till nästa disksida, eller en del som stannar. En framdörr som bara gör det vilken kod som helst gör (installerar ett
  avbrott, anropar och hoppar) räknas bara när den hoppar till en driver.
- **Vad som läses:**
  - delens rutiner (prepare, setup, irq, main, fadeout, cleanup) och villkoret;
  - nästa dels prepare;
  - om den laddar (`jsr` till laddarens residenta sida, `$0200` om inget annat syns);
  - nästa driver, och etiketten den söker innan den hoppar tillbaka (`-L`);
  - J-taggen (delens fadeout väljer en etikett);
  - Pefchains tomma del (dess avbrott och setup, och musiken den spelar);
  - `|`.
- **Ett ensamt anrop** som kan vara både delens cleanup och nästa dels prepare blir cleanup när det ligger närmare
  under den här drivern än under nästa.
- **Ordning och nummer:** delarna står i den ordning de körs, och den första driverns kedja kommer först. `|` behåller
  sin dels nummer. I en snapshot är den del som kör *running*: PC:n är i dess driver, eller IRQ-vektorn pekar på dess
  avbrott.
- **Startpunkter:** driverna är ingångar (`entry`). I en snapshot är driverna för delarna före den som kör gissningar
  (`guess`, som djupanalysen spårar på prov), eftersom senare delar kan ha laddat över deras rutiner.
- **Etiketter** heter efter delen:
  - `spindle_start` för den tidiga setupen;
  - `part2_driver` (`part2_driver2` för `|`) och `part2_seek` för sidodörren;
  - `part2_prepare`, `part2_setup`, `part2_irq`, `part2_main`, `part2_fadeout` och `part2_cleanup`.
- **Källkoden:**
  - filhuvudet har skriptet som kommentarer;
  - en `====`-rad markerar varje driver med sin skriptrad (*the early setup and the first driver*, *its driver*,
    *a driver that goes on with it*);
  - fler `====`-rader visar var sidodörren och framdörren är.

Bottenpanelens flik **Spindle script** (med antal) finns bara när analysen hittat drivers. Den har en rad per skriptrad:
- **Part**;
- **Script line**: namnet (`partN.pef` är påhittat, eller `|` eller `-`) och villkoret, med etiketten `01:` före när
  en loop visar den;
- **Driver**;
- **Routines**: klickbara etiketter, och *loads*, *blank part*, *interlock* eller J;
- **Then**: nästa del, *its | line*, *back to part 1 · seeks label 01*, *the end of the demo*, *stays*, *the next disk
  side*, eller en adress som inte är i minnet.

Ett klick på raden går till drivern, ett klick på en rutin dit. **Copy script** kopierar skriptet som text, så som
Pefchain läser det, med drivern och rutinerna efter `#`.

**Mätt:**
- inga drivers i de 1078 programmen i testkorpusen, och ungefär 2 ms per program;
- en VICE-snapshot av en trackmo som `pefchain` 3.1 byggt av fem egna testdelar gav alla sex drivers, med rätt villkor,
  rutiner och del som kör.

**Test:** `test/spindle.test.ts` innehåller:
- driverna pefchain skrev för fem skript: alla villkor, `|`, den tomma delen, etiketter, J, en loop och sista delen på
  en disksida;
- skriptet som text;
- etiketter, markeringar och byte-exakt bygge;
- en snapshot;
- kod som installerar ett avbrott som en driver gör men inte är en.

`fixtures/prg/spindle-demo.prg` är minnet från det första skriptet.

### 8.11g Problemkoder

Varje varning, fel och tips i loggen, alltså det fliken Problems listar, har en **kod** för sin sorts problem
(`LogEntry.code`, listan `PROBLEM_CODES` i `types.ts`). Djupanalysen, testerna och appen går efter koden, inte efter
meddelandets ordalydelse, som kan ändras:
- djupanalysens **fel** (`isFault()`, 8.11e) är varningar och fel utom `ijmp-unknown`;
- en gissning på prov (`trial()`) fälls av varningar och fel utom `inline-data`;
- knappen *Turn on* i Problems sitter på `io-as-labels` och *Relocate…* på `copy-loop`, och fliken Relocated tar skälet
  till att ett block inte placerats från `reloc-unplaced`.

| Kod | Problemet |
|---|---|
| `jam`, `brk` | en kodväg når en JAM-opkod eller en BRK |
| `mid-instruction` | ett hopp eller en gren går in mitt i en instruktion |
| `overlap` | en instruktion skulle överlappa annan kod eller gå utanför de laddade byten |
| `into-user-data` | en kodväg går in i byte som användaren markerat som data |
| `undocumented-off` | en kodväg når en odokumenterad opkod när de är avslagna |
| `ijmp-unknown` | en indirekt `JMP` går via en pekare som ingen känd kod sätter |
| `inline-data` | en `JSR` till en rutin som plockar sin återhoppsadress: data av okänd längd följer |
| `into-relocated` | en kodväg går in i ett block som flyttats för att köras någon annanstans |
| `unreached` | tipset *Possible unreached code*: data som avkodas som en rutin som inget når |
| `port-unknown` | `$01` skrivs med ett värde analysen inte kan följa |
| `io-as-labels` | bankspårningen är av, så I/O inne i de laddade byten skrivs som etiketter |
| `copy-loop` | en slinga kopierar kod och hoppar dit, och blocket är inte flyttat dit |
| `high-entropy` | datan ser packad ut |
| `file-truncated`, `file-overlap` | en fil går förbi `$ffff`, eller överlappar en tidigare fil |
| `entry-not-loaded` | programstarten som satts ligger inte i en laddad fil |
| `reloc-unplaced` | ett flyttat block kan inte placeras där det körs |

Typen tvingar fram koden: loggfunktionen (`L()`) tar en kod för nivåerna `warn`, `err` och `hint`, så ett nytt problem
utan kod kompilerar inte. `mimir analyse` skriver koden efter raden (`[jam]`) och har den i `log` med `--json`; i
Problems står koden och vad den betyder i verktygstipset på kategorin.

**Test:** `test/deep.test.ts` (fel och problem efter kod, oavsett meddelandet) och fuzz-testet, som kontrollerar att
varje varning, fel och tips har en känd kod och att inget annat har någon.

### 8.11h Analysen mot en körning

Problemantalet säger inte hur mycket av analysen som är rätt: det sjunker både när analysen hittar koden och när den
bara bestämmer sig (en gissning som fälls blir data och har inga problem), och rundturen bevisar bara att byten
assembleras tillbaka, inte att indelningen i kod och data stämmer. En körning ger ett facit för en del av byten.

**Sindri bokför vad programmet gör med de laddade byten.** Från det att filen laddats noterar den emulerade C64:an
första gången varje byte körs som opkod, körs som operand, läses som data och skrivs. Det som hände före första
skrivningen gjordes med byten så som den laddades. `UnpackResult.fileUse` har per adress `FILE_RAN`, `FILE_ARG`,
`FILE_READ` och `FILE_WRITTEN` (byten skrevs senare; det som kom efter gäller inte den laddade byten). Kod som
packas upp, kopieras eller skrivs över sin egen plats räknas alltså inte, eftersom den inte är det som laddades.

**`checkRun(A, fileUse)`** (`runcheck.ts`) ställer det mot analysen, för de byte filen laddar:
- *instruktionsstarter som kördes*: hittade (analysen börjar en instruktion där), *ur takt* (inne i en instruktion
  analysen läst från en annan start) eller *som data*;
- *byte som bara lästes* (aldrig kördes): hur många analysen gjort kod av, och av dem hur många som ligger i källan till
  en kopieringsslinga analysen hittat (kod som körs där den kopieras). En operand som koden läser och skriver, som en
  räknare, räknas inte när dess instruktion kördes;
- kodbyte som körningen inte rörde.

Körningen täcker bara de vägar som kördes, så en byte den inte rörde säger ingenting. Det som kördes är kod, och det som
bara lästes är troligen data.

**`mimir measure <mapp>`** kör varje PRG och projekt i mappen i Sindri och skriver per program och totalt hur många
instruktioner som kördes och hur många analysen hittade, och problemen per kod (`--json` för skript). Ett projekt
startas vid sin programstart, så som appen sätter den för ett program Sindri packat upp utan BASIC-rad. Med och utan
en inställning (`--deep`, `--set codeIslands=false`) visar det vad inställningen gör med träffsäkerheten och inte bara
med problemantalet.

**Mätt** på 1 000 program ur referensarkivet (första PRG:n på en disk per release: 350 intron, 350 demos och 300 spel).
897 var packade och packades upp med Sindri, 819 av dem till ett projekt med programstart. 920 körde kod.

| | Vanlig analys | Djupanalys före | Djupanalys nu |
|---|---|---|---|
| problem | 7 509 | 1 470 | 1 532 |
| program utan problem | 155 | 394 | 383 |
| körda instruktionsstarter hittade (av 551 908) | 92,3 % | 86,7 % | 91,8 % |
| körda instruktionsstarter som data | 42 220 | 72 815 | 44 837 |
| ur takt | 407 | 389 | 341 |
| byte som bara lästes, som kod | 155 780 | 401 578 | 406 707 |

*Före* tog djupanalysen bort fyra femtedelar av problemen men hittade mindre av koden som körs. I 257 program tappade den
51 392 körda instruktioner, och i 103 hittade den 20 815 fler. Av de 682 program där problemen blev färre tappade 229
kod som kördes. I de 257 programmen fälldes gissningar vars start kördes så här:
- 137 av 223 IRQ-rutiner som koden installerar;
- 29 av 30 laddadresser;
- 281 av omkring 4 700 kodöar.

Alla 12 IRQ-rutiner som fälldes för ett indirekt hopp kördes. Provet frågade om pekaren i huvudkontexten, och där fanns
inte rutinens egen kod som skriver den. Ändringarna i provet (8.11e) mättes en i taget:

| Ändring | hittade | som data | bara läst, som kod | problem |
|---|---|---|---|---|
| pekare som gissningen själv skriver räknas som kända | 87,0 % | 71 284 | 396 122 | 1 515 |
| starkaste gissningen först (inte kvar: ingen skillnad) | 87,0 % | 71 284 | 396 122 | 1 515 |
| skulden på sista beslutet, för starka gissningar | 91,3 % | 47 397 | 398 978 | 1 534 |
| stark gissning spåras som koden hittills | 91,5 % | 46 826 | 399 381 | 1 533 |
| avbrottsrutin med vektorernas konfiguration | 91,8 % | 44 837 | 399 748 | 1 532 |
| (skulden för alla gissningar, inte kvar) | 92,5 % | 40 878 | 581 233 | 1 837 |

Skulden även för kodöar och pekartabellmål hittar lite mer kod men gör 182 000 fler bara lästa byte till kod. Nu tappar
djupanalysen körda instruktioner i 172 program (21 666) och hittar fler i 122 (19 115); av de 682 program där problemen
blir färre tappar 150 kod som kördes. Siffran för byte som bara lästes är för hög: kod som kopieras av en slinga
analysen inte hittat räknas också. Djupanalysen tar i snitt 528 ms mot 565 ms före och 90 ms för den vanliga, som mest
13,8 s (ett spel med över tusen gissningar som fälls; 12,8 s före). En mätning tar några minuter.

**Lösta och avgjorda problem** (8.11e), på samma 1 000 program: av de 6 452 problem som den vanliga analysen har och
djupanalysen inte har är bara 863 lösta (13 %): 347 bakom anrop in i ROM, 188 indirekta hopp med känt mål, 163 där
`$01` följs, 89 på grensidor som flaggorna aldrig tar, 73 bakom mål eller instruktioner som koden skriver och 3 efter
rutiner som aldrig återvänder. 5 284 är avgjorda (82 %): 4 754 i gissningar som lämnats som data, 220 tips om byte som
nu läses som kod, 155 i rutiner som antas läggas dit vid körning, 108 på sidor som lämnats bort och 47 krockar där en
läsning valts bort. 305 (5 %) förklaras inte, och djupanalysen har 475 problem som den vanliga inte har. Av de 383
programmen utan problem kommer 181 dit enbart genom lösta problem. Mot körningen kördes 34 av 148 bortskurna sidor,
691 av 79 368 starter av fällda gissningar (de flesta är förskjutna starter i samma datablock) och 4 av 1 475 rutiner
som antogs läggas dit vid körning. Rapporten kostar lite: djupanalysen tar i snitt 448 ms mot 74 ms för den vanliga
(6,1 gånger, mätt utan något annat igång; tidigare 5,9–6,3 gånger), som mest 11,1 s.

**Kodöarna** (`--set codeIslands=false`) står för en stor del av den kod som körs, och för det mesta av datan som blir
kod. Utan dem hittar den vanliga analysen 85,0 % (i stället för 92,3 %) och gör 38 905 bara lästa byte till kod (i
stället för 148 278). Djupanalysen hittar 79,7 % (i stället för 91,8 %) och gör 28 745 till kod (i stället för
399 748). Djupanalysens kodöar, som söktes i hela datablocket, gav alltså 12 procentenheter mer körd kod men 371 000
fler bara lästa byte som kod, mot 7 procentenheter och 109 000 för den vanligas.

**Kodöarna gjorda träffsäkrare** (8.11e), prövat en regel i taget mot körningarna. Av de 27 081 kodöar djupanalysen
behöll kördes 2 016 och 9 741 lästes bara. De som anropar känd kod kördes ungefär lika ofta som de lästes; de utan anrop
och utan I/O längre in i blocken 1 gång på 16. Att fälla kodöarna på prov tappade äkta kodöar: även med skulden på sista
beslutet nådde ingen sådan variant den vanliga analysens 92,3 %. Av den körda kod djupanalysen inte hittade låg mer än
hälften (8 494 av 16 030 instruktioner, i 109 program) bakom hopp vars adress koden skriver. Det som blev kvar:

| | hittade | bara läst, som kod | problem |
|---|---|---|---|
| djupanalysen före | 91,8 % | 399 748 | 1 532 |
| + adressen som koden skriver, som den laddats, på prov | 93,2 % | 400 057 | 1 534 |
| + kodön i fönstret som den vanliga, längre in bara med anrop till känd kod | **92,8 %** | **169 496** | 4 253 |
| (samma, med I/O som tecken också) | 93,5 % | 198 221 | 4 901 |
| (bara kodön i fönstret) | 91,3 % | 121 383 | 3 451 |
| den vanliga analysen | 92,3 % | 148 278 | 7 509 |

Djupanalysen hittar nu lite mer av den körda koden än den vanliga och gör 14 % fler bara lästa byte till kod, med 43 %
färre problem. Av de 3 669 problem den vanliga har och den inte har är 1 048 lösta, 2 393 avgjorda och 228 utan funnen
orsak. Den tar i snitt 243 ms (4,1 gånger den vanligas 60 ms, tidigare 448 ms) och som mest 3,8 s (tidigare 11–16 s),
eftersom den provar färre kodöar och varven slutar tidigare.

**Test:** `test/runcheck.test.ts` (varje sorts utfall på en konstruerad körning, och en riktig körning där analysen
hittar varje instruktion), Sindris `test/unpack.test.ts` (byte som körs, läses, skrivs före körning och aldrig rörs) och
CLI:ns test av `measure`.

### 8.11i Drivkoden

Fliken **Drive code**, bredvid Listing, visar drivkoden: koden för 1541:an (eller en 1581) som programmet har i C64:ans
minne och laddar upp till driven. I listningen är den data, eftersom C64:an aldrig kör den. Här är den återassemblerad
där den körs i driven: `driveCode()` (`packages/core/src/drivecode.ts`) skriver en Kick Assembler-källa där varje del står
där den ligger i C64:ans minne (`.pc`), inuti `.pseudopc` på adressen där den körs i driven. Källan assembleras alltså till
programmets egna byte igen. Fliken assemblerar den med Mimirs assembler och säger *Re-assembles to the same N bytes*, eller
var den ger andra byte. Med KickAss 5.25 gav alla 15 program med drivkod i korpusen nedan programmets byte.

**Delarna** är loadernas `drivecode`-delar (8.11c) och drivkommandona i och kring dem:

- **Byten efter ett `M-W`** (`"M-W"` lo hi n och sedan de n byten, som installationen skickar dem) körs på lo hi. Det är
  säkert. Ett kort `M-W` (högst 4 byte, som enhetsnumret på `$0077`) sätter ett värde, och dess byte följer kommandot.
- **En känd loaders del** säger själv var den körs (*code for the 1541 at $0150*).
- **Resten placeras efter sina hopp:** adressen där flest av delens `JMP` och `JSR` landar på kod i den (tre körbara
  instruktioner i rad), prövad genom att koden spåras från målen. Ett mål vars kod når en byte som inte är en
  instruktion räknas emot. En uppladdning går en sida i taget, så samma låga byte som i C64:an, en sidstart eller en
  `M-W`/`M-E`-adress väger in. Hela delen måste rymmas i drivens RAM (2 KB i en 1541, 8 KB i en 1581, som känns på sin
  CIA på `$4000`). Med för lite stöd (färre än tre poäng) står delen där den ligger, utan `.pseudopc`, och bara dess
  grenar spåras. Fliken visar hur många delar som placerats efter sina hopp: de är en gissning.
- Några byte mellan kommandona (utfyllnad efter ett `M-W`:s byte) är vanlig data.

Delar som inte överlappar i drivens minne bildar en avbild, de säkraste först (`M-W`, kända loaders, sedan hoppen), så
att ett första steg i flera `M-W` hänger ihop. En instruktion som fortsätter efter nästa drivkommando skrivs som byte.

**Koden spåras** från `M-E`-adresserna och de kända loadernas adresser, och på prov (inget behålls om vägen når en byte
som inte är en instruktion) från där varje uppladdning börjar, varje sidstart (DOS:en kör ett jobbs kod från buffertens
början) och det som delens `JMP` och `JSR` landar på. Odokumenterade instruktioner som Kick Assembler skriver godtas.
En gren direkt efter `lda #`/`ldx #`/`ldy #` eller `clc`/`sec` går bara åt det håll den alltid tar (`lda #$7f / bne`);
`bvc` och `bvs` aldrig, eftersom byte-ready-linjen sätter V i 1541:an. En byte som koden själv skriver till (en `RTS`
över en platshållare) avslutar vägen. En `BIT` vars operand är kod som spårats (`lda #8 / .byte $2c / lda #4`) skrivs
`.byte $2c` med *bit abs: skips the next 2-byte instruction*. Det som inte nås är data.

**Källan** har etiketter i Mimirs stil på drivadresserna (`entry_0700` för ett `M-E`, `sub_`, `l_`, `loop_`, `skip_`,
`smc_`, `tbl_`, `var_`, `data_`), med `_2` och så vidare när delar överlappar i driven. 1541:ans VIA-register får namn
(`VIA1_PB` serieporten på `$1800`, `VIA2_PB` huvudet och `VIA2_PA` GCR-byten på `$1c00`/`$1c01`) med `.label`-rader
som beskriver bitarna, och några ROM-rutiner som snabbladdare anropar en kommentar (`$f50a` väntar på datablocket efter
dess header, `$f556` på en SYNC, `$f5e9` datablockets kontrollsumma, `$f8e0` avkodar GCR-blocket, `$f969` avslutar
jobbet med felkoden i A, `$eaa0` reset). Drivkommandona står som `.byte` med vad de gör.

**Fliken.** Monaco, skrivskyddad, med Kick Assembler-färgning; dess modell är drivens egen, så hover visar VIA-registren
och inte listningens etiketter. Verktygsraden har delarna (en vald del visar sin `.pseudopc`-rad), kontrollen, raden
markören står på (*$0400 in the C64, $0700 in the drive*), **Show in listing** (radens byte i listningen), **Find**
(Ctrl+F), **Copy file** och **Save…** (`<program>-drive.asm`). Ett program utan drivkod (ingen snabbladdare, KERNAL LOAD,
eller en loader vars drive läser koden från disken, som BoozeLoader och Sparkle) får en förklaring. En cartridges
banker skrivs inte här.

**Mätt** på korpusen i 8.11h (första programmet på varje disk, uppackat): 14 av ~1 000 har drivkod i minnet, alla
okända snabbladdare. Alla 15 (med `fixtures/prg/loader-demo.prg`) ger samma byte, med Mimirs assembler och med KickAss.
Exempel: Game Pictures jobbkod hamnar på `$0700` (`jsr $f50a`, 256 GCR-byte till bufferten på `$0600`, `jsr $f8e0`,
`jsr $f5e9`, `jmp $f969`), Wonderlands första steg i tre `M-W` på `$0706–$075f` startat med `M-E $0736`, och Baker
Streets drivkod på `$007c–$04ca` (45 hopp) med 695 av 1 103 byte som kod.

**Test:** `test/drivecode.test.ts` (ett program med ett första steg i ett `M-W` och huvudkoden placerad efter sina hopp,
kommandona, etiketterna, VIA-namnen, en gren som alltid tas, `.byte $2c`, samma byte igen, raderna mot adresserna,
`runAddress` och fixturen) och e2e-steget som öppnar `loader-demo.prg` och fliken.

## 9. Symboldatabas

| Kategori | Område | Namnexempel |
|---|---|---|
| VIC-II | `$D000–$D02E` (speglat var `$40` till `$D3FF`) | `VIC_RASTER`, `VIC_BORDER_COLOR`, `VIC_MEM_SETUP`, `VIC_SPR0_X` |
| SID | `$D400–$D41C` (speglat var `$20`) | `SID_V1_FREQ_LO`, `SID_V1_CTRL`, `SID_MODE_VOL`, `SID_OSC3` |
| CIA 1 / CIA 2 | `$DC00–$DC0F`, `$DD00–$DD0F` (speglat var `$10`) | `CIA1_ICR`, `CIA1_PRA`, `CIA2_PRA`, `CIA2_TA_LO` |
| Färg-RAM, skärm | `$D800`, `$0400`, `$07F8` | `COLOR_RAM+12*40+5`, `SCREEN_RAM+24*40`, `SPRITE_PTRS+3` |
| KERNAL | hopptabell `$FF81–$FFF3` + kända rutiner | `CHROUT`, `GETIN`, `SETLFS`, `CLRSCR`, `IRQ_HANDLER` (`$EA31`) |
| BASIC-ROM | utvalda rutiner | `STROUT` (`$AB1E`), `LINPRT` (`$BDCD`) |
| Vektorer | `$0314–$0329`, `$FFFA–$FFFF` | `CINV`, `CINV+1`, `NMINV`, `IRQ_VECTOR` |
| Systemvariabler | nollsidan, sida 2 | `CPU_PORT` (`$01`), `LSTX` (`$C5`), `TIME+2`, `KEYD` |

**Upplösningsregler:** (1) laddat program vinner över ROM-namn, (2) I/O-namn vinner i `$D000–$DFFF` utom för JSR/JMP, (3) flerbytesymboler ger `NAMN+n`, (4) skärm och färg-RAM uttrycks som `rad*40+kolumn`, (5) speglingar som `VIC_RASTER+$40`. Symbolerna exporteras som `include/c64-hardware.asm` (`.label NAMN = $xxxx // beskrivning`), eller inline, eller inte alls. Det tredje valet heter *Real addresses* i Settings → Kick Assembler output → *Hardware registers and KERNAL routines* (`hwInclude: 'none'`, sparas i projektet). Då skrivs adressen själv (`sta $d020`, `jsr $ffd2`, i nollsidan med två siffror som förut), varken `#import` eller `include/c64-hardware.asm` skrivs, och med hårdvarukommentarer på står registrets beskrivning kvar som kommentar (`sta $d020 // Border color`). Listningen visar namnet när muspekaren står på adressen. **Planerat:** spårning av skrivningar till `$01` så att `$A000–$BFFF`/`$E000–$FFFF` tolkas som RAM när ROM är bortbankat.

## 10. Interaktiv editering och refaktorisering

| Kommando | Tangent | Effekt |
|---|---|---|
| Döp om etikett | `N`, dubbelklick, högerklick → *Rename namn…* | Radens egen etikett. Inline-popover; alla referenser uppdateras direkt. Gäller också `.label namn = $xxxx`-rader: nollsidevariablerna och andra filers etiketter i filhuvudet, och etiketterna i binärblock. Appen minns vilken sådan rad som klickades, eftersom filhuvudets rader delar adress. En nollsidevariabel har märket *zero page* på sin rad, och redigeringsrutan heter *Zero-page variable at $xx*, har varningsfärg och förklarar att varje åtkomst till `$xx` (och `$xx+1` för en pekare) får namnet. Högerklicksmenyn säger vad valet döper om: *Rename smc_0450…*, *Rename zero-page variable ptr_fb…*, och på en rad utan egen etikett *Add label at $0453…*. Ett nytt namn får inte heller krocka med en nollsidevariabel |
| Döp om operandens etikett | `Shift+N`, högerklick → *Rename namn…* (valet under radens eget), kommandopaletten | Etiketten eller nollsidevariabeln som radens operand namnger, direkt från raden: på `lda l_3000,y` döper `Shift+N` om `l_3000` utan att man först går dit. Gäller också `etikett+n` (`inc smc_08ef+1` döper om `smc_08ef`), låg och hög byte (`lda #<irq_08b7`) och nollsidevariabler (`sta ptr_fb+1`, samma varningsfärgade ruta som på `.label`-raden). I en datarad gäller det byten som högerklickades eller står vid markören (`.byte <fx_0919, <fx_091a, …`), annars radens etikett när den bara har en. Redigeringsrutan öppnas under raden och heter som vid etiketten (*Label at $3000*); namnet prövas, ändras överallt och ångras precis som där, och markören står kvar. Står etiketten redan på raden (`bne` till sin egen rad) finns bara radens val. Hårdvarunamn och musikens namn döps inte om. Var på raden man högerklickar spelar ingen roll: menyn har båda valen, med namnen, i samma ordning (`operandName` i `apps/desktop/src/lib/rename.ts`) |
| Kommentar | `;` | Kommentar i slutet av raden som följer med i exporten; `Delete` med muspekaren på kommentaren tar bort den (*Ta bort en kommentar*) |
| Kommentarrad / kommentarblock | `/` / `*`, högerklick → *Insert above* → *Comment line…* / *Comment block…*, dubbelklick för att ändra | Egen `//`-rad eller ett `/* … */`-block ovanför raden och dess etikett; `.byte`/`.text`-rader bryts vid adressen; tom text tar bort, liksom `Delete` med muspekaren på någon av dess rader |
| Tom rad | `Shift+Enter`, högerklick → *Insert above* → *Empty line*; `Shift+Backspace` eller högerklick på den tomma raden → *Remove empty line* tar bort | En tom rad ovanför raden, över dess kommentarrader och etiketter, för att dela upp koden. Varje tryck lägger till en till (högst 100 på en adress). Sparas som antal per adress (`Project.blanks`), som följer med när ett block relokeras, och skrivs i `.asm`-filen; `.byte`/`.text`-rader bryts vid adressen. I listningen är den en rad av sin egen: ett klick sätter markören på raden under, och högerklicksmenyn tar bort den eller lägger till en till. **En kommentar mellan de tomma raderna:** dubbelklick på en tom rad, eller högerklick → *Comment line above it…* / *Comment block above it…*, skriver adressens kommentarrad där: de tomma raderna före den står kvar ovanför och den och resten hamnar under kommentaren (`Note.below`). Högerklick → *Turn into a comment line…* / *Turn into a comment block…* gör i stället den tomma raden till kommentaren: den tar radens plats och det blir en tom rad mindre (`Esc` lämnar den tomma raden). Har adressen redan en kommentar flyttas den dit (*Move the comment line here, in place of the empty line* i radens ställe, *Move the comment line above it* ovanför den, eller *… above it and edit it…* som öppnar den). `Shift+Enter` lägger fortfarande till rader ovanför kommentaren och `Shift+Backspace` tar bort dem först; högerklicksmenyn på en rad under kommentaren lägger till och tar bort där. Töms kommentaren står dess tomma rader kvar ovanför raden. Den fälls ihop med sitt block, och i *data as code* står den ovanför instruktionen som har dess byte. Inte bland nollsidevariablerna i filhuvudet. Ångras med `Ctrl+Z` |
| Kommentera en nollsidevariabel | `;`, `/`, `*` och högerklick på dess `.label`-rad i filhuvudet, inspektorn | Som för ett block: inspektorn visar *Zero-page variable* (adress, referenser, namn, *Comment* ovanför `.label`-raden och *End-of-line comment* i slutet av den) när `.label`-raden klickats. Kommentarerna sparas på variabelns adress (`Project.comments`, `Project.notes`), som inte är laddade bytes, och skrivs bara på `.label`-raden: `.label ptr = $fb   // pekare till skärmen` med `//`-rader eller ett `/* … */`-block ovanför. Raderna bär adressen i `zp`, och listningen markerar den klickade raden. NOTES.html/.txt listar dem med variabelns namn |
| Ta bort en kommentar | `Delete` med muspekaren på kommentaren | Användarens egen kommentar under muspekaren tas bort, var markören än står: kommentaren i slutet av raden (`;`, `Project.comments`; pekaren på själva kommentartexten), en kommentarrad eller ett kommentarblock (`/`, `*`, `Project.notes`; pekaren var som helst på någon av dess rader, och hela blocket går), blockets kommentar under dess rubrik (inspektorns *Comment*, `Project.blockComments`; raderna bär `blockCmt`) och en nollsidevariabels kommentarer på och ovanför dess `.label`-rad. På en bild (sprites, tecken, bitmap) går kommentarerna till de `.byte`-rader den står för (`GfxLine.cmtAt`). De tomma raderna under en kommentarrad står kvar ovanför raden, som när kommentaren töms. Det är ett steg som ångras med `Ctrl+Z`, och en toast säger vad som togs bort (*The comment at $0810 removed (Ctrl+Z brings it back)*). Kommentarer som analysen skriver (registrets beskrivning, *self-modified by*, en laddares markeringar, filhuvudet, odokumenterade opkoder) står kvar, och en toast säger varför (`;` skriver en egen i deras ställe). Står pekaren inte på en kommentar gör `Delete` ingenting i listningen, som förut, och i en redigeringsruta eller dialog är den vanlig. Tipset på användarens kommentarer säger att `Delete` tar bort dem. `commentOf` i `apps/desktop/src/lib/comments.ts` |
| Markera som kod / bytes / ord / text | `C` / `D` / `W` / `T` | Override från markörens rad till blockets slut, eller över markeringen. Är markeringen gjord byte för byte (se *Välja byte i en rad*) gäller den exakt, och delarna av de block den kapar behåller sin typ (text, tabell, ord, grafik, musik och fyllnad, som detekteringen annars kunde läsa annorlunda; `keepCutTypes` i core). En enda vald byte är ett undantag för två typer: `W` gör den till ett ord med byten efter, och `C` markerar kod från den till blockets slut (koden börjar där). Markören går till intervallets start, och när de nya raderna kommit står den raden kvar där den var på skärmen, med blockets rubrik synlig (var starten utanför bilden visas den en tredjedel ner). Blocket ramas in i accentfärgen med vad det blev (*Marked as Bytes (.byte)*) i fyra sekunder, i listningen och i källkoden. Detsamma gäller *Clear override*, sammanslagningar, flyttade byte och talformat i inspektorn |
| Fler typer | högerklick → *Mark … as* | Screen codes, PETSCII och screen codes i *mixed case* (gemener och versaler), tabell, sprite, charset, bitmap, skärmmatris, musik, fyllnad |
| Talformat och antal per rad | inspektorn: *Format* och *Bytes per row* / *Words per row* | För data, tabeller och words. *Hex* (standard för data och tabeller), *Dec* eller *Bin* (bitarna: `.byte %00000110`, `.word %0000111000000110`). Words har också *Addr* (standard): värdet är en adress och blir en etikett där det pekar in i programmet. Med ett talformat blir words alltid tal. Antal per rad är 1–64; standard är inställningen *Bytes per row* för data och 1 för words. Enter eller att lämna fältet tar det, och piltangenterna stegar det. Ändringen sparas som en override av blockets typ med dess övriga inställningar (`formatOverride` i core). Den utgår från projektets senaste override över blocket, så en andra ändring innan analysen hunnit med den första behåller den första. Ångras med `Ctrl+Z` |
| Rensa override | `U` | Återgår till automatisk analys |
| Slå ihop block | högerklick → *Block* → *Merge with previous/next block*, inspektorn, kommandopaletten | Blocket och grannblocket före/efter (i samma fil) blir ett block av blockets typ, med dess inställningar (kodning, tabelltyp, talformat, radlängd, musikens init/play); lo/hi-tabeller och BASIC blir data. Görs som en override över båda (`mergeOverride` i core), så ångra och round-trip fungerar som vanligt; kod delas fortfarande per rutin |
| Flytta en byte till grannblocket | dra raden i adress- eller bytekolumnen till blocket ovanför eller nedanför, högerklick → *Block* → *Move $xxxx into the previous/next block* | Bara en rad i blockets kant går att dra: blockets första rad uppåt och sista rad nedåt, till ett grannblock i samma fil. Raden visar handen i adress- och bytekolumnen, och tipset säger vilka byte som går vart. Under dragningen är målblocket markerat och en etikett vid pekaren säger vad som händer (*↑ Move $0960 into the Text block above*). Släpps raden någon annanstans händer ingenting, och `Esc` avbryter. Det som flyttas är en byte, utom i kod där hela instruktionen flyttas och på en `.word`-rad där båda byten flyttas. Fler byte flyttas med fler dragningar. Att dra i källtexten markerar som förut, och `Shift` gör alltid en markering. Grannblocket växer med byten och behåller sin typ och sina inställningar. Blocket de lämnar behåller sin typ för resten (text, tabell, ord, sprite, charset, bitmap, skärmmatris, musik och fyllnad, som detekteringen annars kunde läsa annorlunda när blocket blivit kortare). Blockets kommentar, uteslutning ur bygget och binärfil följer med när blockets start flyttas (`moveBlockKeys`). Det görs som overrides (`moveBytes` och `lineMove` i core), så det ångras med `Ctrl+Z`. Kod delas per rutin, så en instruktion kan inte flytta mellan två kodblock, och BASIC-raden läses från sina rader |
| Slå ihop ett intervall | `M`, högerklick → *Block* → *Merge range into one block…*, inspektorns *Merge range…*, kommandopaletten | En dialog med start, slut (inklusive) och blocktyp. Står markören i ett block behövs bara slutet: starten och typen tas från blocket (ett valt intervall fyller i både start och slut). Dialogen visar direkt vilka block som blir ett och vilka block intervallet kapar (delen utanför behåller sin typ). Ingenting ändras förrän sammanfattningen bekräftats i ett andra steg (*Merge N blocks*). Intervallet måste ligga i en laddad fil. Har typen samma typ som blocket där intervallet börjar tas dess talformat, radlängd, tabelltyp och musikens init/play med. Görs som en override (`mergeRange` i core), ångras med `Ctrl+Z` |
| Välja byte i en rad | klick på en byte i en `.byte`-, `.word`- eller `.text`-rad, `Shift`+klick, `←` / `→` (`Shift` väljer), dra över radens byte | Varje post i en datarad är en cell: en byte i `.byte`, två i `.word`, ett tecken i `.text` (`lib/cells.ts`). Ett klick på en cell sätter markören på den byten och väljer bara den (statusraden: *sel $093c–$093c (1 B)*); markörens byte har en ram och valda byte i en rad som inte väljs helt är tonade. `Shift`+klick på en annan cell väljer byte för byte dit från den som valdes först, även över flera rader. `←` / `→` går byte för byte och vidare till raden före eller efter (från en hel rad till dess första eller sista byte; en rad utan celler, som en instruktion, väljs hel). En dragning som börjar på en cell väljer byte så länge den stannar på raden och hela rader (den raden med) när den går till en annan. Klick på adressen, bytekolumnen eller instruktionen väljer raden som förut |
| Dela ett block | `S`, högerklick → *Block* → *Split block at $xxxx*, kommandopaletten | Blocket delas vid byten eller raden vid markören i två block av samma typ och med samma inställningar (lo/hi-tabeller och BASIC blir data). Kod delas genom att en rutin börjar där (en kodoverride därifrån), och bara mellan instruktioner. Toasten säger var (*Split the Text block in two: $0949–$094f and $0950–$095f*). `splitBlock` i core |
| Foga resten till grannblocket | `J` / `Shift+J`, högerklick → *Block* → *Join $xxxx-$yyyy with the next/previous block*, kommandopaletten | `J`: byten (eller raden) vid markören och allt efter den till blockets slut går in i blocket efter. `Shift+J`: blockets början till och med byten går in i blocket före. Är flera byte valda räknas från markeringens början (`J`) eller till dess slut (`Shift+J`). Samma regler som när en byte dras till grannblocket (grannblocket behåller sin typ och sina inställningar, resten behåller sin, kod delas per rutin), men med en tangent i stället för en dragning per byte: står kod mitt i en datarad klickar man på dess första byte och trycker `J`. I kod följer hela instruktionen med. Högerklicksmenyn visar bara de flyttar som inte redan är *Move $xxxx into…*. `moveFrom` i core |
| Blockstorlek | `L`, högerklick → *Block* → *Block size… (start and end)*, inspektorns *Size…*, kommandopaletten | En dialog med blockets start, slut (inklusive) och storlek i byte (decimalt eller `$hex`; storleken flyttar slutet). Växer blocket tar det in de block det nu täcker helt och kapar det block den nya kanten hamnar i, vars rest behåller sin typ (resten av kod blir en rutin för sig). Krymper det går de byte det lämnar till grannblocket på den sidan, eller (val i dialogen) blir ett block för sig av samma typ. Sammanfattningen visar direkt vad som händer, och felen (utanför filen, mitt i en instruktion, BASIC-raden, där ett flyttat block laddas). Blockens kommentar, uteslutning och binärfil följer med när deras start flyttas. `resizeBlock` i core, ångras med `Ctrl+Z` |
| Bokmärke | `B`, högerklick → *Add bookmark…* / *Edit bookmark…*, `+` i bokmärkeslistan, kommandopaletten | En redigerare överst i bokmärkespanelen i sidofältet, med adress, titel och anteckning. Den täcker inte listningen, som visar koden på adressen mitt i bilden. Ändras adressen visar listningen den nya platsen, och *Cursor line* tar raden markören står på (man kan klicka i koden medan man skriver). `Esc` stänger utan att spara. Titeln föreslås från etiketten på adressen, annars `$xxxx`. Adressen kan ändras (bokmärket flyttas) men måste ligga i en laddad fil, och två bokmärken kan inte dela adress. `B` på en rad som redan har ett bokmärke redigerar det. Det gäller också en `.byte`-rad eller ett ihopfällt block som innehåller bokmärkets adress. Raden får en liten bokmärkessymbol i vänsterkanten; ett klick på den öppnar listan med anteckningen. **Slutadress:** fältet *End address* gör bokmärket till ett område, från adressen till och med slutadressen (tomt: bara raden). Slutadressen måste vara laddad, i samma bank och inte före adressen; *Cursor line* bredvid den tar sista byten på raden markören står på, och *Selection* tar markeringen i listningen. Markerar man ett område över mer än en rad och trycker `B` (eller högerklickar i markeringen) får det nya bokmärket markeringens första adress och dess slutadress. Medan redigeraren är öppen är området markerat i listningen. Områdets rader får en rand i bokmärkets färg i vänsterkanten, som hänger från bokmärkessymbolen ner till områdets sista rad. Ett hopp till bokmärket (dubbelklick, *Go to*, `F2`) går till områdets första rad och visar så mycket av området som får plats. Listan visar `$0810–0829` och antalet bytes. Bokmärken sparas i projektfilen men aldrig i källkoden, och de ångras med `Ctrl+Z` |
| Bokmärkeslistan | `Ctrl+B`, aktivitetsradens bokmärkesknapp (visar antalet) | Alla bokmärken sorterade efter adress, med adress och titel, och filtrerbara på titel, anteckning och adress. Ett klick visar hela anteckningen med *Go to*, *Edit* och *Delete*, och ett klick till döljer den. Ett dubbelklick går till platsen i koden |
| Nästa / föregående bokmärke | `F2` / `Shift+F2` | Går till bokmärket efter eller före markörens rad och börjar om från första eller sista. Titeln visas i en toast |
| Nästa / föregående block | `Ctrl+↓` / `Ctrl+↑`, pilarna *Next block* / *Previous block* i listningens verktygsrad (när raden är bred nog) och ⋯-menyn, kommandopaletten | `Ctrl+↓` går till nästa blocks början. `Ctrl+↑` går till början av blocket markören står i, och står den redan där till blocket före. Blockets rubrik hamnar överst i listningen med raden ovanför, så man kan bläddra block för block. Ihopfällda block förblir ihopfällda och markören stannar på rubriken, så *Fold all blocks* och sedan `Ctrl+↓` går igenom blocken ett i taget. En följd av hopp läggs en gång i navigeringshistoriken, så `Esc` går tillbaka dit markören stod före det första. Efter det sista blocket och före det första händer ingenting (`blockStep` i `apps/desktop/src/lib/fold.ts`) |
| Flyttade block | bottenpanelens flik *Relocated* (siffran: flyttade block och hittade kopieringsloopar), kommandopaletten | En tabell med de flyttade blocken: etiketten, var det är laddat och var det körs, storlek och fil, med *Runs at…* och *Stop relocating*; ett klick på raden går dit blocket körs. Ett block i projektet som analysen inte kunde lägga ut står med skälet. Under den kopieringslooparna som analysen hittat (8.1b): loopen, vad den kopierar och vart, hoppet dit, och *Relocate…* som fyller i dialogen (*Run it there…* när blocket är flyttat någon annanstans). *Relocate…* i flikens huvud relokerar markeringen eller blocket vid markören |
| Patch | `P`, högerklick → *Program* → *Patch selection/line/block with new code…* (på en patchad rad: undermenyn *Patch "namn"* överst), kommandopaletten | Ny kod skrivs över markeringen (eller raden vid markören) i de laddade bytena; `P` på en patchad rad redigerar patchen (10.2). I ett flyttat block assembleras den där koden körs och skrivs där filen har byten (`Patch.at`) |
| Flytta ett block (relokera) | `R`, högerklick → *Program* → *Relocate selection/block…*, inspektorns *Relocate…*, *Relocate…* på ett tips i Problems eller i fliken *Relocated*, kommandopaletten | En dialog med start, slut (inklusive) och adressen byten körs på (8.1b), ifylld från markeringen, blocket vid markören eller kopieringsloopen tipset gäller. Den säger direkt vad som är i vägen (något laddat där det skulle köras, blockets egna byte, en fil- eller patchgräns), varnar för kod som också körs där den är laddad, och räknar upp vad som följer med. Användarens namn, kommentarer, kommentarrader, bokmärken, markeringar (kapade vid kanterna), startpunkter, programstart, uteslutna och binära block, patchar och block flyttade därifrån flyttas till där byten körs (`addReloc`). På ett flyttat block (där det är laddat eller körs) ger `R` samma dialog för att köra det någon annanstans (`moveReloc`, allt följer med) eller *Stop relocating* (`removeReloc`, allt går tillbaka). Listningen visar raderna där blocket körs med körningsadressen, filens offset för laddplatsen och en rand i blocktypens färg (*Relocated*), och inspektorn säger var blocket är laddat och körs. Ångras med `Ctrl+Z` |
| Visa på en annan adress (visningsoffset) | `O`, högerklick → *Program* → *Show selection/block at another address (listing only)…*, inspektorns *Show at…*, kommandopaletten | Bara för manuell analys: listningen visar byten på en annan adress, med de adresser och etiketter de har där, och referenser dit går till dem. Exporten, utdata och round-trip påverkas inte (10.4). På en offset ger `O` samma dialog för att visa den någon annanstans, och *Remove the offset* visar byten där de laddas igen. Explorers sektion *View offsets* listar dem. Ångras med `Ctrl+Z` |
| Lägg till startpunkt | `E` | Spårning från adressen |
| Programstart | Explorer → *Program start* (adress eller etikett), högerklick → *Program* → *Set as program start*, kommandopaletten | Ersätter den detekterade starten (8.2); *Use the detected start* tar bort valet |
| Korsreferenser | `X` | Bottenpanelen visar alla referenser till raden: varifrån, hur (*call*, *jump*, *branch*, *read*, *write*, *read+write*, *pointer*), raden där som listningen skriver den och etiketten i koden den står i (*In*: `loop_08c2+24`, etiketten på adressen eller den närmaste före den i blocket, högst 256 byte bak). Utöver analysens referenser står varje rad vars operand namnger radens etikett med, en gång per rad, som rutan vid etiketten nedan |
| Korsreferenser vid etiketten | klick på en etikettrad, på en `.label`-rad i filhuvudet (nollsidevariabler, andra filers etiketter) eller på en etikett i vyn *Symbols* | En liten ruta bredvid etikettens rad visar vilka som refererar till den (*References to irq_08b7*, antalet). Den står under raden, så raden själv går att klicka och högerklicka (menyn), och till höger om koden på raderna den ligger över (texten, inte utfyllnaden fram till kommentarerna), så den koden syns; får den inte plats där står den vid listningens högerkant, och där listningen tar slut under raden står den över raden (det avgörs en gång, när raden syns, så rutan inte hoppar när listningen rullar). Varje referens är en rad: adressen (som listningen visar den, med visningsoffset), hur (analysens slag, och för en rad som bara namnger etiketten *low byte* för `#<irq_08b7` och `.byte <fx_0919`, *high byte* för `#>`, *pointer* för `.word`, annars *named*, som `BasicUpstart2(start)`), raden där med listningens färger och etiketten i koden den står i. Analysens referenser kommer först och en rad som också namnger etiketten står bara en gång; `inc smc_08ef+1` får slaget av analysens referens från raden till byten den namnger (*read+write*). Rader som bara namnger etiketten behövs: en IRQ-rutin har ofta inga andra referenser än `lda #<irq` / `lda #>irq` som sätter vektorn. En nollsidevariabels ruta har varningsfärgad ram, och för en 16-bitarsvariabel räknas åtkomsterna till byten efter (`sta ptr_fb+1`) med; `lda (ptr_fb),y` står en gång. Etikettens rad får en linje under namnet. Ett klick på en referens går dit och lägger hoppet i navigeringshistoriken: rutan väntar dold, och `Esc` (eller `Alt+←`, `Backspace`) tillbaka vid etiketten visar den igen med raden man gick till markerad. `Esc` med rutan uppe stänger bara den (före sökrutan och navigeringen), liksom krysset; ett nytt klick på etikettens rad medan rutan är uppe stänger den (nästa klick öppnar den igen), och ett klick på en annan rad (raden under etiketten också), en flytt av markören, `Shift`+klick, en dragning eller en dubbelklick (som döper om) stänger den. Knappen med siktet stänger den och visar samma lista i bottenpanelens *Cross-references*. Ingen referens: *Nothing references it* och varför (startpunkter, vektorer och data som bara nås genom en beräknad adress har inga). Högst tio rader syns, resten rullar i rutan. `labelRefs` i `apps/desktop/src/lib/labelrefs.ts`, `XrefPop` i `apps/desktop/src/components/Listing.tsx` |
| Gå till / välj intervall | `G`, `Ctrl+G` | Hex-adress eller etikettnamn; ett intervall (`$2000-$27ff`, `colors_0939-$0ab4`, slutet inräknat) markeras |
| Sök text | `Ctrl+F`, *Find* i listningens verktygsrad (och ⋯-menyn), kommandopaletten | En sökruta överst till höger i listningen letar i radernas text som listningen visar den, utan adress och byte: etiketter, instruktioner, operander, direktiv, kommentarer och blockrubriker. Kod och kommentar söks var för sig, så en träff går aldrig från den ena in i den andra. Texten tas som den står (inget mönster), oavsett skiftläge eller med *Aa* (`Alt+C`) som den är skriven, och med *ab* (`Alt+W`) bara som helt ord. Varje träff markeras i texten och rutan säger *3 of 17* (rader med träff). Under skrivandet visas första träffen från markörens rad; `Enter` / `F3` går till nästa och `Shift+Enter` / `Shift+F3` till den före, runt vid slutet. Markören följer med till träffens adress (inte i filhuvudet, vars rader delar adress). Har markören flyttats någon annanstans går nästa steg därifrån. En träff i ett ihopfällt block fäller ut det. Sökningen läggs en gång i navigeringshistoriken, så `Esc` stänger rutan och nästa `Esc` går tillbaka dit markören stod. I källkodsfliken öppnar `Ctrl+F` och knappen *Find* Monacos egen sökning (`findText`, `findLines` och `nextHit` i `apps/desktop/src/lib/find.ts`) |
| Följ en referens | klick på en etikett eller dess `+n` | Ett klick på etiketten i `lda tabell+1` går till tabellen. Ett klick på `+1` går till tabellen plus förskjutningen, alltså byten som instruktionen faktiskt läser. Det gäller även `smc_08ef+1` (operanden som självmodifierande kod skriver) och `music.location+$0020`. Förskjutningen kan stå decimalt, som `$hex` eller som `%binär`. Länken räknas ut i listningen, så motorns utdata är oförändrad |
| Navigering | `Enter` följ operand · `Esc` tillbaka · `Alt+←/→` | Navigeringshistorik som i en webbläsare. Är högerklicksmenyn (eller ⋯-menyn) öppen stänger `Esc` bara den (står tangenterna i en undermeny stänger `Esc` först den) |
| Cykelräkning | *Cycles* i listningens verktygsrad, kommandopaletten | Visar varje instruktions 6510-cykler och räknar markeringen eller kodblocket vid markören längs en väg, med de brancher användaren markerar som tagna (10.1). Valet sparas per användare |
| Data som kod | *Data as code* i listningens verktygsrad, kommandopaletten | Visningsläge: varje block som inte är kod (utom fyllnad) visas disassemblerat linjärt från blockets start, kursivt och märkt *as code*, så att kod som klassats som data syns; markera och tryck `C`. Exporten, verifieringen och radnumren i filen påverkas inte (vänsterkolumnen visar då adresser). Raden man tittar på står kvar på samma ställe på skärmen när läget växlas åt båda hållen: markörens rad om den syns, annars översta raden med byte, fast raderna ovanför blir fler eller färre |
| Titta åt andra hållet | håll `Ctrl` med pekaren på en rad; klick i rutan väljer byten i listningen | En liten ruta bredvid raden, från dess överkant och till höger om pekaren och om koden på raderna den ligger över (instruktioner, data och etiketter, inte kommentarer), så att den koden syns och pekaren går rakt åt höger in i rutan, visar radens block på andra sättet än listningen visar det, så man snabbt ser vad det är för data. Ett block som visas som kod (kod, eller data i *Data as code*) visas som byte, åtta per rad, med samma byte som PETSCII och som skärmkoder (gemener som i minnesvyns val). Andra block visas som kod, disassemblerat linjärt från blockets start som *Data as code* gör, så att instruktionerna står still när pekaren går nedåt i blocket; rutan börjar med instruktionen som pekarens byte ligger i. Står pekaren på en byte i en `.byte`-, `.word`- eller `.text`-rad (ett ord, ett tecken) börjar koden i stället på den byten, överst i rutan, så att kod som börjar mitt i en byte- eller ordserie syns: blocket disassembleras fram till byten (en instruktion som skulle gå förbi den blir byte) och från den. Längs samma rad flyttar koden till en annan byte först när pekaren har vilat på den i 200 ms, så att pekaren kan gå åt höger förbi byten efter in i rutan; mellan byten och på resten av raden står koden kvar. Varje instruktions byte står där också som PETSCII och som skärmkoder, i egna kolumner mellan byten och koden, så man ser om datan är text. Radens byte är markerade. Rutan visar högst 12 rader. Under blockets slut fortsätter den med blocken efter, i den ordning listningen (`.asm`-filen) har dem och på samma sätt (som byte eller som kod, varje block disassemblerat från sin egen start); där ett block börjar står en avdelare med dess typ, namn och adresser. Rutans huvud namnger blocket på översta raden. Överst står hur många byte det blocket har ovanför raderna, nederst hur många byte blocket på nedersta raden har kvar. Med `Ctrl` nere rullar mushjulet (över listningen eller rutan) listningen som det gör utan `Ctrl`, inte rutan, och det zoomar inte fönstret; rutan följer raden som kommer under pekaren (står pekaren i rutan sedan den fastnat, står rutan kvar). Kommer pekaren till en annan rad börjar rutan där igen. Ett relocerat block står som i listningen: blocken där dess byte körs. Instruktionerna använder listningens etiketter, nollsidesvariabler och hårdvarunamn, men utan bankspårning och `etikett+n`. Den följer pekaren så länge `Ctrl` hålls och försvinner när `Ctrl` släpps. Trycks `Ctrl` visas den efter 150 ms, så `Ctrl+C` och de andra kortkommandona inte blinkar fram den, och en annan tangent med `Ctrl` nere stänger den tills `Ctrl` släpps (utom `Shift` med pekaren i rutan). Ett relocerat block visas där dess byte körs, i blocken i det, och rubriken för själva blocket ger ingen ruta. Får rutan inte plats till höger om koden står den direkt under raden (över den där fönstret tar slut), med pekaren innanför sig i sidled. Har pekaren vilat på raden i 300 ms står rutan kvar när pekaren går in i den, också på snedden: åt höger mot rutan, i dess höjd. Rör sig pekaren rakt nedåt eller åt vänster, eller snabbare, följer rutan raderna som förut. Ett klick på en byte eller ett tecken i rutan, på en instruktion (dess första byte) eller på en avdelare (blockets första byte) väljer den byten i listningen som ett klick på en byte där gör (*Välja byte i en rad*): markören går dit och listningen rullar dit vid behov, så `C`, `J`, `S` och de andra kommandona utgår från den. Ligger byten i ett ihopfällt block fälls det ut, och i ett annat block än markörens läggs hoppet i navigeringshistoriken, så `Esc` eller `Alt+←` går tillbaka. `Shift`+klick väljer fram till byten. De valda byten ramas in i rutan, som står kvar tills `Ctrl` släpps (`peekOf` i `apps/desktop/src/lib/peek.ts`) |
| Byte som text | `V`, *Text* i listningens verktygsrad (och ⋯-menyn), kommandopaletten | Två kolumner längst till höger på varje rad med byte visar radens byte som PETSCII och som skärmkoder, som minnesvyn ritar dem (gemener som i dess val; ett tecken som inte syns som en punkt, inverterade tecken inverterade), så att text bland kod, eller kod bland text, syns på raden själv och alltid står i jämnhöjd med den. Högst tio tecken per kolumn visas, med `…` när raden har fler; verktygstipset har alla. En markering som tar in en del av en rad markerar dess tecken. Med *Data as code* på är varje block kod, en instruktion per rad, så att varje rad visar adress, byte, koden och samma byte som PETSCII och som skärmkoder; markering och `C`, `D`, `W`, `T` fungerar som vanligt i listningen. Ett relocerat blocks `.pseudopc`-rad och bilderna har inga textkolumner. Att kolumnerna visas sparas (`TextCols` i `apps/desktop/src/components/Listing.tsx`) |
| Utanför bygget | högerklick → *Block* → *Exclude block from the build* / *Include block in the build*, inspektorns *Include in the build*, kommandopaletten | Blocket står kvar under `#if INCLUDE_<namn>` med etiketterna i `#else`; rubriken märks *not built* och raderna tonas ned (11.5) |
| Skräp | högerklick → *Mark selection as* → *Junk*, *Block* → *Mark selection as junk* / *Mark block as junk* / *Mark range as junk…* (start och slut), inspektorns *Junk…*, *+* i Explorers *Junk*, kommandopaletten | Byten försvinner ur listningen, källkoden och utdata; Explorers sektion *Junk* listar dem och sätter tillbaka dem (11.7) |
| Fäll ihop / ut block | knappen på blockrubriken, `F`, högerklick → *Block*, kommandopaletten (*Fold every block that is not code*, *Fold all blocks*, *Unfold all blocks*) | Ett ihopfällt block visar bara rubriken med antal dolda rader; rubriken står för hela blocket (markör, piltangenter, markering). *Gå till* en adress inuti blocket fäller ut det. Bara visning: exporten, radnumren i filen och projektfilen påverkas inte |
| Vänsterkolumn | *Address* / *Line* i listningens verktygsrad, kommandopaletten | Minnesadress (standard) eller radnummer i `.asm`-filen (samma som Kick Assemblers felmeddelanden och källvyn); valet sparas |
| Markering | dra i listningen eller heatmap, `Shift`+klick/pilar/`PgUp`/`PgDn`/`Home`/`End` | Intervall för mark-as; klick på en blockrubrik tar med hela blocket, dragning förbi kanten rullar listningen. En rad med celler är markerad när markeringen tar in alla dess byte, annars är de byte den tar in tonade (se *Välja byte i en rad*). Hur många byte markeringen tar in står i högermarginalen bredvid den, i decimalt och hex (*17 bytes ($11)*): vid dess första rad, och när man rullat in i en lång markering överst i listningen så länge en del av den syns; med textkolumnerna (`V`) till vänster om dem. Bara byte listningen har rader för räknas (inte glappet mellan två filer), och en hopfälld blockrubrik står för alla blockets byte. Ett klick på en rad (eller en byte) är ingen markering och visar inget. I källkodsfliken står detsamma för raderna som markerats i Monaco, till vänster om minikartan: summan av radernas byte, när markeringen går över mer än en rad (en som slutar i början av en rad tar inte med den raden). Statusraden visar som förut intervallet (*sel $0816–$0826 (17 B)*) (`listingSelCount`, `sourceSelCount` i `apps/desktop/src/lib/selcount.ts`) |
| Minneskonfiguration / VIC-bank | högerklick → *Memory banking* (rubrikerna *Memory configuration ($01)* och *VIC bank*), inspektorn för kodblock | Koden i markeringen (eller från raden till blockets slut) körs med det valda `$01`-värdet eller den valda banken (8.7b); *Detected* tar bort valet |
| Kopiera rader | `Ctrl+C` i listningen, högerklick → *Copy N selected lines* / *Copy line*, kommandopaletten | Markeringens rader som källkoden skriver dem, i ordning och med indrag: instruktioner och data, etiketter och kommentarsrader inuti den, och rubriken på ett block som markeringen täcker helt. Ett ihopfällt block i markeringen följer med helt. Utan markering kopieras raden vid markören. Text som markerats med musen någon annanstans (loggen, inspektorn) kopieras som vanligt |
| Ångra / gör om | `Ctrl+Z` / `Ctrl+Y` | Hela projektet; senaste åtgärden visas i tooltip |
| Kommandopalett | `Ctrl+Shift+P`, `F1` | Alla kommandon sökbara |
| Verifiera / bygg och kör | `F7` / `F5` | Round-trip / KickAss + VICE |
| Bygg och kör i en debugger | `Shift+F5` | KickAss + Retro Debugger eller C64 Debugger, startat som i VICE (13.2b) |
| Brytpunkt för debuggern på raden | `F8` | sätts eller tas bort på en instruktionsrad (13.2b) |
| Bevaka radens adress i debuggern | `Shift+F8` | sätts eller tas bort (13.2b) |

**Override-modellen:** overrides lagras som en ordnad lista i projektet. `analyze()` applicerar dem i ordning (senare vinner, `auto` rensar). Bara det som fortfarande vinner räknas: en override som senare overrides täcker helt lämnar ingen blockgräns, inga props, ingen startpunkt och ingen linjär disassemblering efter sig. Att markera ett intervall slår därför ihop blocken och de tidigare overrides i intervallet till ett nytt block; en override som bara delvis täcks behåller resten som eget block. Kod-overrides blir startpunkter och, om spårningen inte når hela intervallet, linjär disassemblering. Data-overrides blockerar spårning in i intervallet och rapporterar kodvägar som når dem.

**Strukturer:** datablock, tabeller och words har radlängd och talformat (`hex`/`bin`/`dec`, för words också adresser), se tabellen ovan. Sprites exporteras som 21 rader binära `.byte`-triplar plus utfyllnadsbyte, teckensnitt per tecken med teckenkod, skärmmatriser 40 byte per rad. **Planerat (M4):** användardefinierade structs (fältnamn, storlek, antal) som exporteras med `.struct`/`.byte`-fält och fältvisa etiketter.

**Högerklicksmenyn** i listningen (`components/ContextMenu.tsx`, byggd i `onContext` i `App.tsx`) är ordnad efter hur
ofta valen behövs. Överst det raden är till för, när det finns: *Play music in VICE* på ett musikblock och undermenyn
*Patch "namn"* på en patchad rad. Sedan det som görs oftast, ett klick vart och med ikon: *Rename namn…* för radens
egen etikett (`N`) och, när operanden namnger en annan, *Rename namn…* för den (`Shift+N`), *Comment
at the end of the line…* (`;`), *Insert above* (kommentarrad `/`, kommentarblock `*`, tom rad `Shift+Enter`), *Add/Edit bookmark…* (`B`) och
*Mark … as* (typerna och *Clear override (automatic)* `U`). Resten i undermenyer efter vad det gäller: *Block* (fäll ihop,
dela, foga, flytta och slå ihop, storlek, utanför bygget, binärfil), *Program* (ingångspunkt, programstart, patch,
relokering, visningsoffset, packning) och *Memory banking* (`$01` och VIC-bank under var sin rubrik). Sist *Show cross-references* (`X`)
och kopiorna. På en nollsidevariabel finns *16-bit variable* (foga ihop eller dela). Undermenyer och rubriker som inte
har något att visa på raden visas inte. Musen och tangenterna flyttar samma markering: `↑`/`↓` (`Home`/`End`), `→` eller
`Enter` in i en undermeny, `←` eller `Esc` ut, `Enter` väljer; andra tangenter stänger menyn och gör det de gör i
listningen, så tangenterna som står vid valen fungerar med menyn öppen. En öppen undermeny väntar ett ögonblick när
musen går snett över andra val på väg in i den.

### 10.1 Cykelräkning

`packages/core/src/cpu/cycles.ts` har cykeltalen för alla 256 opkoder på NMOS-6510, även de odokumenterade (JAM stoppar
CPU:n och visas `—`). Testet jämför tabellen med reglerna per adresseringssätt och åtkomst i opkodtabellen.
`instructionCycles` ger en instruktions cykler:
- Indexerade läsningar (`abs,x`, `abs,y`, `(zp),y`) får `+`: en cykel till om indexet går över en sida. En absolut bas
  med låg byte `$00` kan inte gå över (`$1000,x` stannar i `$10xx`) och får inget `+`.
- En branch tar 2 cykler när den inte tas och 3 när den tas, eller 4 när målet ligger på en annan sida än nästa
  instruktion. Det syns direkt i adresserna.

**Listningen** får en kolumn med `4`, `4+` och för brancher knappen `2/3` (eller `2/4`). Ett klick på knappen markerar
branchen som tagen, och den gällande siffran visas fet.

**Vägen** (`cyclePath`) räknas över markeringen, eller över kodblocket vid markören utan markering. Ett klick på en
blockrubrik markerar hela blocket. Vägen börjar vid starten och kör varje instruktion en gång:
- En tagen branch framåt hoppar till målet, och raderna emellan tonas ned och räknas inte.
- En tagen branch bakåt (en loop) upprepas inte. Inspektorn visar i stället vad ett varv till tar, från målet till och
  med den tagna branchen.
- `jmp` framåt följs. En retur, `jmp` bakåt eller ut, eller en branch ut ur intervallet avslutar vägen.
- Subrutiner (`jsr`) och sidövergångar räknas inte in, men antalet visas.

Kolumnen visar summan efter varje rad (`Σ`). Inspektorns **Cycles** visar:
- totalen för vägen och totalen utan tagna brancher;
- antalet instruktioner, hur många cykler sidövergångar kan lägga till och hur många `jsr` det finns;
- varje branch med kryssruta, sina två cykeltal och totalen om den togs åt andra hållet, eller loopvarvet.

Statusraden visar totalen. Markerade brancher är visningsläge och sparas inte i projektet.

**Historik:** i produktion används Immer-patchar (inverterbara) i stället för hela ögonblicksbilder; prototypen sparar 100 ögonblicksbilder, vilket är billigt eftersom filbuffertar delas.

### 10.2 Patchar

En patch är ny kod som användaren skriver över ett intervall av de laddade bytena (`packages/core/src/patch.ts`), i
Kick Assembler eller 64tass: det språk projektets assembler har när patchen görs (`Patch.lang`, 11.8).

- **Dialogen** (`P` på en markering, högerklick, kommandopaletten) heter *Patch $xxxx–$yyyy* och har:
  - ett namn (förslag `patch_xxxx`), unikt i projektet och också namnet på PRG-filen;
  - koden, ifylld med intervallets rader som listningen skriver dem (instruktioner, data, etiketter, kommentarer);
  - *Fill the rest with*: NOP (`$ea`, standard) eller byten som redan står där;
  - *Overwrite past the range*.
- **Kodrutan** ser ut som en assemblerlistning. Till vänster om varje rad står adressen och de första byten den blir:
  en rad med bara en etikett får sin adress, och en rad som går förbi intervallet står i varningsfärg. Raden med
  markören och raden med ett fel har var sitt band över hela bredden. Rubriken säger *Code at $xxxx* och tangenterna.
  - Markören står på första instruktionen när dialogen öppnas.
  - `Tab` går till nästa instruktion och `Shift+Tab` till föregående, runt till första och sista. En instruktion är en
    rad med kod efter en eventuell etikett, inte en ensam etikett, en kommentar eller en tom rad.
  - `Enter` ger en ny rad med instruktionernas indrag.
  - `Ctrl+Enter` lägger in patchen och `Esc` stänger.
  - **Skriva över originalet** (en ny patch, vars rader börjar som originalets): ett tecken som skrivs där en
    originalinstruktion börjar (där markören står när dialogen öppnas och efter `Tab`) ersätter hela instruktionen
    till radens slut. Ändras en originalrad någon annanstans ändras bara det. I båda fallen flyttar originalet till
    kolumnen *Original* längst till höger, överstruket. Det är inte en del av koden och räknas inte. `Ctrl+Z` i
    kodrutan tar tillbaka originalraden, och då försvinner den ur kolumnen. Raderna följs när rader läggs till eller tas
    bort. Kolumnen syns när något har skrivits över.
- **Koden** är Kick Assembler. Den assembleras medan man skriver, med den inbyggda Kick-subset-assemblern, från
  intervallets start. Programmets etiketter och nollsidevariabler (som listningen namnger dem) och hårdvarunamnen i
  `include/c64-hardware.asm` går att använda. Ett namn som koden själv definierar vinner. Dialogen visar hur många byte
  koden blir av intervallets, vad resten fylls med, och byten som skrivs och byten de skriver över. Fel visas med
  radnummer i koden. Varje rad får en egen etikett före sig när den assembleras (`assemblePatch`), och etikettens
  värde är radens adress. Därför syns adresserna så långt assemblern kom, även när koden har ett fel eller är för lång.
- **Behåll cykeltalet** (*Keep the cycle count*, sparas med patchen som `cycles`):
  - Patchen måste ta exakt lika många cykler som originalet. Båda räknas rakt igenom från intervallets start till
    dess slut, eller till kodens slut när den är längre (`straightCycles`). Den nya koden räknas med sin
    NOP-utfyllnad (2 cykler per NOP), eller med originalets byte efter koden när de behålls.
  - Instruktioner vars tid varierar är en branch (2 eller 3 cykler, 4 över en sida), en indexerad läsning som kan gå
    över en sida (`abs,x`, `abs,y`, `(zp),y`, men inte `$xx00,x`) och JAM. Koden får bara ha sådana som originalet har
    i intervallet: samma opkod som varierar på samma sätt, till exempel `bne (2/3)` eller `lda $xxxx,x (4+)`. Den måste
    också ha alla originalets. Då varierar den nya koden precis som originalet, och lägsta och högsta tiden blir
    desamma. Annars blir det fel: en varierande instruktion som originalet inte har ger radnumret (*…, and the original
    has none*), och en som saknas ger *It has no bne (2/3)*. JAM går aldrig.
  - Kodrutan får kolumnen *Cy* med varje rads cykler, där en varierande står i varningsfärg (`2/3`, `4+`). Längst ner
    står *Cycles N of M*, eller *N–N′ of M–M′* när tiden varierar, och hur många som är kvar att använda, hur många för
    många eller *the same as the original*. Där står också originalets varierande instruktioner (*varies as the
    original: bne (2/3)*) eller vad koden saknar (*the code needs bne (2/3), as the original has*).
  - *Apply patch* går först när cyklerna är lika och de varierande instruktionerna stämmer.
- **Längden:** koden får inte bli längre än intervallet. Med *Overwrite past the range* får den skriva vidare över
  byten efter intervallet, och dialogen säger vilka. Den får aldrig gå utanför filen som håller intervallet eller in i
  en annan patch, och den måste skrivas i ett stycke från starten (ingen egen `.pc`). Utan kod fylls intervallet med NOP.
- **Patchen skrivs över filens byte**, och projektet sparar den i `Project.patches`: namnet, intervallet, koden,
  valen, byten den skrev (`bytes`) och byten den skrev över (`old`), base64 i `.mimir.json`. Analysen och allt annat
  (verifiering, Build & Run, Pack) ser alltså de patchade bytena.
- **Listningen markerar** de patchade byten: raderna tonas, byten och kanten står i varningsfärg, och första raden
  har märket *patch namn*. Källkoden får en kommentarsrad där patchen börjar och slutar
  (`// ==== patch "namn": $xxxx-$yyyy, N bytes written over the original ====`, `// ==== end of patch "namn" ====`).
- **Explorer → Patches** (bara när det finns patchar) listar dem efter adress med en på/av-knapp, namn och intervall,
  och storleken i tipset. Rubriken säger *N on* eller *N of M on*. Ett klick går dit och markerar byten, och knapparna
  redigerar, sparar som PRG och tar bort.
- **Av och på** (knappen i Explorer, högerklick, kommandopaletten, `switchPatch`): en avstängd patch lägger tillbaka
  de ursprungliga byten men står kvar i listan (`off` i projektet, nedtonad i Explorer). Den behåller sitt intervall,
  så ingen annan patch kan skrivas där. Listningen och källkoden markerar den inte, men exporten skriver ändå dess PRG.
  Påslagen skrivs den över byten igen.
- **Redigera:** `P` eller högerklick på en patchad rad (*Patch "namn"* → *Edit patch…*) öppnar *Edit patch "namn"* med den sparade koden. Patchen
  skrivs då om över byten den en gång skrev över. En avstängd patch förblir avstängd.
- **Ta bort** lägger tillbaka de ursprungliga byten. Allt ångras med `Ctrl+Z`.
- **Spara som PRG:** *Save patch as PRG…* (Explorer, högerklick, kommandopaletten) sparar `namn.prg` med patchens
  adress som laddadress och byten den skriver.
- **Exporten** skriver varje patch som en egen Kick Assembler-källa, `patches/<namn>.asm` (`patchSource`), och listar
  dem i README, där avstängda märks *switched off: not in the sources*. Filen assemblerar för sig själv till en PRG som
  laddas där patchen ska ligga:
  - en kommentar med namnet, intervallet och filen den skrivs över;
  - `.label` för de namn koden använder (programmets etiketter och nollsidevariabler och hårdvarunamnen);
  - `.pc = $xxxx "namn"`, koden som den skrevs och `.fill N, $ea` för NOP-utfyllnaden.

  Ger koden inte längre samma byte med programmets namn (en etikett har döpts om, till exempel), innehåller filen i
  stället byten som `.byte`-rader och koden som kommentar. Testerna assemblerar filen ensam med den inbyggda
  assemblern och med KickAss.jar. `original/` innehåller filerna som de laddades, utan patcharna, medan källkoden och
  `out/` har de påslagna patcharna i sig.
- En fil som tas bort ur projektet, eller packas upp, tar sina patchar med sig.

### 10.3 Skript

Ett skript är kod (Kick Assembler eller 64tass: det språk projektets assembler har när skriptet görs, `UserScript.lang`,
11.8) som användaren skriver i Mimir för att arbeta med programmets byte, till exempel
för att ändra en tabell eller köra en dekrypteringsloop över ett block (`packages/core/src/script.ts`). Skriptet
sparas i projektet (`Project.userScripts`) och körs i Mimir. **Det skriptet ändrar i programmets byte går in i
programmet:** listningen, källkoden, exporten och Build & Run har de nya byten. **Skriptets egen kod går aldrig in i
dem.** Med `my_table: .byte $01,$02,$03,$04` i källkoden och ett skript som dubblar tabellen står `.byte $02, $04,
$06, $08` i `.asm`-filen efter en körning.

- **Fliken Scripts** ligger bland huvudflikarna mellan Memory och källkoden. Till vänster står projektets skript
  (*Project*, med *New script*), biblioteket (*Library*) och mallarna (*Templates*). I mitten står verktygsraden i
  grupper med streck emellan (skriptets namn och kontrollen · *Safe mode* · *Run* och *Debug* · *Save to library* och
  papperskorgen · *Full screen*), sedan editorn och under den **utdatat, en flikrad som bottenpanelens** (`ScriptOutput.tsx`):
  *Init*, *Watch*, *In the program*, *Scratchpads*, *Last run* och *Problems*. Varje flik har utdatats hela bredd och
  säger på fliken vad den håller (antal rader, ändringar och scratchpads, *set* när Init är satt, en bock eller en
  varning för senaste körningen, antal problem i rött när det är fel); längst till höger i raden står hur senaste
  körningen slutade (ett klick visar *Last run*). I *In the program* och *Scratchpads* står listan till vänster och det
  som valts i den till höger som hex, kod eller text, så det som visas hör till listan bredvid. Gränsen mellan editorn
  och utdata kan dras. Utan skript visar fliken vad ett skript är, *New script* och biblioteket.
  **Fliken får fönstret:** när den öppnas fälls sidopanelen (Explorer, …), inspektorn och bottenpanelen (analysloggen,
  …) in, och när en annan flik öppnas kommer var och en tillbaka som den var, utom en som man själv öppnat eller stängt
  under tiden. Vad de var sparas tills dess, också över en omstart i fliken. **Skriptlistan** (*Project* och *Library*)
  fälls in till en smal remsa med knappen i rubriken; remsan har knappen som fäller ut den, *New script* och ett kort
  namn för varje skript (första bokstaven och siffran det slutar med: `s`, `s2`) som byter skript. Appen minns om den
  är infälld.
  **Full screen** (knappen längst till höger i verktygsraden, ikonen med fyra hörn; Alt+Enter, också i koden; i
  kommandopaletten *Script editor in full screen*; 2026-11-23): skripteditorn får hela fönstret. Titelraden,
  aktivitetsraden, sidopanelen, inspektorn (och deras avdelare), flikraden, bottenpanelen och statusraden döljs
  (`.app.scripts-full`, fönstrets rutnät är bara editorytan) tills man lämnar läget: samma knapp (nu med hörnen inåt,
  *Leave full screen*), Alt+Enter, Esc utanför koden (Esc i koden är editorns, och med en dialog öppen stänger Esc
  den) eller kommandot i paletten. Menyer, dialoger och meddelanden visas ovanpå som vanligt. Det som döljs behåller sin
  storlek och sitt läge, så fönstret kommer tillbaka som det var. Läget gäller medan fönstret är öppet (`full` i
  `store/scripts.ts`, sparas inte över en omstart): en annan flik (*Show listing* i paletten, Shift+klick på en länk)
  visar fönstret som vanligt, och Scripts-fliken är i full screen igen när man kommer tillbaka. Utan skript visas
  fliken som vanligt. F11 (Electrons *View → Toggle Full Screen*) gör fönstret självt till helskärm, oberoende av det
  här.
- **Nytt skript:** *New script* i fliken och i kommandopaletten (med markeringen, när det finns en), eller högerklick i
  listningen → *Program* → *New script from selection / block*, som börjar skriptet med markeringens eller blockets
  rader som listningen skriver dem: så klipper man ut en loop ur programmet. Skriptet heter `script`, `script2`, …,
  har ingen `* =` och ingen scratchpad, och börjar med en kommentar: det körs från första raden till sista RTS, det
  det ändrar i programmets byte går in i programmet och dess `.asm`, koden själv aldrig.
- **Vyn Scripts** i sidopanelen (en egen knapp i aktivitetsraden, ikonen med en skriftrulle, med antalet skript på
  knappen och en snurra medan ett skript körs; den låg tidigare som en sektion i Explorer) listar projektets skript:
  namnet och vad som gäller för skriptet,
  *ready to run*, *4 bytes changed in the program* (vad dess påslagna patchar skrev), *ran: it changed none of the
  program's bytes*, *running…* eller, i rött, det första felet (*Line 1: Unknown symbol "x"*) från kontrollen av koden
  som projektet har den. Varje rad har ▶ (*Run*, grå när skriptet inte går igenom kontrollen eller ett annat körs),
  som kör skriptet precis som *Run* i fliken (`runUserScript` i App: samma worker, samma patchar och samma meddelande),
  och × (*Delete*, som tar dess ändringar ur programmet; `Ctrl+Z` tar tillbaka båda). Ett klick på raden öppnar
  skriptet i fliken Scripts. `+` i rubriken och *New script* gör ett nytt skript och öppnar det där, och under
  *From the library* lägger en knapp per biblioteksskript till en kopia. Rubriken säger hur många skript projektet
  har. Fliken Scripts i editorn har samma ikon; kommandopaletten behåller sin `>_`.
- **Editorn** är Monaco med Kick Assembler-färgningen (också `!`-etiketter, `.for`, `.while`, `.eval`, `.print`,
  `else` och funktionerna), och visar ett namns adress när pekaren står på det. Den föreslår ord som **börjar** med
  det som skrivits och är längre än det (`scriptSuggestions` i `monaco/providers.ts`): först på en rad mnemonics,
  efter en punkt där direktiven, i en operand namnen: **skriptets länkar först**, sedan scratchpadsen, programmets
  etiketter, nollsidevariabler och tabeller, hårdvarunamnen och funktionerna. Ett namn föreslås också när en del av det
  efter ett `_` börjar med det som skrivits, från två bokstäver (`po` hittar `SID_POT_X`, `x` gör det inte), och utan
  något skrivet (`Ctrl+Space`) föreslås alla. Varje förslag säger adressen och vad det är (*$0939 · table*, *linked*,
  *hardware*, *scratchpad*). **Ingenting föreslås efter en instruktions kommatecken** (`,x` och `,y` är
  indexregister) eller i en kommentar. **`Enter` gör alltid en ny rad; `Tab` tar ett förslag.** Det man skriver
  sparas i projektet en halv sekund efter sista tangenten (ett steg att ångra) och kontrolleras direkt. (Förslagsrutan
  var tom tills 2026-11-10: Tailwinds `.contents` och appens `.main` träffade Monacos egna klasser i förslagsraderna,
  så texten fick bredden noll; `contents` genereras inte längre och appens regel gäller bara `main.main`.)
- **Länkar:** högerklick i listningen eller källkoden → *Link … to a script* länkar ett av programmets namn till ett
  skript (eller *New script with …*, ett nytt skript med länken). I listningen är det radens etikett (en
  `.label`-rads variabel, en byte i en datarad, och på en instruktion också namnet operanden använder); i källkoden
  (Monacos meny, *Link to a script…*) namnet under pekaren, annars radens. Skriptet sparar adressen
  (`UserScript.links`) och visar den med namnet koden skriver för den (`linkName`): etiketten, etiketten före i blocket
  och avståndet (`colors_0939+2`), nollsidevariabeln, hårdvaruregistret, annars adressen, så att en omdöpt etikett
  följer med. Länkarna står i en rad (*Links*) ovanför editorn: **ett klick skriver namnet där markören står** (i
  stället för det markerade), `Shift`+klick visar det i listningen och × tar bort länken (koden behåller det den
  skrev). Utan länkar säger raden hur man länkar.
- **Märken i .asm:** listningen och källkoden märker var ett skript hör till programmet: efter etikettraden (en
  `.label`-rad, eller raden som har den länkade byten) står skriptets namn (*⟩_ script*, *+1* när de är fler), både för
  länkar och för de av programmets namn som koden använder (`ScriptCheck.uses`). Verktygstipset säger *Linked to the
  script "x"* och *uses it on line 2*; ett klick öppnar skriptet på den raden. Källkoden öppnas vid listningens
  markör, direkt (utan mjuk rullning).
- **Skriptets eget minne:** skriptets kod och scratchpads är minne för sig. Adresserna namnger bara byten för
  skriptet: programmets kod (en rutin skriptet anropar) ser alltid sina egna byte, också där skriptets kod har sin
  adress, och skriptet läser och skriver programmets byte överallt där det inte självt har byte. Nollsidan och stacken
  delar de. Därför **väljer Mimir adressen** när skriptets första kodrad inte är en `* =`: först minne som programmet
  inte använder (`$c000` när det är ledigt, annars det största lediga området, från `$1000` när det får plats;
  `freePlace`), och när programmet fyller minnet bland programmets byte, där programmet har en och samma byte längst
  (troligen oanvänt), men aldrig där ett av programmets namn som skriptet använder ligger (`scriptPlace`), och **aldrig
  där skriptets instruktioner läser eller skriver programmets minne** (`ScriptCheck.access`: en operand som är en
  adress, ett av programmets namn eller en konstant, inte en av skriptets egna etiketter, `!`-etiketter eller `*`; med
  `,x`/`,y` 255 byte till). Annars kunde en loop som tömmer skärmen (`sta $0400,x`) skriva över sin egen kod när Mimir
  lagt den på skärmen (ett spels skärm full av mellanslag är den längsta följden av en byte): efter tre varv stod `$20`
  (JSR) där loopen börjar (rättat 2026-11-11). En scratchpad som läggs till hamnar inte heller där. En egen `* =` gäller
  som den står. **En pekare som pekar där skriptets egna instruktioner ligger menar programmets minne:** en instruktion
  i skriptet som läser eller skriver genom en pekare (`lda (src),y`, `sta (dst,x)`) på en adress där skriptet har en
  instruktion (inte data: en `.byte`-rad eller en scratchpad är skriptets) når programmets byte där (`ScriptBus`). En
  pekare kan peka vart som helst och sätts när skriptet körs (från mallarnas `.var source`/`dest`), så placeringen kan
  inte undvika den: när programmet fyller minnet kan Mimir lägga koden i just den tomma tabell som dekrypteringen
  fyller, och utan regeln skrev skriptet då över sin egen kod i stället för tabellen.
- **Kontrollen** (`checkScript`) assemblerar koden med den inbyggda assemblern med programmets namn (som listningen
  skriver dem), hårdvarunamnen och scratchpadsen (`pad1` och `pad1_end`) till hands. Ett namn koden själv definierar
  vinner. Mimirs egna namn slutar på sin adress (`colors_0939`, `ptr_fb`): ett sådant namn som programmet inte längre
  har, därför att analysen döpt om byten efter att en körning ändrat dem (`colors_0939` blir `tbl_0939` när tabellen
  inte längre håller färger), hittar ändå sin adress när programmet har ett namn där (`withAddressNames`), så att ett
  skript inte slutar gå att assemblera av det dess egen körning gjorde. Toolbarens bricka säger bara om skriptet kan köras, *Ready to run*, eller vad som är fel, *Line 2: Unknown
  symbol "x"* (*2 errors · …* när de är fler); var koden ligger och varifrån den körs står i verktygstipset. Felen
  står också som markeringar på raderna och i listan *Problems* (ett klick går till raden). Fel är assemblerns, att
  koden saknas, kod eller scratchpad i nollsidan eller stacken (`$0000–$01ff`, som skriptet delar med programmet),
  scratchpads utan giltigt namn, med samma namn, utanför minnet eller över varandra, och **ett av programmets namn som
  skriptet använder där skriptets egen kod eller en scratchpad ligger** (skriptet skulle läsa sig självt där), på
  raden som använder namnet, och **en instruktion som läser eller skriver programmets minne där skriptets egen kod
  eller en scratchpad ligger** (*Line 4: "sta $0400,x" writes $0400-$04ff of the program, but the script's own code is
  at …*); en rad som nämner scratchpaden (`sta pad1,x`) menar scratchpaden. **Run går bara när kontrollen inte har
  något fel.** Tills skriptet har gjort något säger
  en rad under toolbaren vad *Run* gör.
- **Körningen** (`runScript`, i en egen worker; *Stop* avslutar den) sker i Sindris 6510 utan ROM, I/O och avbrott,
  med två minnen: programmets, filerna som LOAD lägger dem (med påslagna patchar; en cartridges filer i banken C64:an
  startar i) **utan det skriptets tidigare körningar ändrade**, så att en körning till ger samma resultat (en XOR-loop
  dekrypterar inte tillbaka), och skriptets eget, med koden och scratchpadsen fyllda med sin `fill`. Vems kod som kör
  följer hoppen: en JSR, JMP eller branch från skriptet till en av dess egna adresser stannar i skriptet, allt annat
  går till programmet, och en RTS går tillbaka till den som gjorde JSR:en. Skriptet anropas som med SYS: stacken har
  en returadress, och körningen börjar vid etiketten `start`, annars vid kodens första byte. Den slutar vid RTS:en som
  återvänder därifrån, vid en BRK, vid en JAM eller efter 200 miljoner instruktioner (omkring 2,5 s; en körning går
  omkring 80 miljoner instruktioner i sekunden). Skriptet kan anropa programmets egna rutiner (`jsr decrypt`) eller
  köra en loop som klistrats in. Körningen är en `ScriptMachine`, som också går en instruktion i taget (felsökaren).
  Den håller reda på när skriptet skriver över sina egna instruktioner (`ScriptRun.overCode`): *Last run* och
  meddelandet säger vilken rad (*It wrote over its own code: line 3 ($c006, 2 times)*), eftersom ändrad kod inte längre
  är koden som skrevs (också kod som ändrar sig själv med avsikt sägs där). Att den inbyggda assemblern skriver samma
  byte som KickAss.jar prövas också med skript som användare skrivit (`kickass.integration.test.ts`).
  Stacken (`$0100–$01ff`) är densamma för skriptet och programmet: körningen börjar med SYS-returen på `$01fe–$01ff`
  och S = `$fd`, och vid varje JSR antecknas vem som gjorde den (med stackpekaren som nyckel), så att ett RTS går
  tillbaka till skriptets eller programmets kod.
- **Init** (utdatats första flik, `UserScript.init`, `ScriptInit`) är det körningen börjar med utöver programmets minne,
  i tre grupper bredvid varandra (*Registers*, *Flags*, *Zero page*) under en rad som säger vad Init är och har *Reset*:
  **A, X och Y** (fält med `$aa`, `170`, `%1010` eller `<etikett` / `>etikett`, låga och höga byten av en adress; mer
  än en byte tas inte), **flaggorna** N V D I Z C (ett klick sätter eller nollar en; *P=$25* säger statusregistret)
  och **byte i nollsidan** (*Add* i gruppen *Zero page*: adress, värde och storlek *byte* eller *word*, ett word med låga byten
  först, en pekare). Adressen visas med programmets namn för den (`ptr_fb`) och kan skrivas som namn; värdet kan vara
  ett namn (en etiketts adress), och ett värde över `$ff` gör raden till ett word (ett word kan inte börja på `$ff`).
  Utan init börjar körningen med A, X och Y 0 och bara I satt (`SCRIPT_P` = `$24`), som förut. Nollsidan är
  programmets: det som sätts där finns också för programmets kod som skriptet anropar, det ligger där innan körningen
  börjar (det räknas inte som en ändring av körningen) och går som allt i nollsidan aldrig in i programmet. Felsökaren
  börjar med samma register. `checkScript` säger fel (ett register som inte är en byte, en rad utanför nollsidan, ett
  för stort värde) och varnar för en byte som sätts två gånger (den senare gäller). Bara det som skiljer sig från en
  körning utan init sparas (`tidyInit`), med skriptet i projektet och i biblioteket; *Reset* tar bort allt.
- **Felsökaren:** *Debug* (eller `F8`) startar körningen och stannar före första instruktionen. Verktygsraden har då
  *Continue* (`Ctrl+Enter`: vidare till slutet eller nästa brytpunkt), *Step* (`F8`: en instruktion, in i en JSR),
  *Over* (`F6`: en JSR körs tills den återvänder), *Out* (`Shift+F6`: tills rutinen den är i återvänder; överst till
  slutet) och *Stop* (`F10` och `F11` tar Windows meny och helskärmen). Medan något körs i flera delar (Continue,
  Over, Out) står *Pause* där. Editorn markerar raden som körs härnäst (en pil i marginalen och ett band), och när
  programmets kod kör den rad vars JSR den kör för. En brytpunkt sätts och tas bort med ett klick till vänster om
  radnumret (en röd prick); brytpunkterna följer raderna när koden ändras och finns kvar när fliken öppnas igen.
  **Har felsökaren stannat på en brytpunkt** är raden tydligt märkt: ett rött band med en röd kant till vänster och
  överst och nederst, den röda pricken med pilen i marginalen, en röd markering i rullningslisten, och panelen säger
  *Stopped at the breakpoint on line 5* under var körningen är.
  Koden kan inte ändras medan man felsöker (en rad under verktygsraden säger det). Panelen till höger om koden
  visar var körningen är (*Line 11 ($c011)*, eller *In the program at decrypt ($0810), called from line 3*),
  antalet instruktioner och cykler, registren PC, A, X, Y (hex, decimalt och binärt), S (och vilka byte stacken
  håller) och P med flaggorna N V - B D I Z C (de som är satta lysta); det senaste steget ändrade är markerade. Under
  dem står stacken från `$01ff` ned till S: en returadress står som *↩ return to line 4 ($c008), from the script*
  (eller *from the program*, eller *the end of the run* för SYS-returen), och raden överst har *← S*. Sist står de
  fyra nästa instruktionerna (med skriptets egna etiketter i dess kod och programmets namn annars). När körningen når
  slutet är den en körning som Run (dess ändringar går in i programmet); *Stop* skriver ingenting. Medan man
  felsöker är utdataytan lägre (egen höjd, kan dras), och **scratchpaden som visas är körningens som den är nu**
  (*now, as the run has it*): den följer varje steg, och i hex är de byte det senaste steget ändrade markerade.
  Panelen har också **watch-listan** (se nedan) mellan registren och stacken.
- **Watch** (utdatats flik efter Init, `script-watch.ts`; en tabell med rubriker *Name*, *Address*, *Value*, *Bytes*
  och *Written on*, raden som skriver adressen eller *added*; ett klick på raden går dit): minnet skriptet kan ändra, som listan **hittar själv i koden**
  (`scriptWatches`, ur de assemblerade byten och raderna, medan man skriver): varje instruktion som skriver en adress
  (STA, STX, STY, SAX och de som läser-ändrar-skriver: INC, DEC, ASL, LSR, ROL, ROR och de odokumenterade) ger byten den
  skriver, en indexerad (`sta $0400,x`) intervallet den når (256 byte, i nollsidan runt nollsidan) och en som skriver genom
  en pekare i nollsidan (`sta (dest),y`) pekaren, ett word, med byten den pekar på. En pekare koden bara läser genom
  (`lda (src),y`) kommer med när koden flyttar den (`inc src+1`). Samma operand är en rad (raderna som skriver den
  sparas); en pekare tar in skrivningarna av sina två byte, `namn` och `namn+1` blir ett word, och en byte som också
  skrivs med index ligger i sitt intervall. En operand som skriver flera adresser (en rad i en `.for`) får en rad per
  adress, med adressen som namn. Det programmets rutiner som skriptet anropar skriver kan inte ses i koden. Raderna har
  operanden som koden skriver den (`colors_0939`, `$d020`, `counter`), adressen (`$0939,x`, `($fb),y`) och värdet;
  ett klick på namnet går till raden som skriver det, och ett klick på adressen visar programmets minne i listningen.
  Verktygstipset säger raderna, vad det är (ett intervall, ett word, en pekare) och vems minne: programmets,
  nollsidan, skriptets eget (dess kod och data: `counter: .byte 0`) eller en scratchpad. Värdena läses som skriptets
  kod ser dem (eget minne där dess kod, data och scratchpads är): **innan skriptet körts** som en körning börjar
  (*at the start*: programmet utan skriptets tidigare ändringar, init, scratchpadsens start, `scriptStartMemory`),
  **efter en körning** som den lämnade dem (*after the last run*, `ScriptRun.own` är skriptets eget minne efteråt):
  det som ändrats står som *$00→$02*, och ett intervall säger *2 changed* med en rad om 8 byte där den första ändringen
  är (ändrade byte markerade, vad de var i verktygstipset), och **medan man felsöker** som körningen har dem nu (*now*),
  med det senaste steget ändrade markerat; ett intervalls rad följer indexregistret (byten instruktionen skriver nästa
  står i den) och en pekares byte är där den pekar nu. *Code changed since* står när koden ändrats efter körningen.
  **Egna rader** läggs till under listan: en adress eller ett namn (`$c000`, `49152`, en etikett, en variabel, en
  scratchpad, skriptets egna etiketter, `namn+2`; ett av Mimirs namn som analysen sedan döpt om, `colors_0939`, hittar
  sin adress som i koden) som *byte*, *word*, *pointer* eller *8*–*256 bytes*, och Enter eller *Watch* tar det (en rad
  som redan finns sägs). De läses om med namnen som de är nu, och en som inte längre hittar sin adress sägs i rött.
  × tar bort en egen rad; en rad som hittats i koden tas bort ur listan (koden skriver den fortfarande) och
  *N taken off · put back* tar tillbaka dem. Egna rader (`UserScript.watch`) och det som tagits bort (`UserScript.unwatch`,
  med operanden som nyckel) sparas med skriptet i projektet och i biblioteket.
- **Resultatet** (`writeScriptRun`): de byte i programmets minne som körningen ändrade, utom nollsidan och stacken
  (processorns arbetsminne), skrivs in i programmet som skriptets patchar (10.2, `Patch.script` säger vilket skript),
  en per ändring (ändringar högst 8 byte isär och i samma fil blir en), med namnet `skript` eller `skript_xxxx` när de
  är flera och byten som `.byte`-rader. De ersätter skriptets tidigare patchar. Listningen märker dem *script namn*,
  källkoden `// ==== changed by the script "namn": $0939-$093c, 4 bytes ====` och Explorer → Patches *· script*. Allt
  i en körning är ett steg att ångra (*Run script "x"*), också vad scratchpadsen håller.
- **In the program** (en flik) listar skriptets ändringar till vänster med var sin på/av-knapp, och den valda visas
  till höger (först den första; efter en körning den första den gjorde). En ändring som
  stängs av lämnas utanför programmet och förblir avstängd när skriptet körs igen (så länge den har samma intervall).
  *Take out* tar alla ut (originalbyten kommer tillbaka) och skriptet står kvar; tas skriptet bort följer dess
  ändringar med ut. En ändring som inte kan bli en patch (i en av användarens patchar, över kanten på ett relokerat
  block) skrivs inte in, och *Last run* säger varför. Står koden inte längre som när den kördes säger rubriken *code
  changed since*.
- **Safe mode** (knappen *Safe mode* med en sköld i verktygsraden, `UserScript.safe`; av som förval, sparas med
  skriptet i projektet och i biblioteket): skriptets körningar skriver **ingenting** in i programmet, så listningen,
  `.asm`-filen, exporten och Build & Run förblir som de är. Körningen går som annars (från programmet utan skriptets
  tidigare ändringar), och det den skulle skriva räknas ut som *Run* skulle skriva det (`writeScriptRun`, utan att
  projektet ändras) och listas under *Would change* i fliken *In the program*, som också räknar dem med en sköld (ett
  klick visar byten med *would change: not in the program*).
  *Write into the program* kör skriptet en gång till och skriver det den ändrar in i programmet (ett steg att ångra);
  safe mode förblir på. Scratchpadsen, skriptets eget minne, får vad körningen lämnade i dem (utan scratchpads ändras
  projektet inte alls), och felsökaren som når slutet följer samma regel. Det skriptets körningar skrev innan safe mode
  slogs på ligger kvar (*Take out* tar ut det, och *In the program* säger det). Listan i fliken och vyn Scripts
  visar en sköld, och raden säger *safe mode: 4 bytes would change*.
- **Last run** (en flik) säger hur körningen slutade (*Returned (RTS at $c008) after N instructions, M cycles*),
  registren, tiden, om den gick i safe mode och om koden ändrats sedan, och under det vad som inte kunde skrivas, om
  den skrev över sin egen kod och hur många byte som ändrades utanför programmets byte eller i nollsidan och stacken
  (de sparas inte). **Problems** (sista fliken) listar kontrollens fel och varningar (ett klick på *Line N* går dit),
  annars *No problems*, och under det var koden placerades (*Its code: 9 bytes at $c000-$c008, …*) och `.print`.
- **Scratchpads** (en flik) används bara när man vill ha data utanför programmet, till exempel en logg: *Add* lägger
  till en (efter den sista, placerad som koden; den är skriptets eget minne). Listan till vänster är en tabell: namn,
  adress, storlek och fill (`$100` eller `256`), redigerade på plats (fälten syns som fält på raden under pekaren och
  den valda); ett klick på en rad visar den till höger, och en prick står på dem som senaste körningen ändrade (där
  körningens byte inte är vad en körning börjar den med). Flyttas eller ändras storleken på en glöms vad den höll. Vad en körning lämnar i dem
  sparas med skriptet.
- **En store till en scratchpad med ett klick** (`script-padstore.ts`, 2026-11-14): på en rad som `sta $ff40,x` visar
  editorn en glödlampa (klick eller `Ctrl+.`) med *Also write into pad1: sta pad1,x* för var och en av skriptets
  scratchpads och *Also write into a new scratchpad: sta pad2,x*, och högerklick ger *Also write into a scratchpad…* med
  samma val i appens meny (scratchpads som redan får den bockade: *line 6 does*; ett sådant val säger det och skriver
  inget). Valet sätter in raden `sta pad1,x` efter store-raden (efter de kopior som redan står där), lika långt indragen
  som instruktionen (en etikett före den blir mellanslag), med mnemonic och indexregister skrivna som där; en ny
  scratchpad (256 byte) placeras som *Add* gör. Raden och den nya scratchpaden är ett steg i projektet (*Ctrl+Z* i
  editorn tar raden), och fliken Scratchpads visar den. Byte `i` i scratchpaden är då vad storen skriver på `$ff40+i`.
  Det gäller STA, STX, STY och SAX med en adress, `,x` eller `,y` där instruktionen har den formen för en 16-bitarsadress
  (scratchpads ligger aldrig i nollsidan); för `stx $40,y`, `sty $40,x`, en store genom en pekare (`sta ($fb),y`), en
  instruktion som ändrar byten där den är (`inc`) och de instabila (`shx`) säger ett meddelande varför, och en rad som
  inte skriver minne har inget val. Inte medan skriptet felsöks.
- **Visningen:** en ändring eller en scratchpad (klick på raden) visas som *Hex* (16 byte en rad, 8 när det är smalt),
  *Code* (disassemblerad vid sin adress, med programmets namn) eller *Text* (32 tecken en rad), texten som PETSCII
  eller skärmkoder. En ändring säger hur många byte som skiljer sig från originalet (originalet i verktygstipset) och
  har *Show in listing*. Byten kopieras som `.byte`-rader. En scratchpad sparas som `.bin`, `.prg` (med adressen som
  laddadress) eller **som loggfil**, *Save .txt…*: i Text-läget tecknen utan adresser, utan fyllnaden efter det sista
  som skrevs, PETSCII med en rad per RETURN (`$0d`) eller skärmkoder 40 tecken en rad; i de andra lägena det som
  visas.
- **Utdatat fälls ner** med pilen längst till höger i flikraden (*Output*): flikraden står kvar och koden får resten
  av höjden; ett klick på pilen eller en flik fäller upp det med samma höjd som förut. Nedfälld säger flikarna
  fortfarande vad de håller, och raden hur många fel koden har. Bottenpanelen (*Analysis log*, …) kan inte dras över
  koden eller utdatat: editorytan vill ha verktygsraden, raderna under den, 140 px kod, utdatats flikrad och utdatat
  med höjden det drogs till, så bottenpanelen stannar ovanför utdatat och ger vika (ner till sin flikrad); den får
  tillbaka höjden den hade i en annan flik. Utdatats kant dras upp bara så långt koden har mer än 140 px. Först när
  fönstret är så lågt att bottenpanelen redan är nere på sin flikrad ger utdatat vika, ner till 110 px (en scratchpads
  rubrik och knappar med två rader emellan); koden behåller 140 px. Utdatats flikar ritar aldrig utanför det
  (knapparna hamnade förut ovanpå bottenpanelen när det tryckts ihop), och det som ändå inte får plats skärs av vid
  editorytans fot. En dragkant dras vidare från höjden panelen har, inte den som sparats.
- **Vad en scratchpad börjar med** (`ScriptPad.data`, och `ScriptPad.src` för hur det skrevs): utan det börjar
  scratchpaden med sin fill, med det börjar den med de byten från sin första byte och fill efter dem. *Edit start* i
  visningen öppnar en editor med tre former: **Kick Assembler** (assembleras vid scratchpadens adress med programmets
  namn: `.byte`, `.word`, `.text`, `.fill`, instruktioner, egna etiketter), **Hex** (`01 02 ff`, `$01,$02`, `0102ff`; en
  rad som börjar med en adress, som en hexdump, lägger sina byte där och dess textkolumn räknas inte) och **Text**
  (PETSCII med radslut som RETURN, eller skärmkoder med radslut som mellanslag till nästa rad om 40). Det skrivna läses
  medan man skriver (*6 of 64 bytes from $3800, the rest $00*, eller felet och dess rad) och *Set* (`Ctrl+Enter`)
  sparar; en annan form gör om det skrivna till den. *Clear* tar bort det. Ändras startinnehållet glöms det senaste
  körningen lämnade i scratchpaden, och visningen visar vad en körning börjar med (*at the start · 6 set*) tills den
  körs igen. Flyttas scratchpaden assembleras Kick Assembler-innehåll om på den nya adressen. `padData` läser formerna
  och `padText` skriver byte i dem; sparas i projektet (base64) och i biblioteket. `checkScript` varnar när
  startinnehållet är längre än scratchpaden.
- **Från .asm till en scratchpad:** högerklick i listningen (markeringen, ett blockhuvud: hela blocket, annars raden)
  eller i källkoden (Monacos meny, *Copy into a scratchpad…*: de markerade raderna, annars raden) → *Copy N bytes into a
  scratchpad* → en av skriptens scratchpads (*pad1 of "script"*, skärs till dess storlek), *A new scratchpad in
  "script"* (lika stor som byten, placerad som *Add*) eller *A new script with a scratchpad*. Byten blir scratchpadens
  startinnehåll och fliken Scripts visar den.
- **Ett block till en scratchpad, skrivet som sin typ** (`blockPad`): högerklick på en rad i ett block i listningen
  eller källkoden → *Copy block colors_0939 into a scratchpad (as hex)*, eller i fliken Scripts *Scratchpads → From a
  block…*, där man väljer blocket (*Block*, blocket vid listningens markör först) och scratchpaden (*Into*: en ny, eller
  en av skriptets). Startinnehållet skrivs som blockets typ: **kod** som Kick Assembler som listningen skriver den, med
  programmets namn (blockets egna etikettrader som kommentarer, `// loop_08bc:`, och en branch som `bne *-12  //
  loop_08bc`, så att byten blir desamma på scratchpadens adress), **text** som text i sin kodning (annars som listningen
  skriver den, med `.encoding` och `PET_RETURN` definierat), **tecken** som `.byte`-rader om 8 (ett tecken, `// char
  $00` före), **sprites** om 3 (en rad, 21 och den 64:e byten, `// sprite 0`), **bitmap** om 8 (en cell, `// row 0`
  var 40:e), **skärm** om 40 (en rad), och **annan data som hex**. Varje form prövas: den måste ge blockets byte exakt
  på scratchpadens adress. En rad som inte gör det (ett namn som skriptet inte har) skrivs som sina byte (`.byte $20,
  $00, $10  // was jsr …`), och går inget annat blir det hex. En ny scratchpad blir lika
  stor som blocket; en befintlig växer till blockets storlek när inget av skriptets ligger efter den, annars får den
  blockets första byte som hex.
- **Blockens slut som namn:** varje block vars start har en etikett ger skriptet också `etikett_end`, adressen efter
  blocket (`colors_0939_end` = `$0949`), som en scratchpads `pad1_end` (`blockEndNames`). Editorn föreslår dem (*$0949 ·
  end of the table (the address after it)*), och en loop kan gå till `cpx #colors_0939_end-colors_0939`. Har programmet
  redan ett namn som heter så gäller programmets, och slutnamnet läggs inte till. Ett skript som använder ett slutnamn
  märks i .asm på blockets etikettrad.
- **Musiken som LoadSid ger den:** när .asm-filen laddar musiken med `.var music = LoadSid(…)` skriver listningen
  adresser i den som `music.location+$1ae1`, `music.init` och `music.play`. Skriptet har samma namn (`musicNames`):
  `music.location` (där den ligger), `.init`, `.play` och `.size` (dess längd i byte), under `.var`:ens namn (`music`,
  eller `music_1000` när programmet har fler än en musik), så att en rad kopierad från listningen assembleras som den
  står och ett block med `jsr music.play` kopieras till en scratchpad som kod. Namnen finns oavsett inställningen, så att
  ett skript skrivet med den på assembleras med den av. `music.size` är ett tal, ingen adress: det räknas inte som
  programmets minne som skriptet använder, debuggern och bevakningslistan skriver ingen adress med det. Editorn föreslår
  resten efter `music.` (*.location*, *.init*, …) och visar namnet helt när muspekaren är över det (*music: its play
  routine*).
- **Scratchpad till scratchpad:** *Copy to…* i visningen kopierar byten som visas (det körningen lämnade, annars
  startinnehållet) till en annan av skriptets scratchpads som dess startinnehåll, eller till en ny (*A new scratchpad
  (a copy)*, samma storlek och fill). Har skriptet ingen annan heter knappen *Copy to a new pad* och gör kopian direkt.
  Så sparas ett resultat inför nästa körning: en körning som inte skriver i kopian lämnar den som den var.
- **Compare** (ett fjärde visningsläge för scratchpads) jämför scratchpaden byte för byte med en annan (*with pad2*)
  eller med vad en körning börjar den med (*with its start*: vad körningen ändrade i den). Överst siffrorna (*2 of 64
  bytes differ (3.1 %) in 2 places, the first at +$0001 ($3801)*), sedan en **värmekarta** med en cell per byte, 16 till
  256 i bredd så att cellerna blir så stora som ytan tillåter (2–18 px, annars 1–2 px och rullning; `heatLayout`):
  lika byte är gråa, olika röda, starkare ju fler bitar som skiljer, och byte bara den ena har är blå. Pekaren på en
  cell visar adressen, båda värdena och hur många bitar som skiljer; ett klick går till cellens rad. Bredvid kartan
  (under den när visningen är smal) står raderna om 16 byte där något skiljer, båda scratchpadsens byte under varandra
  med de olika markerade, högst 300 åt gången runt raden som klickats.
- **Filer in och ut** (`script-files.ts`, `ScriptFiles.tsx`, 2026-11-22): ett skript arbetar också på filer från den
  monterade disken eller bandet, så att spelets egen uppackare eller en dekryptering körs på en nivåfil och det den
  ger blir en fil igen.
  - **En fil in i en scratchpad:** *From a file…* (bredvid *From a block…*) listar diskens directory (en PRG utan sin
    laddadress, en annan fil som den är), det diskens loader laddar (som loaderns flik öppnar dem: uppackade, på sin
    adress) och bandets filer, och lägger den valda i en ny scratchpad, lika stor som filen, eller i en av skriptets
    (som blir så stor som filen när inget av skriptets ligger i vägen, annars får den filens första byte). Filens byte
    är det en körning börjar scratchpaden med (`ScriptPad.data`), och filens laddadress sparas (`ScriptPad.load`).
  - **Användning** (kolumnen *Use* i scratchpadlistan, `ScriptPad.role`): *File* är scratchpaden som tar filen när
    skriptet körs på filer (en i varje skript; den första som fylls med *From a file…* får den), *Result* en vars
    innehåll efter körningen är resultatet. I koden finns `pad_load` för en *File*-scratchpad: filens laddadress (0
    utan). **En scratchpad med en användning ser programmets kod också** (`mine` = 2 i `ScriptMachine`): en
    rutin i programmet som skriptet anropar läser filen där och skriver sitt resultat där. Övriga scratchpads ser
    bara skriptets egen kod, som förut.
  - **Run on files…** (under scratchpadlistan, och högerklick på en fil i Explorerns disk- eller bandlista: *Run a
    script on "…"*) öppnar en dialog med filerna, en ruta var, grupperade efter var de kommer ifrån (*All*, *None*,
    en ruta för hela gruppen), och vad som händer med resultaten: *Open them as a new project*, *Add them to this
    project* eller *Save them to a folder…*. För varje fil (`fileRunPlan`) blir *File*-scratchpaden så stor som
    filen (`pad_end` är adressen efter den) och står kvar där den är när filen får plats, annars placeras den om;
    skriptet körs i skriptens worker på programmet utan skriptets tidigare ändringar. **Ingenting går in i
    programmet.** Resultatet (`fileRunResults`) är, i den här ordningen: varje *Result*-scratchpad körningen skrev
    i, från dess början till efter sista skrivna byte, som en fil på scratchpadens adress; annars
    *File*-scratchpaden när körningen skrev i den (arbete på plats), hela, på filens laddadress; annars den längsta
    sträckan av programmets minne som körningen skrev (en uppackares utdata), på sin adress. Vad körningen skrev
    spåras per byte (`ScriptRun.wrote`, `pads[].wrote`), så nollor som skrivs över nollor räknas. Filerna heter
    efter filen och skriptet (`level1_decrypt.prg`). En körning som jammar eller når gränsen, eller inte skriver
    något, ger ingen fil och sägs i meddelandet efteråt; *Stop* avbryter och då öppnas eller sparas ingenting.
  - **En scratchpad till projektet:** *To the project…* i visningen lägger byten som visas som en fil i projektet
    (*Add it to this project*) eller öppnar dem som ett nytt projekt, på scratchpadens adress (för en
    *File*-scratchpad filens laddadress). *Save .bin…* och *Save .prg…* finns kvar.
  - Inte med än: en fil från datorn (bara disk och band), loaderfiler som de ligger packade på disken, och
    högerklick i loaderflikarna och i Explorerns C64-utseende.
- **Skript som analysen föreslår** (`script-suggest.ts`, 2026-11-22): programmets egen kod säger vad ett skript
  kan göra, så att man inte börjar från en tom editor.
  - **Dekrypteringsloopar** (`findCryptLoops`, statiskt ur koden som analysen har den, ingenting körs): en bakåtgren
    vars kropp är en läsning med index (`lda a,x`, `lda a,y`, `lda (zp),y`), en till fyra ändringar med en nyckel
    (`eor #k`, `clc`/`adc #k`, `sec`/`sbc #k`), en skrivning med samma index, och indexet stegat en gång (och jämfört
    med `cpx`/`cpy #n`); inget annat får stå i loopen. Loopen ger metoden och nyckeln, och när operanderna är adresser
    och indexet laddas med ett tal precis före loopen också var byten ligger, vart de skrivs och hur många
    (`visited` går indexet som loopen gör: `dex`/`bpl` från 39 är 40 byte, `inx`/`bne` från 0 är 256). Genom en
    pekare vet loopen inte var. Bort faller text som skrivs till skärmen eller I/O-området från en annan adress
    (skärmkoder som skiftas), loopar under 8 byte och en ren kopiering. På 141 diskprogram ur arkivet (första PRG
    per disk) gav den en träff, och den var tveksam: få falsklarm, men också få träffar, eftersom looparna oftast
    ligger bakom en packare eller i en bandladdare som inte är i projektet förrän filen är uppackad.
  - **Skriptet för en loop** (`cryptScript`): mallen som gör samma sak (en EOR: *XOR key byte*; en ADC eller SBC:
    *Add/subtract*; flera: *Several steps*) med nyckeln eller stegen satta och, när loopen säger dem, `source` (med
    programmets namn för adressen) och `length`; `dest` förblir scratchpaden `result`, som görs så stor som byten,
    så att **programmet lämnas som det är**. En kommentar före inställningarna säger var loopen är och vad den gör,
    och editorn visar den raden. Skriptet heter `decrypt_081a` och är länkat till loopen. Det nås från **översikten**
    (kortet *Decryption loops*: adressen, metoden, antalet byte, knappen *Script*), från **högerklick på en rad i
    loopen** (*Script for this loop: EOR #$5a over 32 bytes, into a scratchpad*) och från **Scripts-flikens lista**
    (*In the program*, ovanför *Templates*).
  - **En rutin anropad som programmet anropar den** (`callScript`): högerklick på en rad som programmet anropar med
    JSR ger *New script that calls … as the program does*: ett skript med en enda `jsr`, och A, X och Y som
    programmets första anrop laddar dem med tal precis före sin JSR (`lda #3` / `ldx #$20` / `jsr show`) som skriptets
    Init. Det skapas i safe mode: en körning visar vad rutinen skulle ändra, och ingenting går in i programmet.
- **Hela C64:an** (`script-machine.ts`, `UserScript.machine` = `'c64'`, 2026-11-22): under *Init* väljer *Runs in* mellan
  *Memory only* (som förut: en kopia av programmets minne och inget annat, skriptets kod och scratchpads minne för sig)
  och *The whole C64*: Sindris maskin som den står vid READY (`readyC64`), med KERNAL och BASIC, VIC, CIA:erna och
  deras avbrott, och en 1541 med den monterade disken på seriebussen (`driveWith`). Skriptet kan då anropa kod som
  behöver maskinen: KERNAL:s LOAD, spelets egen loader med sin drivkod, en rutin som väntar på en timer eller en
  rasterrad.
  - Programmets filer läggs i C64:ans RAM på sina laddadresser, och **skriptets kod och scratchpads också**: här finns
    ett enda minne, så programmets kod ser dem, och skriptets kod får inte ligga där det den laddar hamnar (sätt
    `* =` överst; utan det hamnar koden i ledigt minne, ofta `$c000`). Körningen börjar vid skriptets start, anropad
    som SYS, med `$01` som vid READY och registren och flaggorna från Init (avbrott av tills Init eller koden slår på
    dem). Den slutar när skriptet återvänder, vid en BRK eller JAM, vid stoppadressen eller efter 600 miljoner
    cykler (tio minuter C64-tid).
  - Resultatet är en `ScriptRun` som den vanliga maskinens: programmets byte som ändrats (inte skriptets egna) blir
    patchar som förut (eller visas, i safe mode), scratchpadsen får vad körningen lämnade, och `wrote` är varje
    sträcka minne körningen skrev (`C64.wtime`).
  - Den behöver VICE:s ROM-filer (`kr.c64Roms()`, och 1541:ans DOS-ROM för disken); utan dem sägs det och inget
    körs. Körningen går i skriptens worker; *Stop* avbryter. *Debug* finns bara för *Memory only* (knappen är av).
    *Run on files…* kör också i hela C64:an när skriptet gör det.
- **Stop at** (`UserScript.stopAt`, under *Init*; `scriptStopAt`): en adress där körningen slutar, innan
  instruktionen där körs, för kod som aldrig återvänder (en loader som hoppar in i det den laddat). Ett tal
  (`$c000`) eller ett namn från programmet eller skriptet, med `+n`; det som inte är en adress sägs under fältet.
  Gäller båda maskinerna; körningen slutar då som *Stopped at $…, the address it stops at* och räknas som en körning
  som gick väl (`endedWell`).
- **Memory it wrote** (under *Last run*): de längsta sträckorna minne körningen skrev, som den lämnade dem (det en
  loader laddade, det en uppackare packade upp), var och en med *To the project…* (en fil i projektet eller ett nytt
  projekt, på sin adress) och *To a scratchpad*.
- **Skript som säger mer än bytes** (`script-actions.ts`, 2026-11-22): Mimirs egna direktiv i skriptets kod, som
  assemblern aldrig ser och som görs när en körning slutar, med byten den ändrade och i samma ångra-steg:
  - `.mark start, end, "typ"`: byten från start fram till (inte med) end är av den typen, som *Mark as* gör dem:
    `code`, `bytes` (eller `data`), `words`, `text`, `textsc`, `textmix`, `textscmix`, `table`, `sprite`, `charset`,
    `bitmap`, `screen`, `music`, `fill`. Blocken märket skär behåller sin typ bredvid (`keepCutTypes`).
  - `.name adress, "namn"`: adressen får den etiketten.
  - `.note adress, "text"`: raden på adressen får den kommentaren.
  - `.junk start, end`: byten är junk (11.7).
  - En adress är ett tal (`$c000`, `49152`, `%1010`) eller ett namn koden har (en etikett i programmet, en
    scratchpad, skriptets egna etiketter, `.var` och `.const`), adderat och subtraherat: `dest + length`,
    `tbl_001_end - 2`. Ett skript som dekrypterar ett block säger så vad det är:
    `.mark dest, dest + length, "text"`. Direktiven är desamma i Kick Assembler och 64tass och följer med när ett
    skript flyttas dit. (Inte `.label` och `.comment`: de finns redan i Kick Assembler respektive 64tass.)
  - `checkScript` tar ut raderna innan assemblern får koden (`scriptDirectives`: raden blir tom, så övriga rader
    behåller sitt nummer) och läser dem när namnen fått sina värden (`scriptActions`; Kick Assemblers `.var` på
    toppnivå lämnas ut i `AssembleResult.vars`). Det som är fel är ett fel på sin rad, och skriptet kör inte: ett
    argument som saknas, ett okänt namn, en adress utanför minnet, ett slut som inte ligger efter starten, en typ som
    inte finns, ett namn som inte är en etikett. Editorn föreslår direktiven efter en punkt.
  - När körningen slutar (`planScriptActions` med analysen som den är då) görs de i projektet. Det som inte går sägs
    under *Last run* med sin rad: ett märke eller en kommentar där ingen fil har byte, ett märke över ett flyttat
    block eller över två filer, ett namn en annan adress har, junk som junkreglerna vägrar. *Last run* listar under
    *Marked up* vad som gjordes; meddelandet efter körningen säger hur många. **I safe mode görs ingenting**: listan
    heter *Would mark up*, och *Write into the program* gör dem. De hör inte till skriptets patchar: *Take out* och en
    ny körning tar inte bort dem (Ctrl+Z gör det). *Run on files…* gör dem inte.
- **Skript i JavaScript** (`script-js.ts`, `UserScript.code` = `'js'`, 2026-11-22; Python kan komma senare på samma
  sätt): samma uppgift som ett skript i assembler (arbeta på programmets byte, och det som ändras blir skriptets
  patchar), skrivet i ett språk med loopar, arrayer och strängar, som lånar programmets egna 6510-rutiner när det
  behövs. *JS*-knappen bredvid `+` i skriptlistan (och *JavaScript* i den tomma vyn) gör ett; `lang` är då bara
  språket scratchpadsens startinnehåll skrivs i.
  - Skriptet är kroppen i en funktion som körs en gång. Det har **ett minne**, `mem`: 64 KB med programmets filer på
    sina laddadresser och skriptets scratchpads på sina adresser (en scratchpad är en sträcka av `mem`, så programmets
    kod ser den). Det får, och inget annat: `mem`; `addr("namn")` (en etikett, en variabel, ett hårdvarunamn, en
    scratchpad: `pad1`, `pad1_end`, `pad1_load`); `pad("pad1")` (en vy av `mem`); `word(a)` och `setWord(a, v)`;
    `cpu.call(var, { a, x, y, c })`, som kör programmets 6510-kod tills den återvänder (RTS eller BRK) och ger
    `{ a, x, y, p, c, z, n, brk }` (den kastar ett fel om koden jammar eller inte återvänder inom `cpu.limit`
    instruktioner, 50 miljoner); `print(...)`; `hex(v, siffror)`; `mark`, `name`, `note` och `junk` (som direktiven,
    gjorda när körningen slutar); och `disk`, den monterade disken eller `null`: `disk.name`, `disk.files`,
    `disk.read("NAMN")`, `disk.sector(spår, sektor)`.
  - Det körs i skriptens worker (`runJs`, med `new Function`; appens CSP gäller inte där, och fönstret kör aldrig
    koden). Namnen som når ut ur workern (`fetch`, `importScripts`, `self`, `globalThis`, `setTimeout`, `Function` …)
    är `undefined` i skriptets kod, och workern tar bort nätverks- och lagringsfunktionerna ur sig själv innan det
    första JavaScript-skriptet körs (`closeWorker`). Det är ett skydd mot misstag, inte en säkerhetsgräns mot illvillig
    kod: kör inte skript du inte litar på.
  - Innan det körs kontrolleras bara scratchpadsen (`checkJs`); ett syntaxfel sägs av körningen. Ett fel det kastar
    avslutar körningen (`ScriptEnd` `'error'`, `ScriptRun.error` med raden ur stacken): *Stopped with an error on line
    2: …*, och det som ändrats dittills är ändå resultatet. *Last run* visar det som skrevs med `print` och en länk
    till felets rad.
  - Det som inte finns för JavaScript: *Debug* (knappen är av), Init:s register och flaggor (`cpu.call` tar dem),
    *Runs in* och *Stop at* (det kör alltid i minnet), watch-listans egna fynd, och editorns glödlampa för scratchpads.
    Editorn färgar koden som JavaScript och föreslår det skriptet får (`JS_API`) och programmets namn inom citattecknen
    i `addr("…")`, `cpu.call("…")` med flera (`jsSuggestions`). *Run on files…*, safe mode, biblioteket och *Memory it
    wrote* fungerar som för andra skript. En evig loop i JavaScript stoppas med *Stop* (workern avslutas).
- **Inställningar och körning med värden** (`script-params.ts`, 2026-11-22): värdena överst i koden som en körning
  handlar om (var byten ligger, hur många, nyckeln) läses ur koden och visas som fält, och skriptet kan köras en gång
  för varje rad i en tabell av dem.
  - **En inställning** är en rad som ger ett namn ett enda värde: `.var key = $77 // the key byte` i Kick Assembler,
    `key = $77 ; …` i 64tass, `const key = 0x77; // …` vid vänsterkanten i JavaScript (`scriptParams`). Värdet är ett
    ord: ett tal, ett namn (`result`, `tbl_001`, `SUB`, `true`) eller en sträng. En rad vars värde räknas fram
    (`dest + length`) är ingen inställning. Kommentaren på raden säger vad den är.
  - **Fliken *Settings*** (först i utdatats flikrad, bara när skriptet har inställningar): en rad per inställning med
    namnet (ett klick visar raden i koden), värdet i ett fält och kommentaren. Enter eller att lämna fältet skriver
    värdet på raden i koden (`setScriptParams`: kommentaren står kvar i sin kolumn), som ett ångra-steg; det som inte
    är ett enda värde vägras med ett meddelande.
  - ***Run with values…*** (i *Settings*) öppnar en dialog med en tabell som text: första raden namnger
    inställningarna, varje rad efter den är en körning med de värdena, åtskilda med komma, tabb eller semikolon (en
    tabell ur ett kalkylblad går att klistra in); tomma rader och rader som börjar med `#` hoppas över. Den läses
    medan den skrivs (`parseParamTable`) och det som är fel sägs med sin rad: en kolumn som inte är en inställning,
    en rad med för få eller för många värden, ett värde som inte är ett ord. Tabellen sparas med skriptet
    (`UserScript.table`). För varje rad sätts värdena i koden **för den körningen bara** och skriptet körs i
    skriptens worker; **ingenting går in i programmet**. Vad en körning ger (`runResults`) är dess *Result*-
    scratchpads som den skrev i, annars de övriga scratchpads den skrev i (från början till efter sista skrivna
    byte), annars den längsta sträckan minne den skrev; filerna heter `skript_01.prg`, `skript_02.prg` … och sparas
    i en mapp, läggs till i projektet eller öppnas som ett nytt projekt, som efter *Run on files…*. En rad vars
    körning inte går väl eller inte skriver något sägs i meddelandet efteråt.
- **Fler sätt att starta ett skript** (`script-hooks.ts`, gruppen *Starts* under *Init*, 2026-11-22):
  - **Kommando i paletten:** varje skript i projektet är ett kommando, *Run the script "namn"* (Ctrl+Shift+P), som
    gör vad *Run* gör.
  - **En egen tangent** (`UserScript.key`): Alt och en siffra, Alt+1 till Alt+9 (inte Ctrl+Alt, som är AltGr på
    många tangentbord), vald under *Starts*; en tangent hör till ett skript i projektet (de andras är avstängda i
    listan, med skriptets namn). Tangenten kör skriptet var man än är i fönstret, också medan man skriver, och står
    vid kommandot i paletten.
  - **Före Build & Run** (`UserScript.when` = `'build'`, kryssrutan *Before Build & Run, on the built program*):
    skriptet körs av sig självt varje gång Build & Run (F5, Shift+F5) har byggt och verifierat programmet, **på det
    byggda programmet**, inte på projektet (`withBuildScripts`): filerna som de just byggdes är minnet det kör på,
    och det som ändras (`withRunChanges`: varje ändrad byte i den sista fil som har adressen) finns i programmet
    emulatorn får, skrivet som egna filer i en tillfällig mapp, och ingen annanstans. Projektet, källkoden, exporten
    och verifieringen är som de var. Flera körs i projektets ordning, vart och ett på det förra lämnade; byggloggen
    säger vad vart och ett gjorde. Det är så ett program vars byte projektet håller dekrypterade (ett skript
    dekrypterade dem in i programmet, och de ändrades där: en text översatt, en rutin lagad) går att köra igen:
    skriptet krypterar byten som programmets egen dekryptering väntar sig dem. Ett skript som inte går att kontrollera
    eller inte slutar väl stoppar Build & Run med ett meddelande, och emulatorn startas inte. Scratchpads och
    uppmärkning (`.mark` …) sparas inte från de körningarna. Inte för en cartridge (dess chip är banker, inte ett
    minne), och inte för den exporterade källkoden: den som bygger den själv med `build.bat` får de byte projektet
    har.
  - **Efter att en fil laddats** (`UserScript.when` = `'load'`, kryssrutan *After a file is loaded*; en av de två,
    inte båda): skriptet körs av sig självt, en gång, när analysen av det som just laddats är klar och uppackningen
    den väntar på är gjord (som översikten väntar, `scriptsFor`). **Bibliotekets skript** med det (`when` står i
    skriptets fil) som passar programmet läggs till i projektet som kopior och körs där (`loadScripts`): de som inte
    behöver något namn i programmet, eller vars alla namn programmet har, och som projektet inte redan har; ett som
    inte går att kontrollera i programmet hoppas över. **Projektets egna** med det körs igen när en fil läggs till.
    De körs ett i taget, vart och ett när analysen av det förra gjorde är klar, och ett meddelande säger vilka; det
    de gör (byte, uppmärkning) är vanliga körningar som Ctrl+Z tar tillbaka. Ett projekt som öppnas kör inga: dess
    skripts resultat ligger redan i det.
- **Vad ett värde har, efter punkten** (`lib/jsmembers.ts`, 2026-11-23): i ett JavaScript-skript föreslår editorn
  efter en punkt egenskaperna och metoderna hos värdet framför den, var och en med vad den är (metoder sätts in med
  sin parentes; Tab tar förslaget). Det som skrivs efter punkten smalnar av listan. Värdena är de ett skript får:
  `disk.` (`name`, `id`, `tracks`, `files`, `read(`, `sector(`), en fil i dess directory (`name`, `type`, `blocks`,
  `track`, `sector`), `cpu.` (`call(`, `limit`), det ett anrop ger (`a`, `x`, `y`, `p`, `c`, `z`, `n`, `brk`), en av
  programmets filer (`start`, `end`), byte (`mem.`, en scratchpad, en fil läst från disken: `length`, `fill(`,
  `set(`, `subarray(` …), en lista (`forEach(`, `map(`, `filter(`, `find(` …) och en text (`padEnd(`, `padStart(` …).
  Vad ett namn är läses ur koden (`jsTypeOf`): `const r = cpu.call(…)`, `for (const f of disk.files)`,
  `disk.files.forEach((f, i) => …)`, `const first = disk.files[0]`; uttrycket framför punkten läses bakifrån över
  hela parenteser (`tailExpression`). Efter punkten på ett värde Mimir inte känner föreslås ingenting, och inte inuti
  en text.
- **Mallar i JavaScript** (`script-templates-js.ts`, `JS_TEMPLATES`, 2026-11-22): listans *Templates* har två flikar,
  *Assembler* (dekrypteringsmallarna, som förut) och *JavaScript* (vald flik sparas av appen,
  `kr.scriptTemplatesTab`). JavaScript-mallarna är exempel på det språket är bra på i Mimir, var och en något man
  vill göra med ett program; en kopia läggs till som ett JavaScript-skript med *Settings* visad:
  - *XOR key byte* (`xor_js`): varje byte EOR:ad med en nyckel, till scratchpaden `result` eller på plats.
  - *Find text* (`find_text`): programmets texter (följder av bokstäver, siffror och skiljetecken, minst
    `minLength` långa med minst fyra bokstäver) i PETSCII eller skärmkoder, skrivna med adress; `markThem` märker dem
    som text.
  - *Find bytes* (`find_bytes`): varje ställe där ett mönster av byte finns, skrivet i hex, `??` för vilken byte som
    helst (`"8d 20 d0"`, `"20 ?? c0"`).
  - *Name a jump table* (`jump_table`): rutinerna som en tabell av adresser pekar på (låga och höga byte var för
    sig, `plusOne` för adresser lagda för en RTS), skrivna, och namngivna med `nameThem`.
  - *Unpack RLE* (`rle_unpack`): run-length-data (ett antal och en byte, 0 avslutar) till `result`; loopen är stället
    att skriva packarens eget format.
  - *Read the disk* (`disk_files`): den monterade diskens directory med var varje program laddas, eller en fil
    kopierad till scratchpaden `file`.
  - *Call a routine* (`call_many`): en rutin anropad med varje värde på A från `first` till `last`, och vad den
    lämnar; kopian börjar i safe mode (`ScriptTemplate.safe`).
  - *Unpack with Sindri* (`sindri_unpack`): Sindris uppackare körd på programmets första fil eller en fil på disken
    (`fileName`); varje lager skrivs, och det uppackade programmet blir en fil (`saveAs`).
  - *Run in a C64* (`sindri_run`): programmet startat i en hel C64 (`start`: `"RUN"` eller `"SYS 2064"`) och kört
    `seconds` sekunder eller till `stopAt`; skärmen skrivs, visas på C64-skärmen (`screen.show(c64)`), och minnet
    `saveFrom`–`saveTo` blir en fil.
  - *List the music and make .sid files* (`sid_files`, 2026-11-24): programmets musikblock med init, play och om de
    spelar för sig själva; varje låt blir en .sid-fil (`makeFiles`, `author`) och en av dem kan spelas (`playTune`,
    `playSong`).
  - *Print the notes a tune plays* (`sid_notes`, 2026-11-24): en spelare körd bild för bild (en av programmets låtar,
    `tune`, eller rutinerna `init` och `play`), och det den lämnar i SID:en skrivet: varje rösts not, vågform och
    gate, och volymen; en bild som är som den förra utelämnas.
  - *Show a screen* (`screen_show`, 2026-11-23): 1000 skärmkoder i programmet (`screenAt`) visade på C64-skärmen som
    C64:an visar dem, med färgerna från `colorsAt` (annars `textColor`), programmets eget teckenset (`charsetAt`) eller
    ROM:ens (`lowerCase`), och ram- och bakgrundsfärg.
  - *Hex dump on the screen* (`screen_hexdump`, 2026-11-23): minnet från `start` som en monitor visar det, på
    C64-skärmen: adressen i gult, byten i hex (nollor i grått) och texten (PETSCII, eller skärmkoder med
    `screenCodes`); så många byte en rad som skärmen är bred (8 på 40 kolumner, fler i extended mode) och så många
    rader som den har.
  Varje mall börjar med en kommentar som säger vad den gör och har sina inställningar som `const`-rader med
  kommentar. I JavaScript är **bara `const`-rader vid vänsterkanten inställningar** (en `let` är kodens egen
  variabel). Ett JavaScript-skript får också `files`: programmets filer i minnet, `[{ start, end }]`.
- **SID-musiken i ett JavaScript-skript** (`script-sid.ts`, `sidApi`, 2026-11-24): ett skript får `sid`, det
  analysen vet om programmets musik (5.8) och det *Play music* och exportens .sid gör.
  - Låtarna: `sid.tunes` är programmets musikblock (tom lista när det inte har något), `sid.tune` det första och
    `sid.at(adress)` det som täcker en adress. En låt har `name`, `file` (programfilen den ligger i), `start`,
    `end`, `size`, `bytes`, `init`, `play` (0: en samplespelare), `song` (sången programmet startar), `songs`,
    `samples` (`{ nmi, hz }` eller `null`), `why`, `score` och `plays`: det den spelar med i VICE, i DeepSID och
    som .sid (`musicPlayData`): `{ start, end, bytes, init, play, parts, routine, problem, alone }`. `routine`
    säger vad Mimirs rutin bredvid blocket gör när `init` är en sådan (ger X och Y som programmet, lägger tillbaka
    det en snapshots spelare läser, skriver en sångs bytes, startar samplen), annars `null`.
  - En låt ger `tune.sid({ name, author, released })` (.sid-filen som exporten skriver den; en samplespelares är en
    RSID), `tune.player({ song, title })` (PRG:n som spelar den i VICE: `{ prg, port, driver, screen, warnings }`)
    och `tune.run({ song, frames })` (körd för sig själv, med bara sina bytes i minnet).
  - .sid-filer: `sid.parse(fil)` läser en (`{ name, author, released, start, end, size, init, play, songs, song,
    rsid, bytes }`), `sid.make(bytes, { load, init, play, name, author, released, song, songs, rsid })` gör en
    (PSID v2; `init` är `load` och `play` `load + 3` när de inte ges) och `sid.load(fil, at)` kopierar en fils
    bytes in i `mem` där de laddas (eller på en adress).
  - Köra: `sid.run({ init, play, song, a, x, y, frames, registers })` kör en spelare i en kopia av `mem` som det är
    nu (`runPlayer`: init med sången i A, sedan play en gång per bild; högst `SID_RUN_FRAMES` = 30 000 bilder, 500
    när inget sägs) och ger `{ plays, init, played, frames, stop, registers, notes, heard, used, ran, initCycles,
    maxCycles, dump }`. `dump` är SID:ens 25 register efter init (`dump[0]`) och efter varje play-anrop
    (`PlayerRunOptions.frame`); `registers: false` utelämnar den. Utan `play` (eller 0) körs en samplespelare från
    sitt timeravbrott (`runDigi`: `{ samples: true, hz, nmi, handler, calls, … }`).
  - Läsa register: `sid.voices(register)` ger de tre rösterna (`{ frequency, pulse, control, gate, wave, attack,
    decay, sustain, release, note }`) med `volume`, `cutoff`, `resonance` och `filtered` på listan,
    `sid.note(frekvens, { ntsc })` ett frekvensvärde som `{ name, octave, hz, cents }` (`"A-4"`; `null` för 0) och
    `sid.noteTables()` var nottabeller finns i `mem` (`noteTables`).
  - Spela: `sid.player(vad, { song, title })` gör spelar-PRG:n och `sid.play(vad, { song, in })` begär att något
    spelas, där *vad* är en låt, en .sid-fil eller `{ bytes, load, init, play }` och `in` är `"vice"` eller
    `"deepsid"` (inte givet: där Settings → Toolchain säger, `sid.musicPlayer`). Ingenting spelas under körningen:
    körningen slutar med begäran (`ScriptRun.plays`, `ScriptSidRequest` med .sid-filen och spelar-PRG:n, högst
    `SID_REQUESTS` = 4) och appen spelar dem när körningen slutat väl (`doScriptRequests`, `playScriptTune`), efter
    exporten och byggena. I safe mode spelas ingenting: *Last run* visar *Would play*; annars *Played*.
  - Låtarna ges bara till en körning av skriptet självt (inte *Run on files*, *Run with values* eller före Build &
    Run), och bara när koden nämner `sid`; annars är `sid.tunes` tom och `sid.play` säger att det inte går där.
    Resten (`parse`, `make`, `load`, `run`, `player`, `note`, `voices`) finns alltid.
  - Mallarna *List the music and make .sid files* (`sid_files`) och *Print the notes a tune plays* (`sid_notes`).
- **Bygge och körning i ett JavaScript-skript** (`script-build.ts`, `buildApi`, 2026-11-24): ett skript får `build`,
  det *Verify* (F7) och *Build & Run* (F5, Shift+F5) gör.
  - Läsa: `build.assembler` (`"kickass"`/`"64tass"`), `build.emulator` (`"VICE"`), `build.debugger` (namnet på
    debuggern i Settings → Toolchain) och `build.last`, det senaste bygget eller `null` före ett: `{ ok, fresh, by,
    files, log }`. `fresh` är sant när bygget är av projektet som det är nu (`BuildState.key` mot `filesKey`), `by`
    är `"built-in"` (Verify) eller assemblerns namn (Build & Run), och varje fil är `{ name, source, ok, same,
    total, start, end, bytes, prg, errors }` (PRG:n är assemblerns när den byggde, annars den inbyggda
    verifierarens; `null` när källan inte gick att assemblera).
  - Begära: `build.verify()` (som F7), `build.run({ debugger })` (som F5, eller Shift+F5 med `debugger: true`) och
    `build.start(prg, { name, start, debugger })`, som startar en PRG skriptet självt gjort (en fil packad med
    `brokkr.pack`, en av loaderns filer) i emulatorn: laddad och körd med RUN, eller med SYS på `start`.
    `build.requests` är det som begärts så här långt, en text var (`buildRequestText`).
  - Ingenting byggs eller startas under körningen: körningen slutar med begäran (`ScriptRun.builds`,
    `ScriptBuildRequest`, högst `BUILD_REQUESTS` = 8), och appen gör dem i ordning när körningen slutat väl
    (`doScriptRequests`): först exporten, om skriptet också bad om den, sedan byggena och starterna. En verifiering
    som inte går igenom, en export som inte skrevs eller en start som misslyckas avslutar resten. En PRG som ska
    startas skrivs till en tillfällig mapp (`writeExport` `temp`) och ges till `kr.run`.
  - I safe mode byggs och startas ingenting: *Last run* visar *Would build and start*; annars *Built and started*.
    Som exporten ges bygget bara till en körning av skriptet självt, och bara när koden nämner `build`.
  - Editorn föreslår medlemmarna efter `build.`, senaste bygget och en byggd fil. Mallen *Pack and start*
    (`build_packed`) packar programmet med Brokkr (`format`), begär verifieringen (`verifyFirst`) och startar den
    packade filen i VICE eller debuggern (`inDebugger`).
- **Exporten i ett JavaScript-skript** (`script-export.ts`, `exportApi`, 2026-11-24): ett skript får `exporter`
  (`export` är ett ord i språket), det *Export* skriver: källorna, binärerna, byggskripten, README, projektfilen och
  originalfilerna (`exportFiles`), som de är när körningen börjar.
  - Läsa: `exporter.name`, `assembler` (`"kickass"`/`"64tass"`), `folder` (projektets källmapp, annars mappen det
    senast exporterades till; `null` när en mapp kommer att frågas efter), `main`, `sources`, `outDir`,
    `exporter.files` (`[{ name, kind, size, text, bytes }]`, `kind` är `"source"`, `"script"`, `"text"` eller
    `"binary"`), `names`, `has(namn)`, `read(namn)` (text, eller byte för en binär).
  - Ändra: `add(namn, innehåll)` (text eller byte; ersätter en fil med samma namn), `edit(namn, text => …)`,
    `replace(namn, från, till)` (text eller reguljärt uttryck; ger antalet), `remove(namn)`, `rename(från, till)`;
    `exporter.changes` är `{ added, changed, removed }` så här långt. Namn är relativa exportmappen, med `/` för
    mappar; `..`, enhet och absoluta sökvägar tas inte (`exportFileName`), och skiftläget skiljer inte två filer.
  - Skriva: `exporter.write({ elsewhere })` begär exporten. Ingenting skrivs under körningen: körningen slutar med
    begäran (`ScriptRun.exports`, `ScriptExportRequest`: skriptets filer, de borttagna, de ändrade, `elsewhere`), och
    appen skriver den när körningen slutat väl och dess ändringar är i programmet (`finishScriptRun` →
    `exportProject(…, by)`): verifiering som vanligt, exporten som den är då, med skriptets filer lagda över
    (`applyExportRequest`) och de verifierade PRG:erna i `out/` som alltid. Till projektets källmapp; utan projekt,
    eller med `elsewhere: true`, frågas mappen efter. En körning som slutar med fel begär ingenting.
  - Om körningen också ändrade programmet (byte eller märkning) är en källa skriptet ändrade inte längre källan:
    den skrivs som den är nu, och meddelandet säger vilka filer och att skriptet ska köras igen (`stale`).
  - I safe mode skrivs ingenting: *Last run* visar *Would export* med vad som skulle skrivas (`exportRequestText`);
    annars *Exported*. Exporten ges bara till en körning av skriptet självt (inte *Run on files*, *Run with values*
    eller krokarna före bygge och efter laddning), och bara när koden nämner `exporter`; annars säger `exporter`
    att det inte finns något att exportera här.
  - Editorn föreslår medlemmarna efter `exporter.`, en fil och `changes`. Mallen *Export with a header and a file
    list* (`export_own`) lägger en kommentarsrad först i varje källa (`header`), lägger till en lista över exportens
    filer (`listFile`) och skriver exporten (`elsewhere`).
- **Loadern i ett JavaScript-skript** (`script-loader.ts`, `loaderApi`, 2026-11-24): ett skript får `loader`, det
  loaderfliken för den monterade disken eller bandet visar (Spindle, Bitfire, BoozeLoader, Sparkle, IFFL, Krills,
  Covert Bitops, DLoC:s, Pirate Slayer, Para-Protect, Disk-Speed, band), eller `null` när Mimir inte känner någon;
  `loaders` är alla (diskens, sedan bandets), en tom lista utan.
  - `loader.name` (vilken loader), `loader.disk` (avbildningens namn), `loader.script` och `loader.lines` (skriptet
    fliken skriver: verktygets eget skript som bygger disken igen, eller fillistan; tomt där loadern inte har något).
  - `loader.groups`: det ett anrop av loadern laddar tillsammans (ett Spindle-jobb, en Sparkle-bundle, en IFFL-del;
    annars en fil var): `[{ name, what, files, start, end, size }]`. `loader.files`: alla filer i laddordning,
    `[{ name, group, index, start, end, size, bytes, prg }]`, uppackade där fliken packar upp dem; `bytes` utan
    laddadress, `prg` med.
  - `loader.find(namn eller nummer)` ger en fil (namnet med eller utan ändelse, skiftläget kvittar) eller `null`;
    `loader.group(namn eller nummer)` en grupp; `loader.at(adress)` filerna som täcker en adress när de är laddade.
  - `loader.load(fil eller grupp, at)` kopierar byten in i `mem` där de laddas (en fil kan läggas på `at`) och ger
    `{ start, end }`. Det som hamnar över programmets byte är körningens ändring, som allt annat skriptet skriver
    i `mem`; resten är skriptets arbetsminne (läs det, kör kod i det med `cpu.call`, spara det med `save`).
  - Appen läser filerna (`scriptLoaders` i `App.tsx`) med samma grupper som *Export files to project* tar
    (`groupsOnly`), och bara för ett skript vars kod nämner `loader`; de skickas med körningen
    (`ScriptRunOpts.loaders`, `JsExtras.loaders`, `ScriptLoaderData`). Editorn föreslår medlemmarna efter `loader.`,
    en grupp och en fil. Mallen *List the loader's files* (`loader_files`) skriver grupperna och filerna med adress
    och storlek, gör en fil eller alla (`saveFile`, `"*"`) till filer och kan skriva loaderskriptet (`showScript`).
- **Brokkr i ett JavaScript-skript** (`script-brokkr.ts`, `brokkrApi`, 2026-11-23): ett skript får `brokkr`, det
  Brokkr kan, med Brokkrs egen kod (samma som *Pack with Brokkr* och kommandoraden kör).
  - `brokkr.pack(prg, { format, start, effect, effort, port, irq, maxSeconds })` gör en PRG (programmets första fil
    när ingen ges) till en fil som packar upp sig själv och ger `{ prg, bytes, load, end, size, from, saved, format,
    entry, basic, port, cycles, seconds, areas: [{ name, start, end }], warnings }`. `format` är `"exomizer"`
    (förval), `"brokkr"`, `"fast"` eller `"auto"` (den minsta som packar upp inom `maxSeconds`); `start` är `"sys"`
    (förval), `"basic"` eller en adress eller ett namn; `saved` är procent mindre, `seconds` tiden på en PAL-C64.
    Filen är körd i Brokkrs emulerade C64 innan den ges, som alltid.
  - `brokkr.crunch(bytes, { format, backward, effort })` ger en ren ström (som `exomizer raw`): `{ bytes, size,
    from, saved, format }`; `brokkr.decrunch(stream, { format, backward })` ger byten tillbaka.
  - `brokkr.mem(bytes, start, { format, forward, load, effort })` ger en ström med datats adress, laddad där den
    avkrunchas på plats (som `exomizer mem`): `{ bytes, start, end, inPlace, size, from, saved, format, warnings }`;
    `load` är `"auto"` (förval), `"none"` eller en adress, och bara Exomizer-formatet kan krunchas framåt.
  - `brokkr.decruncher({ format, zp, at })` ger källkoden (Kick Assembler) till rutinen som avkrunchar en mem-fil;
    `brokkr.formats` är formatens namn.
  - Fel i det som ges (inga byte, okänt format eller `effort`) sägs med funktionens namn. Ingenting ändrar
    programmet; det skriptet gör sparas med `save`. Editorn föreslår medlemmarna efter `brokkr.` och efter det
    varje funktion ger. Mallen *Pack with Brokkr* (`brokkr_pack`) packar programmets fil, skriver storleken och
    uppackningstiden i varje format, packar upp den valda med Sindri och jämför byte för byte (`check`), och gör
    filen (`saveAs`). Assembler-skript har inget motsvarande: de kör bara 6510-kod.
- **Sindri i ett JavaScript-skript** (`script-sindri.ts`, `sindriApi`, 2026-11-23): ett skript får `sindri`, det
  Sindri kan, och `save(name, bytes, load)` för filer det gör.
  - `sindri.unpack(prg, { disk, entry, port })` kör uppackaren på en PRG (programmets första fil när ingen ges; den
    monterade disken sitter i 1541:an om inte `disk: false`) och ger `{ unpacked, packer, start, end, entry, port,
    basic, bytes, prg, layers, listing, stop, drive, cycles, ms }`; `end` är adressen efter sista byten, som överallt
    i skripten (Sindris egna slut är inklusiva och räknas om). Ett lager är `{ index, entry, kind, packer,
    instructions, written: [{ start, end }], what }`, `what` samma mening som uppackningsloggen har.
  - `sindri.disassemble(at, count, bytes)` ger rader av `mem` (eller av givna byte, som om de låg på `at`),
    `sindri.basic(at)` BASIC-programmets rader, `sindri.sys(at)` adressen dess SYS går till (eller `null`),
    `sindri.prg(start, end)` en bit av `mem` som PRG, `sindri.roms` varifrån ROM:arna kommer (`"stand-ins"` utan).
  - `sindri.c64({ disk, program })` ger en hel C64 vid READY (kräver ROM:arna; felet säger var de finns), med
    programmets filer i RAM (en fil på `$0801` får BASIC:s slutpekare satta som LOAD gör) och disken i 1541:an. Den
    har `mem` (sitt eget RAM, inte skriptets), registren `a x y s p pc` (läs och skriv), `cycles`, `load(bytes, at)`,
    `loadPrg(prg)`, `peek(a)` (som CPU:n läser, med ROM), `run({ until, cycles })` → `{ reason: "until" | "cycles" |
    "jam", pc, cycles }`, `call(where, { a, x, y, c })` (till rutinens RTS, med ROM, I/O och avbrott), `type(text)`
    (tangentbordsbufferten, högst 10 tecken) och `screen()` (textskärmens 25 rader, där VIC:en läser dem). Maskinen
    stegas som Sindri själv gör (`dmaWait`, avbrott, NMI).
  - En körning i en maskin tar `SINDRI_RUN_CYCLES` (20 miljoner) cykler om inget annat sägs, och allt ett skript kör
    i Sindri får tillsammans ta `SINDRI_BUDGET` (1,2 miljarder cykler, tjugo minuter C64-tid); *Stop* avslutar
    workern som för andra skript. Ingenting av detta ändrar programmet: Sindris maskiner är skriptets egna.
  - `save(name, bytes, load)` lägger en fil i `ScriptRun.made` (högst 64, namnet rensat från tecken en fil inte får
    ha; `load` utelämnad: en fil utan laddadress). *Last run* listar dem under *Files it made* med *To the
    project…* (lägg till i projektet eller öppna som nytt, när filen har en laddadress) och *Save…* (PRG med
    laddadress, annars byten som de är); ingenting skrivs någonstans förrän man väljer. En körning som gjorde
    filer visar *Last run* och säger det i meddelandet.
  - ROM:arna hämtas (`kr.c64Roms`) bara för ett skript vars kod nämner `sindri`. Editorn föreslår medlemmarna efter
    `sindri.`, en maskin, ett uppackningsresultat, ett lager och ett körresultat (`lib/jsmembers.ts`).
- **C64-skärmen** (`script-screen.ts`, `components/ScriptScreen.tsx`, 2026-11-23): knappen *C64 screen* (ikonen med
  en skärm) i verktygsraden öppnar en emulerad C64-skärm till höger om koden, som skriptet kan använda som utdata:
  40×25 tecken med VICE:s teckenset-ROM (Mimirs egna bokstäver utan den), C64:ans färger, ramen runt (32 pixlar på
  sidorna, 36 över och under) och en blinkande markör (tecknet under den inverterat i markörens färg). Panelens kant
  dras för bredd (`kr.scriptScreen` sparar öppen/stängd, bredd, extended mode, pixelstorlek och zoom).
  - **Zoom** (2026-11-23, för små skärmar): *Zoom* i panelens rubrik är *Fit* (förval: så stor som panelen har plats
    för, i hela pixlar på skärmen när det gör den högst en tiondel mindre, annars hela platsen) eller 1×–8×
    (`SCREEN_MAGS`: en C64-pixel så många CSS-pixlar, avrundat till hela pixlar på skärmen). En skärm större än
    panelen rullar (hjulet, rullningslisterna) och flyttas med ett drag (handen); Ctrl+hjul över skärmen zoomar ett
    steg i taget med punkten under pekaren kvar där den var (i extended mode byter det *Pixel size*), och fönstret
    zoomas inte. En storlek mellan hela pixlar ritas skarpt i närmaste större hela storlek och skalas ner mjukt, så
    att bokstäverna blir så skarpa de kan. **Show large** (förstoringsglaset med plus, eller ett dubbelklick på
    skärmen) visar skärmen så stor fönstret har plats för, över fönstret (under dialoger, menyer och meddelanden) tills
    ett klick, krysset eller Esc (bara den: inte helskärmsläget också); den följer körningen, också i felsökaren
    (F8/F6 stegar med den öppen). Rubriken lämnar ut ordet *Extended*, sedan titeln, sedan storleken när panelen är
    smal, så att knapparna alltid syns.
  - **Skärmeditorn** (`TextScreen`) är KERNAL:ens som CHROUT driver den: PETSCII skrivs där markören står,
    färgkoderna, RVS ON/OFF, CLR och HOME, markörförflyttningarna, DEL och INST, citatläge (kontrollkoder inom citat
    visas inverterade), båda teckenseten ($0e/$8e), logiska rader på två rader (en rad som går förbi sista kolumnen
    skjuter in en tom rad under sig) och skärmen som rullar upp en logisk rad när markören går förbi sista raden. CLR
    fyller färg-RAM med markörens färg, som de senare KERNAL:erna (VICE:s).
  - **Extended mode** (brytaren *Extended* i panelens rubrik): skärmen får så många kolumner och rader som panelen
    har plats för, aldrig färre än 40×25 (och högst 240×120, `SCREEN_MAX`); i vanligt läge visas 40×25 i stället
    med sin *Zoom* (ovan). *Pixel size* (1×–4×, CSS-pixlar avrundade till hela
    pixlar på skärmen så att bokstäverna är skarpa) väljer hur stor en C64-pixel är; 1× är C64:ans egen upplösning.
    Storleken står i rubriken (*57×31*). En körning får storleken skärmen har när den startar (`runScreenSize`,
    `ScriptRunOpts.screen`); det en körning lämnade visas från övre vänstra hörnet om storleken ändrats sedan.
  - **I JavaScript** ger `screen`: `print(...)` (en rad, sedan RETURN), `write(...)` (utan RETURN), `chrout(byte
    eller bytes)` (PETSCII som CHROUT), `at(col, row)`, `clear()`, `home()`, `color`, `border` och `background`
    (0–15 eller ett namn, `"light blue"`), `reverse`, `lower`, `poke(col, row, code, color)`, `peek(col, row)`,
    `codes` och `colors` (alla celler, en rad efter en annan), `cols`, `rows`, `col`, `row`, `show(at, colorsAt)` (1000
    skärmkoder ur programmet och deras färger; `show(c64)` en maskins skärm från `sindri.c64()`) och `charset(at)`
    (programmets eget teckenset, 2 KB). Text skrivs som text i båda teckenseten (`\n` är RETURN, `\x93` CLR, `\x1c`
    röd …; £, pilarna, π, kortfärgerna och linjegrafiken som PETSCII). Editorn föreslår medlemmarna efter `screen.`.
    Ett skript som själv deklarerar `screen` (`const screen = …`) har sitt eget: koden körs i ett block.
  - **I assembler** (körning i minnet) gör körningen KERNAL:ens och BASIC:s utskriftsrutiner själv där programmet
    inte har byte (`SCREEN_ROUTINES`, `screenTraps`): `$ffd2` CHROUT och `$e716` (tecknet i A), `$e544` (rensa),
    `$e566` (hem), `$fff0` PLOT (C satt: läs rad i X och kolumn i Y; annars sätt), `$ab1e` STROUT (texten på A/Y till
    en nollbyte) och `$bdcd` LINPRT (talet i A/X). Rutinen görs och returneras från som dess RTS (`JMP $ffd2` sist
    avslutar körningen), också när programmets egen kod anropar den (och från `cpu.call` i JavaScript). I
    felsökaren är ett `JSR $FFD2` ett steg och skärmen visar körningens skärm som den är nu (*now*).
  - **Skärmen i minnet** (`screenMemory`, `SCREEN_RAM`/`COLOR_RAM`, 2026-11-24): i en körning i minnet (assembler och
    JavaScript) ligger skärmen där C64:an har den: skärmkoderna på `$0400`–`$07e7`, färg-RAM på `$d800`–`$dbe7`, ram-
    och bakgrundsfärgen på `$d020` och `$d021`. `sta $0400,x` sätter ett tecken på skärmen, `sta $d800,x` färgar det,
    `inc $d020` byter ramfärg och `lda $0400` läser det CHROUT skrev; i JavaScript är `mem[0x0400]` skärmens första
    cell (och `screen.border` är `mem[0xd020]`), också det programmets kod skriver där från `cpu.call`. En körning
    börjar med en rensad skärm där (mellanslag i ljusblått, C64:ans ram och bakgrund). Varje del är skärmens bara där
    ingen fil i programmet och ingen scratchpad har byte (`screenMemory`: ett program som laddar över `$0400` behåller
    sina byte, och skärmen har dem då inte). Det som skrivs där hör till skärmen: det räknas inte bland det körningen
    ändrade utanför programmet och visas inte under *Memory it wrote* (`screenRanges`). I extended mode är minnet
    skärmens övre vänstra 40×25 tecken, 40 i raden som på C64:an (`TextScreen.sync` håller dem i takt före och efter
    det som skriver på skärmen); resten nås med utskrift och `screen.poke`. Färgerna är de låga fyra bitarna, som VIC:en
    ser dem.
  - **I hela C64:an** är skärmen C64:ans egen, som VIC:en visar den (`c64TextScreen`): matrisen i banken CIA 2 och
    $d018 väljer, färg-RAM, ram- och bakgrundsfärg, teckensetet (ROM:ens, eller 2 KB i RAM); markören visas inte.
  - Det en körning skrev på skärmen sparas med körningen (`ScriptRun.screen`, `ScriptScreen`); en körning som skrev
    där öppnar panelen och säger det i meddelandet (*It printed on its C64 screen*). *Copy* kopierar skärmen som text.
- **Biblioteket** har skript för alla projekt (sparat av appen, `kr.scriptLibrary`). *Save to library* sparar en kopia
  av skriptet (koden och scratchpadsens platser, inte vad de höll) i stället för ett med samma namn (*Update library*
  när det redan finns). I listan *Library* lägger `+` en kopia i projektet (med ett eget namn när det finns ett
  likadant) och `×` tar bort det ur biblioteket; projekten behåller sina kopior.
- **Biblioteket är en mapp med filer** (`script-file.ts`, `electron/main/scripts.ts`, 2026-11-22): skripten i
  biblioteket ligger i mappen `Scripts` i bibliotekets mapp (10.6: `Documents\Mimir\Library`, eller den som
  inställningarna säger), en fil per skript, så att skript kan delas, versionshanteras och skrivas i en annan editor.
  - **Filen är skriptets kod som den är**: `decrypt.asm` för ett skript i assembler, `decrypt.js` för ett i
    JavaScript; filens namn är skriptets. Det ett skript är utöver koden (assemblern, scratchpadsen med sitt
    startinnehåll, Init, safe mode, maskin och stoppadress, watch-listan, värdetabellen och namnen det behöver) står
    på **en rad överst**, en kommentar för assemblern och för JavaScript: `// mimir-script {"lang":"kickass",…}`
    (`; mimir-script …` i 64tass). En fil utan raden är också ett skript: koden ensam, i Kick Assembler eller, efter
    ändelsen, i JavaScript. Det raden håller läses med försiktighet (`readScriptFile`): det som inte är som det ska
    lämnas ute.
  - Bara huvudprocessens `ScriptStore` rör mappen; fönstret namnger en fil med dess rena namn där (inget
    mappnamn, `.asm` eller `.js`, inte dold; `isScriptFileName`), högst 2 MB. *Save to library* skriver filen (i
    stället för den med samma namn; en som bytt ändelse tas bort), *Remove* flyttar den till papperskorgen, och
    mappknappen i *Library*-rubriken visar mappen i filhanteraren. Listan läses om när appen startar och när
    Scripts-fliken visas, så en fil som lagts dit för hand syns. **Första gången flyttas det appen själv höll**
    (`kr.scriptLibrary` i localStorage) in i mappen, där ingen fil har namnet. Utan skrivbordsapp (förhandsvisningen)
    håller appen biblioteket själv som förut.
  - **Ett skript som passar programmet erbjuds** (`scriptFits`): när ett skript sparas i biblioteket följer namnen
    med som dess kod använder och som användaren själv gett i det projektet (`needs`: en rutin, en tabell). I ett
    annat program **passar** skriptet när programmet har alla de namnen, som etiketter eller som rutiner kända från
    ett annat projekt (10.5) som ännu inte har namn här. Då står det först i *Library* med en grön prick (verktygs-
    tipset säger vad det behöver), och översikten har kortet *Scripts that fit* med *Add*. Läggs det till får de kända
    rutinerna sina namn först, så att skriptet går att assemblera. Ett skript som redan finns i projektet erbjuds
    inte.
- **Mallar** (*Templates*, under *Library* i skriptlistan; `script-templates.ts`, `SCRIPT_TEMPLATES`) är färdiga skript
  som Mimir har med sig: dekrypteringar (och krypteringar) som spelen i referensarkivet visade sig göra
  (`docs/encryption.md`). *XOR key byte* (`xor_key`, EOR med en byte, `$FF` vänder alla bitar), *XOR key string*
  (`xor_key_string`, EOR med nästa byte i en nyckel på 1–256 byte), *XOR rolling* (`xor_rolling_key`, en nyckel som
  ändras efter varje byte: plus något, sedan EOR), *XOR chain* (`xor_chain`, EOR med byten före, som dekrypterad eller
  krypterad), *Add/subtract* (`add_key`, ADC eller SBC med en nyckel som kan ändras, INC/DEC som nyckeln 1) och *Several
  steps* (`steps`, upp till fyra steg i rad: ADD, SUB, XOR, ROTL, ROTR, som Commodores band gör SBC, EOR, SBC, EOR).
  *XOR rolling* kan också ta sidan (adressens höga byte) EOR en nyckel som nyckel (`pageKey`, EA:s Construction Set).
  Varje mall börjar med en kommentar som säger hur metoden fungerar och var den setts (spelets egen loop: *Pooyan
  (Datasoft, tape) lda ($80),y / eor #$77 / sta ($80),y*),
  och sedan inställningarna som `.var`: `source` (16 bitar: var de krypterade byten ligger, en adress, en av
  programmets etiketter eller en scratchpad), `dest` (vart resultatet går: scratchpaden `result`, en etikett i
  programmet, så att `.asm`-filen får byten, eller `source`, på plats), `length` (`tbl_001_end - tbl_001` är ett helt
  block) och nyckeln, och för de metoder där vägen tillbaka inte är densamma `encrypt` (`true`: krypterar) och för
  kedjan och den rullande nyckeln `backwards` (från sista byten ner). En nyckel från en CIA-timer som går medan loopen
  går (Pirate Slayer, Melbourne Houses band) kan ett skript inte efterlikna, eftersom det saknar timers. Det säger
  mallen *XOR rolling*, som hänvisar till Sindri (Unpack) eller VICE. Kontroller med `.error` stoppar skriptet innan
  det körs (`length` mer än `result` rymmer). Mallarna använder nollsidan (`$f6–$fe`, som en körning inte behåller) och
  pekare, så de når källan och målet var de än ligger. Rubriken *Templates* fäller in listan (appen minns det,
  `kr.scriptTemplatesFolded`); verktygstipset på en mall är dess rad och kommentar. `+` lägger en kopia i projektet
  (namnet `xor_key`, `xor_key2`, …) med scratchpaden `result` (1 kB) där det finns plats, bort från koden. Mallarna
  ger samma byte i KickAss.jar som i den inbyggda assemblern (integrationstestet), och ett test per mall dekrypterar
  det en referens av metoden krypterat, till scratchpaden, till en tabell i programmet och på plats, och krypterar
  tillbaka till samma byte.
- **Assemblern** (`verify/kick-subset-assembler.ts`, samma som verifieringen och patcharna använder) kan utöver det
  generatorn skriver: multi-etiketter (`!loop:`, `!:`, `bne !-`, `jmp !loop+`), scopes (`{ }`, `name: { }` som läses
  `name.label` utanför), `.if`/`else`/`else .if`, `.for`, `.while`, `.var` och `.eval` (`=`, `++`, `--`, `+=`, `-=`,
  `*=`, `/=`), `.print`, `.error`, jämförelser, `&&`, `||`, `!`, `~`, `? :`, `[ ]` som parenteser, teckenlitteraler
  (`'a'` i den aktuella kodningen), flyttal och funktionerna (`round`, `floor`, `sin`, `toRadians`, `mod`, `min`,
  `max`, `pow`, … och strängarnas `.size()`, `.charAt()`). Mätt mot KickAss 5.25: `<` och `>` tar hela uttrycket
  efter sig (`<label+1` är låga byten av label+1), `{ }` till `.if`, `.for`, `.while` och ett eget block öppnar ett
  scope vars etiketter koden utanför inte ser (varje varv i `.for` och `.while` sitt eget), medan `.pseudopc { }`
  inte gör det, `else` står på raden efter en `.if` utan block, och ett villkor måste vara sant eller falskt. Ett
  okänt namn är ett fel på raden som använder det. Testerna assemblerar samma kod med KickAss.jar och jämför byten.

### 10.4 Visningsoffset (bara i editorn)

En visningsoffset (`Project.viewOffsets`: `start`–`end` i filen visas på `to`) är till för manuell analys: kod som
programmet kopierar någon annanstans innan den körs läses i listningen med de adresser och etiketter den har där, utan
att relokeras. Skillnaden mot ett flyttat block (8.1b) är att den bara finns i editorn. Analysen, `.asm`-filen, utdata
och round-trip är som utan den: byten står i källkoden där de laddas, utan `.pseudopc`, och programmets egen kod flyttar
dem när det körs. Den kräver därför inte att ingenting är laddat där byten visas.

- **Dialogen.** `O`, högerklick → *Program* → *Show selection/block at another address (listing only)…*, inspektorns
  *Show at…* eller kommandopaletten öppnar *Show at another address* med start och slut (inklusive) från markeringen
  eller blocket vid markören, och *Shown at (or offset)*: en adress (`$2000`) eller hur långt (`+$1000`, `-$0100`).
  Den säger direkt vad referenserna säger om adressen: hur många som går dit, hur många av dem som kommer från byten
  själva, och hur många av hoppen och anropen dit som landar på en instruktion (*mark the bytes as code to read them*
  när några inte gör det). Ligger laddade byte där de visas varnar den för det. Byten måste vara laddade och i en bank,
  inte i ett flyttat block (som redan visas där det körs), och får inte visas över sig själva eller över en annan
  offsets byte eller område (`viewOffsetProblem` i `packages/core/src/viewoffsets.ts`). På en offset ger `O` samma
  dialog för att visa den någon annanstans, eller *Remove offset*.
- **Listningen.** `render()` med `RenderOptions.viewOffsets` gör listningen (`lines` och `labels`) en gång till med
  offseten; filerna, `fileLines`, problemen och verifieringen kommer från renderingen utan den, och
  `RenderResult.viewOffsets` säger vilka offsets listningen visar. Analysens etiketter i byten får namn efter adressen
  där de visas (`l_1003` blir `l_2003`), och varje referens in i området där de visas får en etikett på byten den går
  till (`sub_2009`, på instruktionens första byte). Referenser dit skrivs med dem (`jmp code_2000`, `jsr sub_2009`,
  `lda l_200d,x`), en branch inne i byten likaså. Byten följer med i sina egna referenser till sig själva, som i sina
  branchar: kod skriven för $5000 och visad på $2000 har `jmp l_2026` för sin `jmp $5026`, och likaså anrop, läsningar,
  skrivningar (`sta smc_200a+1`), adresser som värden (`lda #<irq_c0a7`), ord i en tabell bland dem och kommentaren
  *self-modified by*; korsreferenserna säger *This instruction targets $2026*. Andra referenser till där byten laddas
  skrivs som adressen (`lda $1000,x` i kopieringsloopen), eftersom etiketterna där har värdet där de visas, och
  referenser från byten till byte efter dem står kvar där de laddas. Ligger laddad kod där byten visas
  behåller den sina egna referenser, och ett namn den redan har får laddadressen efter sig (`sub_0903_1003`).
  Användarens namn står kvar på byten, i listningen och i `.asm`-filen (där referenserna till området där de visas
  skrivs som adressen, `jsr $2009`). Byten har adressen där de visas i adresskolumnen (kursivt i accentfärgen, med
  laddadressen i verktygstipset) och en rand vid gutter, blockets `.pc` och rubrik säger var de visas (`· shown at
  $2000-$2010`), och en rad `==== shown at $2000-$2010 (offset +$1000), only here: the .asm has these 17 bytes at
  $1000-$1010 ====` och en vid slutet markerar dem.
- **Resten av editorn.** Statusraden visar `$2009 (loaded at $1009)`. *Go to* en adress där byten visas går till dem.
  Inspektorn säger var blocket visas (*Shown at*, med *Shown at…* och *Remove offset*) och räknar referenserna dit
  med i *Refs in*, och korsreferenserna (`X`) listar dem (`refsShown`). Explorers sektion *View offsets* listar varje
  offset med var den visas, hur långt och namnet på dess första byte; ett klick markerar byten i listningen, pennan
  öppnar dialogen och krysset tar bort den. En offset vars byte inte längre går att visa (filen borttagen, skräp,
  relocerad) står kvar tonad med skälet. Allt ångras med `Ctrl+Z`, och offseten sparas i projektfilen. I en
  cartridge visas den i sin bank.

### 10.5 Rutiner som är kända från andra projekt

Scenkod återanvänds: utskrift, IRQ-setup, laddare och players står i program efter program, länkade till olika
adresser. Namnet användaren ger en rutin ska därför följa med till nästa projekt som har den. När en rutin namnges
sparar Mimir ett fingeravtryck av den, som IDA:s FLIRT gör för biblioteksfunktioner och som Sindri gör för packare
med `--learn`; ett projekt som har samma rutin får namnet föreslaget. Allt räknas i
`packages/core/src/routines.ts`, biblioteket hålls av appen (`apps/desktop/src/store/routines.ts`).

- **Rutinen.** `routineAt(A, start)` tar instruktionerna i adressordning från `start` till den första RTS, RTI, JMP,
  BRK eller JAM som ingen av rutinens branchar går förbi (eller dit koden tar slut, högst 1024 instruktioner). Det
  beror bara på byten och på vad analysen läser som kod, så samma rutin får samma utsträckning var den än ligger.
- **Fingeravtrycket.** Rutinens byte som hex, med `..` för maskade byte (`pattern`), och bara opkoderna (`opcodes`),
  som det slås upp på. Maskat är det som följer med programmet när det länkas någon annanstans: operanden i en absolut
  instruktion (abs, abs,x, abs,y och indirekt JMP) som pekar in i $0400–$cfff, och en immediate som analysen läst som
  halvan av en sådan adress (`lda #<text`, `ldy #>text`). Kvar står opkoder, nollsidesadresser, branchoffsets, övriga
  immediates och absoluta adresser under $0400 (systemets variabler och vektorer) och från $d000 (I/O och KERNAL), som
  är desamma i alla program och skiljer rutiner åt bäst (`sta $d020`, `jsr $ffd2`). Utskriftsrutinen `ldx #0 / stx
  $d020 / sty $0286 / lda text,x / beq / jsr $ffd2 / inx / bne / rts` får `a2008e20d08c8602bd....f00620d2ffe8d0f560`.
- **Vad som lärs.** Bara namn på det som börjar en rutin: ett JSR-mål, en avbrottshanterare, programstarten, en
  användarsatt entry eller ett mål i en hopptabell (`startsRoutine`), inte en etikett inne i en rutin. Rutinen måste
  räcka för att kännas igen (`learnable`, `ROUTINE_MIN`): med maskade byte minst 8 instruktioner, 5 olika opkoder och
  14 byte som inte är maskade, annars vore den varje loop av sitt slag (`lda $xxxx,x / sta $xxxx,x / inx / bne / rts`
  kopierar vad som helst). Utan maskade byte är den samma byte överallt, och då räcker 8 byte (`bit $d011 / bpl / bit
  $d011 / bmi / rts`). En rutin har ett namn i biblioteket (ett nytt namn ersätter det gamla); samma namn kan ha flera
  varianter.
- **Igenkänningen.** `knownRoutines(A, library)` går igenom programmets rutinstarter och slår upp var och en på sina
  opkoder; den är en känd rutin när byten är desamma överallt där fingeravtrycket inte är maskat (`sameRoutine`; vad
  programmets egen analys skulle maskera spelar ingen roll). Av flera kända tas den med flest omaskade byte, sedan den
  som lärdes sist. `routineSuggestions` tar bort dem användaren redan namngett och dem som redan heter så, ger ett
  upptaget namn `_2`, `_3` … och hoppar över namn projektets assembler inte tar.
- **I appen.** `N` (eller inspektorn) på en rutin lär biblioteket den, och meddelandet säger det (*Mimir knows the
  routine now*). Förslagen visas på tre ställen, och ingenting namnges förrän användaren säger till: översikten av
  analysen (14.1b) har kortet *Known routines* med adress, namn och projektet det kom från, och *Name it* / *Name all
  N*; högerklick på rutinen har *Name it print_text (known from …)* och *Forget print_text: not this routine*, som tar
  bort namnet ur biblioteket; kommandopaletten har *Name the N routines known from other projects*. Att namnge är ett
  steg som `Ctrl+Z` tar tillbaka. *Learn the routines named in this project* i paletten lär alla rutiner som redan har
  namn i det öppna projektet (`learnProject`), för projekt från innan Mimir lärde sig. Settings → General → *Learn
  the routines I name* (på från början, `learnRoutines` i `store/ui.ts`) slår av inlärningen; det som är känt föreslås
  ändå. Biblioteket sparas per användare i appens lagring (`kr.routineLibrary`, som skriptbiblioteket), inte i
  projektet: analysen, `.asm`-filen och round-trip ser det inte, och ett projekt beror inte på det.
- **Mätt.** På 428 uppackade program ur arkivet (demos, intron och spel) har analysen 14 450 rutinstarter med 9 829
  olika fingeravtryck. Med tröskeln ovan för maskade rutiner står 1 069 fingeravtryck i minst två program (2 382
  ställen), och 233 av de 428 programmen har minst en rutin som också finns i ett annat. De vanligaste är KERNAL-
  sekvenser mot diskdriven, väntan på rasterstrålen och delar av musikspelare. Utan tröskel vore det 1 536
  fingeravtryck, men det vanligaste av dem (`lda #5 / sta $xxxx,x / lda #1 / sta $xxxx,x / sta $xxxx,x / jmp $xxxx`,
  104 program) säger ingenting om vad det gör.

Test: `packages/core/test/routines.test.ts` (fingeravtryck, utsträckning, trösklar, inlärning i ett program och
igenkänning i ett som är länkat någon annanstans, en annan omaskad byte, förslag, lagrat bibliotek) och
`apps/desktop/e2e/overview.spec.ts` (namnge, nästa projekt får förslaget i översikten, paletten och menyn, glömma,
inställningen).

### 10.6 Biblioteket (SID-musik, sprites, teckenset och bitmappar)

Det man hittar i ett program, en låt, en sprite-animation, ett teckenset, en bild, ska man kunna spara undan och titta på och
lyssna på igen, oavsett vilket projekt som är öppet. Biblioteket är därför en mapp på datorn, inte en del av projektet:
en mapp för varje sort med filer som andra verktyg också läser, och namn som säger var de hittades. Det rena (namn,
filformat, indexet) står i `packages/core/src/library.ts`; mappen läses och skrivs bara av huvudprocessen
(`apps/desktop/electron/main/library.ts`), och appen visar den (`store/library.ts`, `lib/library.ts`,
`components/Library*.tsx`).

- **Mappen.** Settings → General → *Library folder* (`libraryDir` bland verktygsinställningarna; tom: `Mimir\Library` i
  dokumentmappen, bredvid projekten). I den finns `SIDs`, `Sprites`, `Chars` och `Bitmaps`, och `library.json`. Mappen skapas först
  när något läggs till. Testerna har biblioteket i sin egen profil (`e2e/fixtures.ts`), aldrig i dokumentmappen.
- **Filerna.** En låt är en PSID (en samplingsspelare utan play en RSID), samma `.sid` som DeepSID får (`musicSidFile`,
  8.6): blockets byte med init och play, och för en snapshots spelare rutinen som lägger tillbaka det den läser utanför
  blocket. Dess tre texter är namnet, kompositören (*Author*, `<?>` när den inte anges) och varifrån den togs
  (*Released*), som HVSC:s låtar har dem (`sidWithTexts`, Latin-1, 31 tecken). Sprites är `.spr`, 64 byte var (en sista
  som inte är hel fylls ut med nollor), ett teckenset `.64c`, laddadressen först. Filer som användaren lagt i mapparna
  själv läses också: `.sid`; `.spr`, `.bin`, `.raw`; `.64c`, `.chr`, `.bin`, `.raw` (en fil som är 2 byte längre än
  hela sprites eller tecken har en laddadress först; `readLibraryFile`).
- **Bitmappar** (`packages/core/src/c64/pictures.ts`) blir en bild som ett ritprogram sparar den: bitmappen, skärmen
  (*screen matrix*), färg-RAM och bakgrunden, med programmets laddadress först. Formatet väljs i Settings → General →
  Library, ett för multicolor (*Koala Painter* `.kla`: $6000 bitmapp, $7f40 skärm, $8328 färg-RAM, $8710 bakgrund, 10003
  byte; *Advanced Art Studio* `.ocp`: $2000 bitmapp, $3f40 skärm, $4328 ram och bakgrund, $4338 färg-RAM, 10018 byte) och
  ett för hires (*Art Studio* `.art`: $2000 bitmapp, $3f40 skärm, ramen, 9009 byte; *Doodle!* `.dd`: $5c00 skärm, $6000
  bitmapp, 9218 byte) (`bitmapFormatMc`, `bitmapFormatHires`; Koala och Art Studio från början). Mappen läser alla fyra
  (`.kla`, `.koa`, `.ocp`, `.mpic`, `.art`, `.dd`, `.ddl`), också filer som lagts där för hand; en bild är multicolor
  som dess format är. Posten har bildens byte i Koalas ordning utan laddadress (`pictureData`), så samma bild i två
  format är samma byte och hittas som redan tillagd.
- **En bitmapps färger.** Dialogen letar var skärmen och färg-RAM finns i minnet (`findPictureColors`): som ett
  ritprograms fil som laddats hel lägger dem bredvid bitmappen (Koala: skärmen direkt efter, färg-RAM efter den och sist
  bakgrunden; Advanced Art Studio: bara när dess 14 oanvända byte är nollor, annars läses den som Koalas, som är mycket
  vanligare), annars skärmen som VIC visar med den ($d018 i samma VIC-bank; första raden räcker, en logga har bara sina
  rader) och som färg-RAM tabellen som programmet kopierar dit (`lda tab,x / sta $d800,x`, analysens `vic.colorRam`:
  var $d800 ligger i minnet, så `lda tab+256,x / sta $d900,x` säger också `tab`), den med flest färger i rad; för hires
  sist Art Studios (skärmen efter) eller Doodles (skärmen före) ordning. Färg-RAM tas bara där minst 900 av 1000 byte
  saknar övre nibble. Bara laddade byte som inte är kod räknas. Användaren ser bilden och kan ändra skärmens och
  färg-RAM:s adresser, bakgrunden, multicolor och formatet för just den bilden; utan adress blir det en färg för alla
  celler (Graphics-flikens färger).
- **Namnen.** Varifrån, namnet och adresserna: `Comaland side 1 - file25_1000 - music_1000 ($1000-$1fff).sid`.
  Varifrån (`librarySourceText`) är disken eller bandet filen öppnades från (medan det sitter i), filen bytena låg i och
  projektet, vart och ett en gång: ett namn som ett annat redan innehåller utelämnas, jämfört med bara bokstäver och
  siffror (projektet *Comaland* med disken *Comaland side 1*; projektet *INTRO 3 V1.0_FLA-unpacked* och filen
  *INTRO_3_V1_0_FLA-unpacked.prg* är samma namn, och projektets står kvar), diskens och filens ändelse utelämnas
  (`.d64`, `.prg`, inte en versions `.0`). Namnet görs till ett som Windows tar (`safeFileName`: inga `\ / : * ? " <
  > |`, inget `-` eller `.` först, inget enhetsnamn, högst 140 tecken med adresserna kvar när resten kortas) och unikt
  i mappen (`… (2).sid`).
- **library.json** håller det filen inte kan säga: namnet, när den lades till, var den togs (texten, projektet, filen,
  disken, adresserna), hur sprites och tecken ritas (multicolor och färger) och för en samplingsspelare dess avbrott
  (som VICE-spelaren behöver). Varje post har bytenas hash, så en fil som döpts om utanför Mimir hittar sin post igen;
  poster vars fil är borta tas bort, och en fil utan post visas som *put in the folder by hand* (`libraryItems`).
- **Lägga till.** Ett musik-, sprite-, teckenset- eller bitmappsblock: högerklick → *Add to library (SIDs/Sprites/Chars/Bitmaps)…*,
  knappen *Add to library* i inspektorn (vid *Play in VICE*, under förhandsvisningen av grafik), kommandopaletten (*Add
  the block at the cursor to the library*), och i Graphics-fliken ett urval som visas som tecken, sprites eller en
  bitmapp (med flikens färger och multicolor). Dialogen fyller i blockets namn och varifrån, en låt får också *Author*, och den visar filens namn
  medan man skriver. Finns samma byte redan (en `.sid` oavsett dess texter, `sameInLibrary`) säger dialogen det och
  knappen blir *Add again*. Meddelandet säger var filen hamnade (*Added to the library: SIDs\…*).
- **Titta och lyssna.** Knappen *Library* i aktivitetsfältet visar vyn i sidopanelen och fliken *Library* (som står i
  flikraden när den öppnats). Vyn listar allt, det nyaste först, med en bild (de första tecknen, de två första
  spritesarna, bilden) och var det togs; *All / SIDs / Sprites / Chars / Bitmaps* väljer sort och filtret letar i namn, källa och
  kompositör. En låts uppspelningsknapp, eller dubbelklick, spelar den i VICE eller DeepSID som Settings → Toolchain
  säger. Fliken visar korten, och det valda stort bredvid dem: tecknen och spritesarna med multicolor, fyra färger,
  antal per rad och zoom (sparas för det, en halv sekund efter senaste ändringen), sprites också som en animation
  (bildruta för bildruta, 2–50 per sekund, från och till), ett klick på ett tecken eller en sprite visar dess byte; en
  låts texter, adresser, init och play med *Play in VICE* och *Play in DeepSID* och, med flera låtar, vilken som startar;
  en bitmapp som bilden i de färger filen har (`pictureImage`: varje cell med sin skärmbyte och sitt färg-RAM), lika
  bred som rutan (*Fit*) eller 1–3×, med formatet och bakgrunden.
  VICE spelar en `.sid` ur biblioteket med Mimirs spelare (`sidPlayer`, 8.6): init med låten, sedan play varje
  bildruta, en RSID med de avbrott init startar. Högerklick spelar, visar filen, flyttar den till papperskorgen.
- **Ändra.** *Rename* döper om både posten och filen (`Comaland side 1 - Title tune ($1000-$1fff).sid`, en låts egen
  text också); *Move to the Recycle Bin* frågar först och flyttar filen dit (`shell.trashItem`), så den kan tas
  tillbaka. Den som döper om eller tar bort filer i Utforskaren ser det när biblioteket läses igen (knappen i vyn).
- **IPC.** `library:list`, `library:add`, `library:update`, `library:remove`, `library:reveal`, `library:pick` (13.4);
  sidan anger alltid en fil med sort och rent filnamn i sortens mapp, aldrig en sökväg, och huvudprocessen kontrollerar
  det (`isLibraryFileName`).

Test: `packages/core/test/library.test.ts` (namnen, filformaten, `.sid`-texterna, `library.json` med filer som döpts
om, ändrats och lagts dit för hand), `packages/core/test/pictures.test.ts` (de fyra bildformaten skrivna och lästa,
var en bitmapps skärm och färg-RAM hittas, showcasens logga; Spindles tre Koala-bilder lästes och skrevs byte för byte
lika och hittades som Koala när det byggdes), `apps/desktop/test/main.test.ts` (mappen: lägga till, en bitmapp i valt
format, döpa om, papperskorgen, IPC-scheman), `apps/desktop/test/library.test.ts` (vad som får läggas till, sökningen,
samma byte, bilderna, en bitmapps celler) och `apps/desktop/e2e/library.spec.ts` (också: formatet i Settings, loggan
från listningen och Graphics-fliken med skärmen $6000 och färg-RAM från `logo_colors`).

## 11. Kick Assembler-generatorn

### 11.1 Filens struktur

```
// raster-demo.prg — re-assembled by Mimir Studio
// load $0801-$37ff (12287 bytes) · entry start · Kick Assembler 5.x

#import "include/c64-hardware.asm"

// zero page
.label ptr_fb = $fb

.var music = LoadSid("music/music_1000.sid")

// ---- BASIC · $0801-$080c (12 bytes) ------------------------------
BasicUpstart2(start)                    // 10 SYS2064

// ---- Code · start · $0810-$0865 (86 bytes) -----------------------
.pc = $0810 "Code"
start:
        jsr CLRSCR                      // Clear screen and home cursor
        jsr init_screen
        sei
        lda #$00
        jsr music.init
        ...
        lda #<irq_08b7
        sta CINV                        // IRQ vector (KERNAL)
        lda #>irq_08b7
        sta CINV+1
        ...
        jmp *
```

### 11.2 Formatteringsregler

Inställningsbara: mnemonics gemener/VERSALER, hex-skiftläge, indrag (2/4/8), kommentarkolumn, byte per `.byte`-rad, adresskommentarer, hårdvarukommentarer. Etiketter står på egen rad. Varje block inleds av en sektionskommentar och, där det behövs, `.pc = $xxxx "Namn"` så att Kicks minneskarta (`-showmem`) blir läsbar.

### 11.2b Textkodningar

Ett textblock skrivs med Kick Assemblers `.encoding` och `.text` (`src/c64/text.ts`, tabellerna uppmätta med KickAss 5.25):

| Typ | `.encoding` | Skrivs som tecken |
|---|---|---|
| Text (PETSCII) | `petscii_upper` | `$20–$5d` utom `"` och `£` |
| Text (PETSCII, mixed case) | `petscii_mixed` | som ovan, `$41–$5a` som gemener, `$c1–$da` som versaler |
| Text (screen codes) | `screencode_upper` | `@` (`$00`), `A–Z`, `[`, `]`, `$20–$3f` utom `"` |
| Text (screen codes, mixed case) | `screencode_mixed` | `@`, `a–z` (`$01–$1a`), `A–Z` (`$41–$5a`), `[`, `]`, `$20–$3f` utom `"` |

Allt annat — inverterade tecken (`$80–$ff`), grafiktecken, `"`, `£`, `↑`, `←` — har inget tecken som visar samma sak
och skrivs som `.byte`, så att bygget blir byte-exakt. En screen code `$00` skrivs som `@` inne i en text men som
`.byte $00 // end` sist (ett slutmärke).

Styrkoderna i en PETSCII-text skrivs med namn i samma `.text`-rad: `.text PET_CLR + PET_WHITE + "HELLO" + PET_RETURN`.
Namnen är de som C64:ans Programmer's Reference Guide ger CHR$-koderna (bilaga C; färgerna med C64:ans namn,
`PET_LIGHT_BLUE`), med prefixet `PET_` så att de inte krockar med KERNAL-namn som `HOME` (`PETSCII_CONTROLS` i
`src/c64/text.ts`). Filhuvudet definierar dem texterna använder, i bytens ordning, som strängar med byten i:
`.const PET_CLR = @"\$93" // clear the screen` (KickAss 5.25 skriver `\$93` oförändrad i båda PETSCII-tabellerna,
uppmätt). En kod utan namn (`$0a`, `$80` …) och `$00` blir `.byte`. Med alla banker i en källa (13.9c) står
definitionerna en gång överst. I listningen är varje namn en byte att klicka på, med vad koden gör som tooltip. Mixed case väljs för text gjord för teckenuppsättningen med gemener: med
`*_upper` skulle varje versal där bli en `.byte`. Utskriven text får det av analysen när programmet skriver ut med gemener (8.5). Det inbyggda assemblerets tabeller är desamma som KickAss.jar:s, även för
tecken som skickas igenom oförändrade.

### 11.3 Specialfall som garanterar byte-exakthet

| Situation | Utdata |
|---|---|
| Absolut adressering av nollsideadress (`AD 02 00`) | `lda.abs $0002` — annars väljer assemblern zp-formen och programmet krymper |
| Zp-adressering av programetikett som definieras senare | `lda.zp label` |
| Odokumenterad opkod utan entydig Kick-mnemonic | `.byte $8b, $00 // xaa #$00 (undocumented, unstable)` |
| BIT-skip | `.byte $2c` + etikett på den gömda instruktionen |
| `JMP` till sig själv | `jmp *` |
| BASIC-stub som matchar makrot | `BasicUpstart2(start)`, annars rå `.byte` med BASIC-raden som kommentar |
| Musik | `LoadSid` + `.fill music.size, music.getData(i)` |
| Teckensnitt / bitmap | `.import binary "gfx/charset_3000.bin"` (eller inline) |
| Text | `.encoding "petscii_upper"` / `"screencode_upper"` + `.text`; PETSCII-styrkoder med namn i `.text`-raden (`PET_CLR + "HELLO" + PET_RETURN`, 11.2), tecken som inte kan citeras som `.byte` |
| Pekartabeller | `.byte <fx_0919, <fx_091a` / `.byte >fx_0919, >fx_091a` |
| Pekare i data / SMC | `label+1`, `smc_08ef+1` |
| Flera filer | En `.asm` per PRG; etiketter från andra filer deklareras som `.label` i sektionen "labels defined in other files" |

**Att validera mot Kick Assembler-versionen i produktion:** suffixsyntaxen för tvingad adressering (`.abs`/`.zp`) och mnemonic-listan för odokumenterade opkoder. Båda är inställningar i generatorn, och round-trip-steget med riktiga KickAss.jar fångar avvikelser direkt.

### 11.4 Exporterat projekt

```
raster-demo/
├─ raster-demo.asm              om-assemblerad källkod
├─ include/c64-hardware.asm     symboler (VIC, SID, CIA, KERNAL, system)
├─ music/music_1000.sid         PSID v2, laddas med LoadSid
├─ gfx/charset_3000.bin         binärdata med .import binary
├─ build.bat / build.sh         KickAss + VICE med inställningarnas sökvägar, eller användarens egen version
├─ README.md
├─ NOTES.html                   bokmärken och kommentarer med koden runt dem (bara när det finns några; eller NOTES.txt)
├─ raster-demo.mimir.json      projektet (kan öppnas igen)
├─ original/raster-demo.prg     indata
└─ out/raster-demo.prg          verifierad om-assemblerad PRG
```

**Filnamnen** kommer ur filernas namn (`sourceStem`). Filändelsen tas bort, och varje följd av andra tecken än
bokstäverna A–Z, siffror, `_` och `-` blir ett `_`. Ett namn börjar aldrig med `-`, eftersom assemblerns kommandorad
(byggskripten och appens bygge) läser `-x.asm` som en flagga: 64tass vägrar, och appens bygge avvisar namnet. Ett
inledande `-` tas därför bort, tillsammans med de `_` som stod för mellanslagen efter det. Booze Designs "- THE DEMO -"
blir alltså `THE_DEMO_-.asm`; förut blev det `-_THE_DEMO_-.asm`, och Verify misslyckades efter Unpack. Blir inget kvar
heter källan `file0`, `file1` och så vidare. Projektets namn (`projectNameFor`) och en cartridges källa (`crtBase`)
följer samma regel (`safeStem`).

**Byggskripten** genereras från verktygsinställningarna (`buildScripts`). I källvyn kan `build.bat` och `build.sh`
redigeras, men inte de andra filerna, som kommer ur listningen. Ändringen sparas i projektet (`Project.scripts`, en
stund efter sista tangenttrycket och när man byter fil) och ångras med `Ctrl+Z`. Exporten skriver då den versionen
(`projectScripts`), och det andra skriptet förblir genererat. Är texten åter lika med den genererade tas ändringen
bort. *Restore generated* gör det direkt, och skriptet följer sedan inställningarna igen. Appens egen Build & Run
använder alltid verktygsinställningarna, inte skripten. Skripten kan också göras från en byggmall (11.4b); en ändring i
källvyn går då före mallens text, och knappen heter *Restore template*.

**NOTES.html** (`notesDocument` i core) är ett självständigt dokument utan externa resurser, med ljust och mörkt tema och utskriftsläge. Det skrivs bara när projektet har bokmärken eller egna kommentarer. Huvudet visar projektnamn, filer, källfiler och exporttid, och README nämner filen. Därefter kommer två delar:

- **Bokmärken** sorteras efter adress och har en innehållsförteckning. Varje bokmärke visar titel och anteckning, etiketten (`namn` eller `namn+n`), blocket och filen med radnummer. Under det står ett kodutdrag ur den exporterade filen: etiketten och kommentarraderna ovanför, raden markerad och upp till sex rader av blocket efter. Utdraget har radnummer, adress, bytes och samma syntaxfärger som listningen. Ett bokmärke utanför de laddade filerna står kvar, märkt *not in the exported source*.
- **Kommentarer** listar kommentarer ovanför block, kommentarrader och kommentarblock samt kommentarer i slutet av en rad, efter adress. Varje kommentar visar sin typ, plats och kodrad. En kommentar som källkoden inte har med (till exempel mitt i en `.byte`-rad) utelämnas.

**NOTES.txt** (`notesText`) innehåller samma sak som ren text: rubrik, fakta, en innehållsförteckning och sedan bokmärkena och kommentarerna. Anteckningarna är indragna under rubriken. Kodraderna står som `.asm`-filen skriver dem, med radnummer, adress och bytes framför, och `>` markerar bokmärkets rad. Inställningen *Bookmarks and comments in the export* (fliken Kick Assembler output, `Settings.notesFormat`) väljer `html` (standard), `txt` eller `none`. Den sparas i projektet som de andra utdatainställningarna, och README nämner den fil som skrivs.

Allt räknas fram ur `RenderResult.fileLines`, så radnummer och kodrader är exakt de i `.asm`-filerna (`lineHtml` ger samma text som `lineText`, vilket testas för alla inställningar). Båda formaten byggs från samma underlag (`collect` i `notes-doc.ts`).

### 11.4b Byggmallar

En **byggmall** (`BuildTemplate`, `packages/core/src/build-template.ts`) är `build.bat` och `build.sh` med
platshållare som Mimir fyller i för varje projekt, så att samma mall fungerar i alla projekt. De genererade skripten är
själva originalmallen ifylld (`originalTemplate`, `renderTemplate`): `buildScripts` gör så, och testerna kontrollerar
att resultatet är detsamma som förut för Kick Assembler och 64tass, med och utan cartridge (bara det dubbla mellanslag
ett tomt argument lämnade är borta).

**Platshållarna** (`TEMPLATE_PLACEHOLDERS`) är kända namn inom klamrar:

| Platshållare | Blir |
|---|---|
| `{source}` | en rad med den skrivs en gång för varje källa bygget assemblerar, i ordning, med källans namn utan `.asm` |
| `{name}` | programmet: den första källan, vars PRG VICE startar |
| `{out}` | utdatamappen (inställningarna) |
| `{labels}` | VICE:s etikettfil utan `.vs` (cartridgens källa när alla banker är i en, 13.9c) |
| `{start}` | det VICE startar: `-autostart out\<namn>.prg`, eller `-cartcrt out\<namn>.crt` |
| `{cart}` | cartridgens image, `<namn>.crt` (källan är `{cart}.asm`); en rad med den tas bort utan cartridge |
| `{entry}` | var Exomizers sfx startar programmet (`sfxEntry`): `sys` när första BASIC-raden har en SYS, `basic` för ett BASIC-program utan, annars `0x<adress>`: programstarten användaren satt, eller första filens laddadress |
| `{java}`, `{kickass}`, `{tass}`, `{vice}`, `{exomizer}` | verktygen i inställningarna (`{tass}` och `{exomizer}` utan sökväg: `64tass`, `exomizer`) |
| `{kickArgs}`, `{tassArgs}`, `{viceArgs}` | argumenten i inställningarna |

Ett tomt värde tar mellanslaget före sig med sig (`-a -C --cbm-prg {tassArgs} -o` blir `-a -C --cbm-prg -o`). En rad
med en platshållare som projektet inte har något värde för (`{cart}` utan cartridge) skrivs inte. Efter ett `$` är det
skalets (`${name}` står kvar), och andra ord inom klamrar är inga platshållare. `build.bat` får CRLF, `build.sh` LF; i
`build.sh` blir `{entry}` aldrig `$c000`, som skalet skulle läsa som en variabel (Exomizer läser `0x`).

**Mimirs egen mall** *Pack with Exomizer* (`BUILT_IN_TEMPLATES`, `builtInTemplate`) assemblerar källorna, packar
`out\<namn>.prg` med Exomizer till en självuppackande `<namn>-exo.prg` (`"%EXOMIZER%" sfx {entry} -o
{out}\{name}-exo.prg {out}\{name}.prg`) och startar den i VICE. Den görs av samma rader som originalet och följer
projektets assembler; den redigeras inte, men *Duplicate* gör en egen kopia. Den är för ett program: med en cartridge går
den inte att välja. Testat på riktigt (`build-template.test.ts`): den exporterade `build.bat` körd med KickAss.jar och
Exomizer ger en packad fil som VICE (headless, debug-cartridge) packar upp och kör till rätt kontrollsumma, för ett
program med SYS (`sfx sys`) och ett på `$1000` utan BASIC (`sfx 0x1000`).

**Användarens mallar** hålls av appen (`localStorage` `kr.buildTemplates`, `store/buildTemplates.ts`), som skriptens
bibliotek, för alla projekt. Ett projekt som använder en mall har en kopia av den (`Project.buildTemplate`, i
`.mimir.json`), så exporten, CLI:n och en annan dator gör samma skript (`templateScripts`, `projectScripts`); README
nämner mallen. En inbyggd mall i projektet görs om för projektets assembler; en användares står som den sparades
(`assembler` säger vilken assembler den gjordes för, och redigeraren påpekar när projektet har en annan).

**I källvyn** har `build.bat` och `build.sh` en väljare *Build template*: *Generated (the settings)*, Mimirs mallar och
användarens (och projektets kopia av en mall som biblioteket inte har). Att välja en mall gör båda skripten av den och
tar bort användarens ändringar av dem (ett steg, `Ctrl+Z` tar tillbaka dem). *Templates…* öppnar **mallredigeraren**
(dialogen *Build templates*): mallarna till vänster (*Mimir’s*, *Yours*, *in use* på projektets), den valda till höger
med namn, `build.bat`/`build.sh`, *Template* eller *Filled in for <projekt>* (skriptet projektet får, skrivskyddat) och
en Monaco-editor där platshållarna är markerade och har en hovring. *Placeholders* listar dem, och ett klick skriver
en där markören står. **New template** klistrar in originalets `build.bat` och `build.sh` för projektets assembler (med
cartridgens rad när projektet har en), under ett nytt namn (*My build*, *My build 2* …). Texten sparas medan man skriver;
namnbyte med Enter (namnet måste vara unikt). *Duplicate*, *Delete…* (projektet behåller sin kopia) och *Use in this
project*. Ändras mallen projektet använder följer projektets kopia med när redigeraren stängs (ett steg); är
projektets kopia äldre än bibliotekets (ändrad för ett annat projekt) heter knappen *Update this project’s copy*.
Kommandopaletten har *Build templates*, *New build template from the original build.bat and build.sh*, *Build scripts:
pack the program with Exomizer …* och *Build scripts: generated from the settings again*.

### 11.5 Block utanför bygget

Ett block kan lämnas utanför bygget (högerklick → *Block* → *Exclude block from the build*, inspektorns *Include in the build*,
kommandopaletten; `Project.excluded` håller blockens startadresser). Det står kvar i källkoden:

```
// ---- Curve table · sine_09b5 · $09b5-$0ab4 (256 bytes) · excluded from the build ----
#if INCLUDE_sine_09b5
sine_09b5:
        .byte …
#else
.label sine_09b5 = $09b5          // alla etiketter i blocket, för koden som använder dem
#endif
```

Filens huvud listar `// #define INCLUDE_sine_09b5` för varje sådant block: ta bort `//` så byggs det igen. Nästa block
får alltid en egen `.pc`. Den byggda PRG:n saknar blockets byte; ligger blocket mitt i fylls luckan med `$00` (som Kick
Assembler gör), först eller sist börjar respektive slutar filen vid närmaste byggda byte. Verifieringen (inbyggd och
KickAss.jar, `comparePrg(…, skip)`) jämför bara de byggda byten och rapporterar hur många som lämnades utanför; det inbyggda
assemblerets preprocessor klarar `#define`, `#undef`, `#if`/`#elif`/`#else`/`#endif` med `!`, `&&`, `||` och parenteser.

### 11.6 Block som binärfil

Inspektorns *Save as a binary file*, högerklick → *Block* → *Save block as a binary file (.import binary)* eller kommandopaletten
sparar ett block som en egen fil (`project.binary`, blockens startadresser, sparas i projektfilen). Exporten skriver då
blockets byte till `data/<etikett>.bin` (`data/block_xxxx.bin` utan etikett), och källkoden laddar den:

```
sine_09b5:
        .import binary "data/sine_09b5.bin"   // 256 bytes · Curve table
```

Mappen heter `data/` och inte `bin/`. `bin` är utdatamappen i många C64-miljöer, och Sublime Text-paketet *Kick
Assembler (C64)* tömmer den före varje bygge (`kickass_empty_bin_folder_before_build`, på som standard). En binärfil där
raderades alltså innan KickAss hann läsa den ("Can't open file").

Det fungerar för alla blocktyper, även kod. Etiketter inne i blocket som annan kod använder definieras som
`.label namn = $xxxx`, så att `jsr sub_0866` fortfarande fungerar. Det gäller bara etiketter som källkoden i samma fil
faktiskt refererar till (andra filer definierar sina egna). En etikett som bara används inne i blocket får ingen
`.label`. Det gäller också en adress som koden når som I/O-register: ett stort block över `$d000-$dfff`, som en
minnesdump, får etiketter som `charset_d011` från analysen, men koden skriver `sta VIC_SCREEN_CTRL1`. CPU-vektorerna
`$fffa-$ffff` behåller också alltid sina namn (`sta IRQ_VECTOR`, eller `sta $fffe` med kommentaren *Hardware IRQ/BRK
vector* vid riktiga adresser), även när programmets egna byte täcker dem. En läsning av RAM under KERNAL efter `$01 = $35`
(till exempel `lda charset_eaa5`) är däremot en riktig dataläsning och behåller sin etikett. Står blocket också utanför bygget (11.5) finns
definitionerna även i `#else`-grenen. Ett binärt musikblock laddas inte med `LoadSid`, och referenser till det skrivs med
etiketter i stället för `music.init`/`music.play`. Blockrubriken visar *binary* och filens namn, och den exporterade
README:n listar filen. Fuzz-testet sparar slumpvisa block som binärfiler (även tillsammans med utelämnade block), och
den riktiga KickAss.jar bygger demon byte för byte med kod-, tabell-, teckenuppsättnings- och musikblock som binärfiler.

### 11.7 Skräp

Byte som användaren kallar skräp lämnas utanför allt, till skillnad från *Exclude from the build* (11.5): ingenting av
dem står i `.asm`-filen, varken under `#if`, som `#define` i filens huvud eller som `.label`. Skräp är ett område, inte
ett block: det kan börja och sluta var som helst, ta flera block hela och kapa dem i sina ändar. Det markeras med

- högerklick → *Mark selection as* (eller *Mark from here as*, från raden till blockets slut) → *Junk (left out of
  everything)*, direkt;
- högerklick → *Block* → *Mark selection as junk* för en markering, *Mark block as junk* annars, direkt;
- **Mark range as junk…** (högerklick → *Block*, kommandopaletten, *+* i Explorers *Junk*, inspektorns knapp *Junk…*):
  en dialog med start och slut (slutet ingår; hex eller en etikett), ifyllda från markeringen, annars från markören
  till blockets slut (inspektorns knapp: markeringen, annars blocket). Den säger innan något ändras hur många laddade
  byte som blir skräp, vilka block som försvinner hela, vilka som kapas och vad av dem som står kvar, och vilket skräp
  området slås ihop med. *Mark as junk* eller Enter markerar.

Området kortas till de byte som är laddade eller redan skräp (`$0700-$0900` i ett program från `$0801` blir
`$0801-$08ff`), så ett nytt program som laddas i en lucka inte blir skräp. `junkPlan` i `packages/core/src/junk.ts`
räknar ut allt det här, och samma kontroller gäller alla vägar. Efter markeringen står markören på byten efter skräpet,
och listningen visar den raden där skräpet började på skärmen. `Project.junk` håller områdena som `{start, end}` (end
exklusivt), sorterade, och ett nytt område slås ihop med dem det överlappar eller rör (`addJunk`). Byte i ett relocerat
block (där det laddas eller körs) kan inte bli skräp.

Analysen tar skräpet som inte laddat (`dropJunk` i `analyze/memory.ts`, efter filerna och före de relocerade blocken):
ägaren blir `-1` och byten läses som `$00`. Inget spåras, klassas eller namnges där, ett block som skräpet täcker en del
av delas, och listningen visar inga rader för det. Kod som läser eller hoppar dit skriver adressen som den är (`lda
$09b5,x`), som för allt annat som inte laddas; användarens etiketter, kommentarer och bokmärken där står kvar i projektet
och kommer tillbaka med byten. Analysens logg säger `$09b5-$0ab4 is junk: left out (256 bytes)`.

Blocket efter skräpet får en egen `.pc`. Skräp mitt i en fil blir en lucka som Kick Assembler fyller med `$00`; först
eller sist börjar respektive slutar utdata vid närmaste byte som inte är skräp, och filens huvud säger det
(`load $0801-$2fff`). Låg ett block som exporten skriver till en egen fil där (en teckenuppsättning i `gfx/`) skrivs den
inte. `RenderResult.excluded` har skräpet med `junk: true` och utan namn, så verifieringen (inbyggd och KickAss.jar)
jämför bara resten, som för block utanför bygget.

Explorer får sektionen *Junk* när projektet har skräp: ett område per rad med adresser, storlek och de första byten som
filerna har dem (verktygstipset har fler). Ett klick går till listningen där området satt (byten efter det, annars före).
*Include again* (ångra-pilen) sätter tillbaka ett område och ramar in det i listningen, knappen i sektionens rubrik
alla (även kommandot *Include all junk again*). Det går bara här, i editorn: den exporterade källkoden har inget att
ta bort `//` framför. Allt ångras med `Ctrl+Z`.

### 11.8 64tass

*Settings → Assembler output → Assembler* väljer vilken assembler källan skrivs för: **Kick Assembler 5.x** (standard)
eller **64tass 1.57** (Turbo Assembler-syntax). Valet (`Settings.assembler`, `kick` eller `64tass`) sparas i projektet som
de andra utdatainställningarna, och ett nytt projekt tar det från det förra. Listningen, källfliken, exporten, NOTES,
F7, Build & Run, Pack, drivkodsfliken och cartridges följer det: det är samma radmodell (`Line[]`), bara stavningen av
en del rader skiljer (`render/dialect.ts`). Allt för 64tass är skrivet för 64tass körd med **`-a`** (ASCII-källa: 64tass
PETSCII-tabeller) och **`-C`** (skiftlägeskänsliga namn); filhuvudet säger det (`· 64tass 1.57 (-a -C)`).

| Kick Assembler | 64tass |
|---|---|
| `// kommentar`, `/* … */` | `; kommentar`, `.comment` … `.endc` (en rad som skulle avsluta blocket får `;` före sig) |
| `.pc = $0810 "Code"` | `* = $0810 ; Code` (namnet som kommentar: den inbyggda assemblerns minneskarta) |
| `.label ptr = $fb`, `.const PET_CLR = @"\$93"` | `ptr = $fb`, `PET_CLR = $93` |
| `#import "include/c64-hardware.asm"` | `.include "include/c64-hardware.asm"` (filen med `NAMN = $d020 ; beskrivning`) |
| `BasicUpstart2(start)` | `* = $0801`, `.word (+), 10`, `.null $9e, format("%d", start)`, `+`, `.word 0` (som 64tass manual skriver BASIC-raden) |
| `.var music = LoadSid("music/music_1000.sid")`, `.fill music.size, music.getData(i)` | `music .namespace` som läser .sid-filen med `binary()` som LoadSid gör (huvudets fält big-endian, laddadressen före datan little-endian): `music.location`, `.init`, `.play`, `.size`, `.data`; i kroppen `* = music.location` och `.text music.data` |
| `.import binary "gfx/…"` | `.binary "gfx/…"` |
| `.pseudopc $c000 {` … `}` | `.logical $c000` … `.here` (samma paus och återupptagning som i Kick, fast 64tass kan nästla) |
| `#if INCLUDE_x` / `#else` / `#endif`, `// #define INCLUDE_x` i huvudet | `.if INCLUDE_x` / `.else` / `.endif`, `INCLUDE_x = false` i huvudet (sätt `true` för att bygga blocket) |
| `lda.abs $0002` | `lda @w $0002`; `.zp` behövs inte: 64tass tar zero page för en etikett under `$100` själv, definierad före eller efter (det går om pass tills storlekarna står still) |
| `.encoding "petscii_upper"` … `.text PET_CLR + "HELLO"` | `.enc "none"` … `.text PET_CLR, "hello"` |

**Texterna** skrivs med 64tass egna `none` och `screen` (med `-a`, uppmätta tecken för tecken med 64tass 1.57.2900): de
oskiftade bokstäverna (`$41–$5a` i PETSCII, `$01–$1a` i skärmkoder, versaler i C64:ans första teckenuppsättning) är
`a–z` i källan, de skiftade `A–Z`. En text för versalteckensnittet står alltså med gemener, `.text "hello world"`, som
64tass-användare skriver den. `£`, `↑` och `←` (som Kick skriver som `.byte`) står som tecken; `"` och tecken utan
motsvarighet blir `.byte`.

**Odokumenterade opkoder** skrivs med 64tass namn (`isb`, `asr`, `sbx`, `ane`, `sha`, `shs`, `lds`, de andra som
Mimirs) och filen får `.cpu "6502i"` överst när den har någon. 64tass ger samma byte för 221 av de 256 opkoderna
(uppmätt: varje opkods mnemonic och läge assemblerat för sig), också de instabila; de andra (`nop`-varianterna utom
`$ea/$04/$14/$0c/$1c/$80`, `jam` utom `$02`, `anc $2b`, `sbc $eb`) blir `.byte` med instruktionen som kommentar
(`OpcodeInfo.tass`, `TASS_ENC`).

**Etiketter.** 64tass tar ett namn som börjar med `_` som lokalt för etiketten före (uppmätt: `jmp _loc` efter en annan
etikett är "not defined"), och namnen generatorn själv använder (`binary`, `len`, `format`, `size`, `true`, `false`) och
64tass mnemonics kan inte vara etiketter. Byte av namn (`N`) vägrar dem när projektet är för 64tass ("not a valid
64tass label"), och en etikett som redan har ett sådant namn (från Kick-tiden) blir ett fel i Problems
(`labelFor`).

**Den inbyggda 64tass-assemblern** (`verify/tass-subset-assembler.ts`, `assembleTass`) verifierar (F7, fuzz-testet, CLI:t)
det generatorn skriver, som 64tass 1.57 med `-a -C`: etiketter i början av raden (`namn:`, `namn`), `namn = värde`,
`namn := värde`, de anonyma `+` och `-`, `* =` (inne i `.logical` flyttas byten med), `.logical`/`.here`,
`.if`/`.elsif`/`.else`/`.endif`, `.namespace` och `.block` (läses som `namn.etikett`, en namnrymd kan öppnas igen),
`.include`, `.cpu`, `.enc`, `.cdef`, `.byte`, `.word`, `.text`, `.null`, `.fill`, `.binary`, `.cerror`,
`.comment`/`.endc`, `@w`/`@b`, och uttrycken: tal, strängar, `*`, `<`/`>` över hela uttrycket efter sig (som 64tass),
aritmetik, bitoperatorer, jämförelser, `? :`, listor, bytesträngar indexerade, med listor och skivade
(`sid[[7, 6]]`, `sid[offset + 2:]`), `binary()`, `len()` och `format()`. Flera pass tills storlekarna står still.

**Riktiga 64tass** (`run64tass`) körs som `64tass -a -C --cbm-prg <extra> -o out/<namn>.prg --vice-labels -l
out/<namn>.vs <namn>.asm` i byggmappen (utdatamappen görs först: 64tass gör den inte själv); en cartridges egen källa
(`<namn>.crt.asm`) med `--nostart -X`, avbildningen som den är från offset 0. Felraderna `fil:rad:kolumn: error: …`
(med `note:` efter) blir Problems-poster och markörer i Monaco (`parseTassOutput`). *Settings → Toolchain → 64tass*
säger var den finns: installationen har med **64tass 1.57.2900** (`resources\64tass`, GPL-2.0 med sina licensfiler,
`vendor/64tass/README.md` säger var källkoden finns), och inställningen pekar dit om användaren inte valt en annan; i ett
utvecklingsbygge den som hittas i `C:\C64` (två mappnivåer ner, som releasen packas upp), `TASS64` eller `PATH`.
*Extra 64tass arguments* läggs till Mimirs egna.

**Cartridges.** En källa per chip och avbildningens källa: `* = 0`, en egen ASCII-kodning (`.enc "ascii"`,
`.cdef " ~", 32`) för huvudet och varje `"CHIP"`, chipens PRG:er med `.binary "out/<chip>.prg", 2` och `.cerror * -
chip0 != <storlek>`. Alla banker i en källa (13.9c): 64tass har inga segment, så avbildningen skrivs som den ligger:
huvudet, sedan varje CHIP-paket med chipets kod där den körs (`.logical $8000`), i bankens namnrymd (`bank03
.namespace`, för bankens nästa chip `.namespace bank03`). Riktiga 64tass bygger fixturens cartridge byte för byte på båda
sätten, med varje banks etiketter (`al 8009 .bank00:start`).

**Pack a file** (13.8b) gissar vilken assembler en vald källa är skriven för (`guessAssembler`: Kicks `//`, `#import`,
`.pc`, `.label`, `BasicUpstart2` mot 64tass `;`, `* =`, `.include`, `.logical`, `.enc` …) och visar valet (*Assembled
with*), som användaren kan ändra. CLI:t: `--assembler kick|64tass`, och `mimir verify … --64tass [exe]` bygger också med
riktiga 64tass.

**Skript och patchar** (10.2, 10.3) skrivs i projektets språk: en patch eller ett skript får det språk projektets
assembler har när det görs (`Patch.lang`, `UserScript.lang`: `kickass` eller `64tass`, `code-lang.ts`) och behåller
det, så ett skript i Kick Assembler assembleras fortfarande som Kick i ett projekt som bytts till 64tass (och tvärtom);
skriptbiblioteket har språket med sig. Kod i 64tass assembleras av den inbyggda 64tass-assemblern med programmets namn,
som riktiga 64tass läser den (uppmätt): en mnemonic med gemener i början av raden är instruktionen, ett annat ord där
en etikett (med eller utan kolon); `_namn` är lokal till kodetiketten före (en konstant öppnar ingen ny) och nås som
`loop._namn`; `.warn` skriver ut (i skriptets utdata som Kicks `.print`) och `.error` stoppar. Varje rads adress i
patchdialogen kommer från assemblern (`linePcs`): en etikett av Mimirs före varje rad, som för Kick, skulle bli den som
de lokala etiketterna hör till. Patchdialogen läser raderna i patchens språk (kommentaren, etiketten i början), och en ny
patch får listningens rader i projektets språk (med `.cpu "6502i"` när de har en odokumenterad opkod). Exporten skriver
varje patch för projektets assembler (`patches/<namn>.asm`: `64tass -a -C --cbm-prg -o <namn>.prg <namn>.asm`, namnen
som `namn = $xxxx`); en patch i det andra språket som sina bytes, med koden som kommentar. Ett skripts kopior av block
till scratchpads (koden som listningen skriver den: `; etikett:`, `PET_RETURN = $0d`, `.enc "none"`, `.cpu "6502i"`),
scratchpadarnas startinnehåll, bevakningslistan (`sta @w $0400,x`), *Also write into a scratchpad*, editorns förslag
(64tass direktiv och funktioner, `;`, en etikett utan kolon) och färgningen (`tass64`) följer skriptets språk.

**Mallarna** (10.3) är skrivna i Kick Assembler och skrivs som 64tass när skriptet görs i ett 64tass-projekt
(`templateSource`, `kickToTass` i `code-convert.ts`): `//` blir `;`, `.var`/`.const` blir `namn = värde` (med
likhetstecknet där det stod), `!:`/`!+` de anonyma `+` (och `-` när en `!-` går bakåt), `.if (…) { } else { }` blir
`.if`/`.else`/`.endif`, `.if (…) .error "…"` blir `.cerror (…), "…"`, `lda.abs` `lda @w`, de odokumenterade opkoderna
får 64tass namn och `.cpu "6502i"`. Testerna kör varje mall i båda språken (samma körningar, samma byte) och bygger
dem med riktiga 64tass.

**Write in 64tass.** Ett skript i Kick Assembler i ett 64tass-projekt visar sitt språk markerat bredvid kontrollen, och
knappen *Write in 64tass* skriver om koden och scratchpadarnas startinnehåll (`kickToTass`). Skriptet flyttas bara när
det ger samma byte på samma adresser och startar på samma ställe (`scriptIn64tass`); det som inte går att skriva om
(`.for`, makron, funktioner, texter, tecken inom `' '`, namngivna `!`-etiketter) sägs med sin rad, och skriptet stannar
i Kick Assembler. Patchdialogen har samma knapp för en patch i Kick Assembler (`patchIn64tass`: samma byte över
intervallet). Ctrl+Z tar tillbaka det.

**Uppmätt:** riktiga 64tass bygger alla integrationsfall (demot i alla inställningsvarianter, binära block, snapshots,
showcasen, texter i alla kodningar, PETSCII-styrkoder, utelämnade block och skräp, relokerade block, alla opkoder,
zero page, slumpprojekt) byte-exakt, och den inbyggda 64tass-assemblern också; fuzz-testet tar Kick och 64tass om vartannat.

## 12. Round-trip-verifiering

Verifieringen är produktens kvalitetsgrind:

1. `render()` producerar alla filer i minnet.
2. **Produktion:** huvudprocessen skriver dem till en temporär mapp och kör `java -jar KickAss.jar main.asm -odir tmp -showmem`. **Prototypen:** en inbyggd assembler för exakt den Kick-delmängd som generatorn skriver (`#import`, `.pc`/`*=`, `.label`, `.var`, `.byte`, `.word`, `.text`, `.encoding`, `.fill` med uttryck, `.import binary`, `LoadSid`, `BasicUpstart2`, alla adresseringslägen, `.abs`/`.zp`, flerpass-upplösning).
3. Resultatet jämförs byte för byte med originalfilen, inklusive start- och slutadress.
4. Avvikelser visas i Build output och Problems med adress, förväntat och faktiskt värde; klick hoppar till raden.
5. Exporten markeras verifierad och statusraden visar "✓ round-trip verified". Ändras projektet blir resultatet inaktuellt.
6. F7 (och Export och Build & Run, som verifierar först) väntar tills analysen av den senaste ändringen är klar. Varje
   analysresultat bär med sig projektet det gäller, och verifieringen startar först när det är samma projekt som i
   lagret. Annars kunde F7 direkt efter en ändring verifiera läget före ändringen, och resultatet visades som inaktuellt
   ("round-trip not verified") så fort den nya analysen kom. Det märktes på en belastad dator.

**Testat i prototypen:** demoprogrammet (12 287 byte) är byte-identiskt, och 1 500 slumpgenererade program (slumpdata, slumpkod, olika laddadresser, slumpade overrides och inställningar) passerar round-trip utan avvikelser.

## 13. VICE- och toolchain-integration

### 13.1 Inställningar

Dialogen **Settings** (Ctrl+,) har sina sidor i en lista till vänster, i tre grupper efter var inställningarna sparas:
**App** (*General*: startskärmen, översikten efter analysen, uppackning när filen öppnas, grafik som bilder, auto merge,
inspektorn och disken och bandet i Explorer; sparas av appen), **Project** (*Analysis* och *Assembler output*; sparas i
projektet, och en fil som öppnas härnäst behåller dem) och **Toolchain** (sparas av appen, för alla projekt; tabellen
nedan): *Assemblers* (Java, KickAss.jar, 64tass, utdatamappen), *VICE & music* (VICE, dess quicksave, var musikblock
spelas), *Debuggers* (Shift+F5, Retro Debugger, C64 Debugger) och *Packers & editor* (den externa uppackaren, Exomizer,
den externa editorn). En sida har rubriker för sina delar, och varje inställning har en rad som säger vad den gör; resten
av förklaringen ligger bakom *More*. Sökrutan överst letar i alla sidor: de inställningar där varje ord som skrivits finns
(i namnet, raden, *More*, ett val, delens eller sidans namn) visas under sin sida med orden markerade, *More* är öppen där
ordet står, listan visar antalet träffar per sida, och en sidrubrik går till sidan. Esc tömmer rutan innan det stänger
dialogen. Dialogen öppnas på sidan den senast stod på medan appen körs, först *General*; ↑ ↓ byter sida i listan. Ett
fönster under 720 px har sidorna på en rad över sidan. Meddelanden som säger *Settings → Toolchain* pekar på gruppen.

| Inställning | Standard (Windows) | Användning |
|---|---|---|
| Java | `java` | Körs med `-jar` |
| KickAss.jar | `C:\C64\KickAssembler\KickAss.jar` | Kick Assembler 5.x |
| Extra Kick-argument | `-vicesymbols -showmem` | Etikettfil för VICE, minneskarta |
| 64tass | den medföljande 64tass 1.57.2900 (`resources\64tass\64tass.exe`); i ett utvecklingsbygge den som hittas i `C:\C64`, `TASS64` eller `PATH` | Bygger ett projekt skrivet för 64tass (11.8) |
| Extra 64tass-argument | tomt | Efter Mimirs egna `-a -C --cbm-prg`, utdatan och `--vice-labels -l` |
| VICE | `C:\C64\VICE\bin\x64sc.exe` | Cykelexakt C64-emulering |
| Extra VICE-argument | `-autostartprgmode 1` | Laddar PRG direkt i minnet |
| Bygg och kör i en debugger (Shift+F5) | Retro Debugger | Retro Debugger eller C64 Debugger (13.2b) |
| Retro Debugger, C64 Debugger | tomma | Deras `C64Debugger.exe` |
| Extra argument för Retro Debugger, C64 Debugger | tomma | Till exempel `-layout <id>` |
| Retro Debugger väntar före start | 3000 ms | `-wait`: C64:an ska stå vid READY när programmet laddas |
| Utdatamapp | `out` | |
| Extern uppackare | tom: Sindri, den inbyggda uppackaren | Ett externt verktyg (unp64) som packar upp packade PRG:er i stället för den inbyggda (8.11b) |
| Den externa uppackarens argument | `{in}` | `{in}` = den packade PRG:n, `{out}` = ett namn för resultatet; exomizer: `desfx -o {out} {in}` |
| VICE quicksave snapshot | tom: `C64SC.vsf`/`C64.vsf` i VICE:s inställningsmapp (`%APPDATA%\vice`) | Filen som Alt+F11 i VICE skriver och F9 öppnar (13.7b) |
| Exomizer | den medföljande Exomizer 3.1.1 i installationen (`resources\exomizer\exomizer.exe`); i ett utvecklingsbygge den som hittas i `C:\C64` (och `win32\` i undermappar), `EXOMIZER` eller `PATH`, annars tom | Packar det byggda programmet i vyn Pack (13.8) |

### 13.2 Bygg och kör (F5)

1. Spara/exportera projektet till projektmappen (eller temporär mapp).
2. `java -jar KickAss.jar main.asm -odir out -vicesymbols -showmem` (ett projekt för 64tass: `64tass -a -C --cbm-prg -o out/main.prg --vice-labels -l out/main.vs main.asm`, 11.8).
3. Parsa stdout/stderr. Kicks felrader (`Error: … at line N, column M in file.asm`) blir Problems-poster och Monaco-markörer på rätt rad.
4. Round-trip-jämförelse (12).
5. `x64sc -autostartprgmode 1 -moncommands out/main.vs -autostart out/main.prg` — etiketterna finns direkt i VICE-monitorn.
   Har användaren satt en programstart (8.2) laddas PRG:n utan RUN och VICE skriver `sys <start>`:
   `x64sc -autostartprgmode 1 -moncommands out/main.vs -autoload out/main.prg -keybuf "sys2150\n"` (VICE läser `\n` som RETURN).
   Det kräver PRG-läget inject eller diskavbild; läget virtuellt filsystem laddar via tangentbordsbufferten, så
   `-autostartprgmode 0` ersätts då med 1. Bara den första filen körs; ligger starten i en annan fil startas den med RUN.
   En PRG som skriver över BASIC:s och KERNAL:s arbetsminne `$0002-$03ff` (zero page, stack, buffertar, vektorer;
   till exempel en minnesdump) lämnar inget BASIC att skriva `sys` i, och RUN fungerar inte heller. Då stannar VICE
   vid READY och kör monitorkommandon i stället: `x64sc -autostartprgmode 1 -moncommands out/main.start.mon -initbreak ready`,
   där `main.start.mon` är etiketterna följda av `bank ram`, `l "out/main.prg" 0`, `bank cpu` och `g <start>`. PRG:n
   laddas på sin adress rakt in i RAM, också under I/O-området och ROM:arna, som `-autoload` gör för en PRG som startas
   med `sys`. En minnesdump har RAM där: ett program som Sindri sparat (8.11b) kan gå till `$ffff` med programmets data
   på `$d000-$dfff`. Förut laddades den genom CPU:ns vy, som `LOAD"…",8,1` gör, och de byten hamnade i VIC, SID, CIA och
   färg-RAM i stället (Cybernoid II +17HDF, `$0208-$ffff` med start `$1400`, kraschade med lila skärm; nu visar den sin
   trainermeny). Med en disk i station 8 sätts först den senast använda enheten `$ba` till 8, som när programmet laddats
   från disken (vid READY efter start är den 0): ett program som laddar sin nästa fil från "enheten det kom ifrån" tar
   den därifrån (Cybernoids high score-lista). En dump som själv har `$ba` laddas över den.
   Utan programstart varnar appen för en sådan PRG och ber användaren sätta en.
   Från monitorn startas också en PRG som täcker skärmen vid READY, `$0400-$07e7` (`startsFromMonitor`): det som
   skrivs vid READY (`sys <start>`, diskinitieringen) och READY själv hamnar i de byten. Cybernoid 2:s spel som Sindri
   sparat (`$0400-$ffff`) startade med `sys` på en skärm full av `e`; laddat från monitorn visar det sin titelbild.
   Med en disk skriver VICE först diskinitieringen och `sys679` vid READY, med ingenting laddat än, och stannar där
   (`-initbreak 0x02a7`, innan något på `$02a7` körs; brytpunkten gäller bara den gången) och kör monitorkommandona,
   som laddar programmet över det som skrevs: `-keybuf "open15,…:close15:sys679\n" -moncommands out/main.start.mon
   -initbreak 0x02a7`.
   **`$01` vid start.** Satte *Unpack* programstarten och såg Sindri ett annat värde än `$37` i `$01` där
   (`Project.entryPort`, sparas i projektfilen), startar Build & Run programmet med det: ett spel som Sindri sparat kan
   starta under BASIC-ROM:et (Cybernoid 2 på `$a2ab` med `$01 = $36`), och med `$37` kör CPU:n ROM:ets byte där och
   hamnar i READY. Från monitorn skrivs `> C:0001 36` före `g`. Med `sys` går det inte: BASIC körs i ROM:et som `$01`
   slår bort, så VICE skriver POKE:ar som lägger `lda #$36 / sta $01 / jmp $a2ab` på `$02a7-$02ad` (en del av
   systemområdet som varken BASIC eller KERNAL använder) och `sys679`, på rader om högst 79 tecken. Sätter användaren
   en egen start glöms `$01`. Kortet *Program start* och Build-loggen säger hur programmet startas, med `$01`.
   **I/O-läget vid start.** Satte *Unpack* starten och sparade Sindri ett I/O-läge med den (`Project.entryIo`, 8.11b),
   startas programmet från monitorn genom en rutin (`startCode`, `core/src/c64/debugger-start.ts`): SEI, stegen
   (`lda #v / sta reg`, en läsning som kvittens, sex VIC-register eller fler ur en tabell i en slinga), `$01`, CLI bara
   om avbrotten var på, `jmp` till starten; den använder ingen stack. Monitorn skriver rutinen i RAM på `$02a7` när den
   ryms där och programmet lämnar det fritt, annars längst ned i stacksidan (`startCodeAt`; Sindri sparar inget under
   `$0200`), färg-RAM:et med `bank io` och `>`, och kör `g` till rutinen. Får rutinen inte plats skriver monitorn
   registren själv (utan kvittenser). Med `sys` finns ingen plats för rutinen, så ett sådant program startas alltid från
   monitorn. Elite (`$0308-$ffff`): rutinen på 134 byte på `$0100`, och spelet visar sin titelbild i VICE som när det
   laddas från disken, med disken i station 8. Kortet *Program start* och Build-loggen säger det (*… after a routine sets
   the I/O it started in (43 steps: VIC bank 1, …, the colour RAM)*). `vice.integration.test.ts` kör det i riktiga VICE.
   `test/vice.integration.test.ts` kör detta i riktiga VICE (`-console`, egen konfigurationsfil, debug-cartridgens `$d7ff` som avslutningskod).

### 13.2b Bygg och kör i en debugger (Shift+F5)

`Shift+F5` bygger och verifierar som `F5` och startar sedan programmet i Retro Debugger eller C64 Debugger (Marcin
Skoczylas, med VICE inuti) i stället för i VICE, på samma sätt som VICE startar det. *Settings → Toolchain* säger var
de finns (*Choose folder…*: mappen med `C64Debugger.exe`, som båda kallar sitt program), vilken av dem `Shift+F5` kör,
deras extra argument och hur länge Retro Debugger väntar innan den startar programmet (standard 3000 ms).

Debuggrarna tar inget av VICE:s `-keybuf` eller monitorkommandon (de går inte vidare till deras VICE). De laddar en PRG
rakt in i RAM, också under I/O-området och ROM:arna (som VICE:s `bank ram`), när C64:an står vid READY, och hoppar:
Retro Debugger till `-jmp` efter `-wait` (utan väntan hoppar den innan C64:an startat, med skärmen av), C64 Debugger
till PRG:ns laddadress med `-alwaysjmp` (den nollställer, väntar på READY och laddar själv, och en `-jmp` går förlorad
i nollställningen; `-autojmp` får Retro Debugger 1.0.0 att krascha). Därför laddar debuggern en kopia av PRG:n,
`main.debugger.prg` bredvid programmet, med en liten startkod (`debuggerStart`, `core/src/c64/debugger-start.ts`) på
kopians laddadress, och hoppar dit. Startkoden gör det VICE gör:

- **Utan programstart, och med `sys <start>`:** den skriver raden VICE skriver vid READY: markören släcks och tecknet
  under den sätts tillbaka (som KERNAL gör när en tangent kommer), raden skrivs ut och läggs i BASIC:s inmatningsbuffert,
  och BASIC tar den därifrån som efter RETURN (`$a486`: TXTPTR, direktläge, tokenisering, körning). BASIC:s slutpekare
  (`$2d-$32`, `$ae`) sätts först till programmets slut, som VICE:s laddning gör. `run` är alltså BASIC:s riktiga RUN och
  `sys` en riktig SYS som går tillbaka till BASIC. Med en disk i station 8 skrivs diskinitieringen (`DRIVE_INIT`) först
  på samma rad. Med ett annat `$01` än `$37` anropar raden en rutin efter startkoden som sätter `$01` och hoppar till
  starten (VICE:s POKE:ar till `$02a7` behövs inte: koden finns redan där).
- **Ett program över BASIC:s arbetsområde eller skärmen** (`startsFromMonitor`) startas som från VICE:s monitor:
  med en disk får stationen läsa disken (KERNAL:s OPEN 15,8,15, CHKOUT, CHROUT `I`, CLRCHN och CLOSE anropas direkt,
  förbi programmets vektorer, utan avbrott, och nollsidan `$90-$bc` och filtabellerna `$0259-$0276` som de använder
  sätts tillbaka till programmets) och `$ba` blir 8 (om programmet inte laddats över den); `$01` som programmet startar
  med; stackpekaren som vid READY. Utan disk och med `$01 = $37` och starten på laddadressen hoppar debuggern direkt.
  Ett program med ett I/O-läge från Sindri (`Project.entryIo`) startas också så, och startkoden sätter registren som
  VICE:s rutin gör (avbrotten på bara om de var det); färg-RAM:et ryms inte i startkoden och sätts inte i debuggern.
- **En disk eller ett band som VICE autostartar** (projektets första fil är diskens första program, eller bandets):
  startkoden ensam på `$02a7` skriver `load"*",8,1` eller `load` med `run` väntande i tangentbordsbufferten.

Startkoden ligger direkt före programmet i ledigt minne (BASIC:s fria minne, `$c000`-blocket, bandbufferten,
`$02a7-$02ff`, och för en monitorstart också botten av stacksidan och inmatningsbufferten: koden flyttar då stacken
under sig). Annars direkt efter, med en `JMP` dit direkt före programmet (för ett program på `$0801` på `$07fd-$07ff`,
och `$0800` förblir 0). Annars bärs programmet: kopian laddas i BASIC:s fria minne efter dess tomma program
(`$0803-`) eller i `$c000`-blocket, och startkoden kopierar programmet på plats först med `$01 = $34` (ett program på
`$c000` har inget ledigt minne före sig: `$bfxx` är under BASIC-ROM:et). Finns ingen plats laddas programmet bara, och
Build-loggen säger vad man skriver i debuggern.

Byggloggen visar debuggerns kommandorad, var startkoden ligger och vad den skriver, och det som inte blir som i VICE.
Kontrollerat med Retro Debugger 1.0.0 och C64 Debugger 0.64.58.6:

| | Retro Debugger 1.0.0 | C64 Debugger 0.64.58.6 |
|---|---|---|
| PRG | `-wait 3000 -prg main.debugger.prg -jmp x<adress>` | `-prg main.debugger.prg -alwaysjmp` |
| Etiketter | filen `main.debugger.labels` bredvid PRG-kopian (`main.labels` bredvid en `.crt`), som debuggern läser själv; aldrig `-symbols`, som med `-prg` stoppar Retro Debugger 1.0.0 med *Assertion failed … Missing End()* när dess fönster Data watch är öppet | `-symbols main.vs` |
| Källkod, brytpunkter, bevakningar | filen `main.debugger.dbg` bredvid PRG-kopian, se nedan | samma fil |
| Ett fönster som redan är öppet | används igen: `-pass -reset -unpause`, sedan programmets kommandorad med `-pass` | en ny debugger varje gång |
| Disk | sätts i först, i en egen kommandorad, och programmet ges sedan som till en debugger som redan kör, se nedan; utelämnas (och en disk som ska autostartas vägras) när debuggerns VIC-kant är *Full* eller *Debug* | `-d64` |
| Band | utelämnas (tom skärm, sedan ingen); ett band som ska autostartas vägras | `-tap`; PLAY trycks i debuggerns *Settings → Tape* |
| Cartridge | `-crt <fil> -reset` | vägras: den står kvar vid READY |
| VICE-snapshot | vägras: *Snapshot loading failed* (läser inte VICE 3.x) | `-pass -snapshot main.c64d.snap`: snapshoten omskriven som debuggern läser den, se nedan |

**Källkoden, brytpunkter och bevakningar i debuggern.** Bredvid PRG-kopian skriver `Shift+F5` också
`main.debugger.dbg`, debuginformation i Kick Assemblers `-debugdump`-format, som båda debuggrarna läser själva när de
laddar PRG:n (filen med PRG:ns namn och `.dbg`). Mimir skriver den själv ur den rendering som just verifierats byte
för byte (`debugSources` och `debugInfoFile`, `core/src/c64/debugger-dbg.ts`), så den är densamma med Kick Assembler,
64tass och den inbyggda assemblern. Den innehåller:

- **Källorna**: första filens `.asm`, skriven till mappen `main.debugger.src` bredvid, och för varje instruktions- och
  datarad vilka byte den gav (`$start,$slut,fil,rad,1,rad,radens längd`). Debuggerns fönster *Source code* (i Retro
  Debugger menyn *C64 → C64 Source code*) visar då källan med etiketter och kommentarer vid koden som körs. Rader i
  ett block som lämnats utanför bygget gav inga byte och är inte med.
- **Etiketterna** ur assemblerns etikettfil (debuggern läser `.dbg` efter `.labels`, i dess ställe).
- **Brytpunkterna**: `F8` på en instruktionsrad sätter eller tar bort en (också i radens högerklicksmeny); raden får
  en röd kant, röd adress och märket *break*. Debuggern stannar där innan instruktionen körs.
- **Bevakningarna**: `Shift+F8` sätter radens adress på debuggerns bevakningslista (*Data watch*) eller tar bort den;
  raden får märket *watch*.

Brytpunkter och bevakningar sparas i projektfilen (`breakpoints`, `watches`: adresser, sorterade) och går att ångra;
analysen, källan och utdata ser dem inte. Kommandopaletten har *Remove all breakpoints and watches*. Bara
brytpunkter i den fil som körs följer med. Filen ges aldrig med `-debuginfo` (som stoppar Retro Debugger på samma
sätt som `-symbols`), och en körning utan debuginformation tar bort en fil från en tidigare. En cartridge, en
snapshot och en disk eller ett band som autostartas får ingen `.dbg`. Byggloggen säger hur många källrader,
brytpunkter och bevakningar debuggern fick, och var filen ligger.

**En disk i Retro Debugger.** Med `-d64` bredvid `-prg` och `-jmp` på samma kommandorad stannar Retro Debugger 1.0.0:s
emulering efter 28 bildrutor. Med `-d64` ensam sitter disken i station 8 och C64:an kör. Därför får den disken först:
körs ingen debugger startas den med bara `-d64 <disk>`, och när C64:an startat (väntetiden i inställningarna, minst 3 s,
plus 2 s) får den programmet som en debugger som redan kör får det (`-pass -reset -unpause`, sedan programmets
kommandorad med `-pass`); disken sitter kvar över nollställningen. En debugger som redan kör får disken med `-pass -d64
<disk>` och 2 s senare programmet på samma sätt. Startkoden gör sedan som i VICE: diskinitieringen före `run` eller
`sys`, eller `load"*",8,1` och `run` för en disk som autostartas (stationen laddar då programmet på riktigt).

Ett undantag: med debuggerns VIC-kant satt till *Full* eller *Debug* (`viceViciiBorderMode: 1` eller `2` i dess
`settings.hjson`) avslutas Retro Debugger 1.0.0 med ett minnesfel (0xC0000374) ungefär varannan gång den får en disk,
från kommandoraden eller överlämnad (11 av 20 starter med *Debug*, 2 av 4 med *Full*; ingen av 26 med *Normal* eller
*No borders*; dess övriga inställningar och layout spelar ingen roll). Mimir läser därför filen
(`%LOCALAPPDATA%\RetroDebugger\settings.hjson`) innan den ger en disk: med en sådan kant lämnas disken utanför, och
en anteckning i toasten och byggloggen säger varför och vad som ska ändras (*Settings → C64 → VIC → VIC Border mode →
Normal* i Retro Debugger); en disk som ska autostartas vägras med samma förklaring. Mimir ändrar inte debuggerns
inställningar. Kontrollerat med Uncensored (Booze Design 2014, `boozedemo1.d64`) genom `launchDebugger`: disken
startade och demot körde, både i en nystartad debugger och i ett fönster som användes igen.

**Samma fönster igen.** Retro Debugger som Mimir startat och som fortfarande kör får nästa `Shift+F5` i samma fönster,
med sin layout och sina öppna fönster, i stället för en debugger till per körning. Debuggern utför en överlämnad
kommandorad i sin egen ordning (nollställning, väntan, laddning, hopp) och gör inget av det medan den står på en
brytpunkt, så den får två: `-pass -reset -unpause` (C64:an startar om och kör), och en halv sekund senare programmets
kommandorad med `-pass` först. Processen som lämnar över avslutas genast; gör den inte det fanns ingen debugger, och
den är då debuggern. En debugger som användaren startat själv känner Mimir inte till och startar en egen. Loggen
säger *in the debugger that was already running*. C64 Debugger startas som förut på nytt varje gång.

**En VICE-snapshot i C64 Debugger.** C64 Debugger 0.64.58 bygger på VICE 3.1, vars snapshots är format 1.1 med
32-bitars klockor; VICE 3.6-3.10 skriver format 2.0 med 64-bitars klockor och nyare moduler, som debuggern vägrar.
Tillståndet är detsamma, så `snapshotForC64Debugger` (`core/src/c64/vsf-c64d.ts`) skriver om snapshoten modul för
modul så som VICE 3.1:s läsare tar den (kontrollerat mot debuggerns källkod och VICE 3.10:s skrivare), och
`Shift+F5` skriver den bredvid `.vsf`:en som `main.c64d.snap` med det byggda programmet i sitt RAM:

| Modul | Omskrivning |
|---|---|
| `MAINCPU` | klockorna 32 bitar; utan ane/lxa-loggnivå och jam-flagga |
| `C64MEM`, `GLUE`, `C64MEMHACKS` | som de är (RAM, CPU-port); `C64CART` bara utan cartridge (en snapshot med cartridge vägras) |
| `CIA1`, `CIA2` | TOD-klockan 32 bitar; utan det nyare tillståndet för serieport och avbrottsfördröjning |
| `SID`, `SIDEXTENDED` | utan modellbyten, ljudet på; reSID:s eller fastSID:s tillstånd som det är; en SID |
| `DRIVE8`, `DRIVE9` → `DRIVE` | båda stationerna i en modul, klockorna 32 bitar; `DRIVECPUn` (register, 2 KB RAM) utan sista bussvärdet; stationens VIA:er utan det nyare timer 2-tillståndet. Bara 1540/1541/1541-II, andra stationer lämnas utan med en anteckning |
| `VIC-II` | ljuspennans cykel 32 bitar; modellen skrivs som den första i sin tv-standard (6569 för PAL, 6567 för NTSC), för debuggern vägrar en annan modell än sin egen. Debuggerns *C64 model* måste alltså vara C64 PAL respektive C64 NTSC, annars säger den *Snapshot loading failed* och nollställer; toasten och loggen säger vilken |
| `TAPEPORT`, `USERPORT`, `JOYPORTn` | ingen enhet; en joystick utan något nedtryckt; `KEYBOARD` utelämnas (ingen tangent hålls) |
| `GCRIMAGE0` | projektets disk (D64 eller G64) som station 8:s, spåren som GCR-byte per halvspår: debuggern tar ingen disk på kommandoraden bredvid en snapshot. Det programmet skriver till disken stannar i debuggern |

En klocka över 2^31 cykler flyttas tillbaka tillsammans med de andra i sin CPU. Bandstationens tillstånd, de virtuella
stationerna och händelsehistoriken följer inte med, och ett band sätts inte i (en anteckning säger det). En snapshot i
format 1.x (VICE 3.1-3.5) skickas som den är.

Debuggern får snapshoten med `-pass`: en debugger som redan kör läser in den i sitt fönster (med etiketterna). En som
startas av kommandot laddar vid sin start det program den minns *efter* snapshoten, över den, så kommandoraden ges en
gång till efter väntetiden i inställningarna plus 3 sekunder, om det första kommandot startade debuggern (ett som
lämnade över till en körande debugger har då avslutats). Retro Debugger 1.0.0 läser inte VICE:s snapshots och vägras.

`test/debugger-start.test.ts` kör startkoden i Sindris C64 med VICE:s ROM:ar så som debuggrarna gör (PRG:n in i RAM
vid READY, hopp): RUN med slutpekaren och tillbaka till READY, ett buret program på `$c000` med `$01 = $36`, en
monitorstart med skärmens byte kvar, och med en 1541 felkanalen `00, OK` efter initieringen (`73,CBM DOS` utan),
programmets systemområde tillbaka efter KERNAL-anropen, och `load"*",8,1` med RUN. `test/vsf-c64d.test.ts` läser den
omskrivna snapshoten så som VICE 3.1 gör: modulerna och deras versioner, RAM, CPU och klockor, stationen med sitt RAM,
disken som GCR-spår (spår 18 avkodat tillbaka till D64:ans BAM), klockor flyttade tillbaka, och det som vägras.

### 13.3 VICE binary monitor (M3)

Med `-binarymonitor` (TCP 6502) kan appen: sätta brytpunkter från listningen, läsa minne och register live, synka listningsmarkören med PC vid stopp, och "hot reload" genom att skriva om ett minnesområde utan omstart. Det ger också dynamisk täckning: adresser som körs i VICE men inte hittats statiskt kan föreslås som nya startpunkter.

### 13.4 IPC-kontrakt

| Kanal | Riktning | Argument → svar |
|---|---|---|
| `project:open` | renderer → main | `{ path? }` → `{ path, project, home }` (dialog om sökväg saknas; en sökväg måste ligga i en mapp vald i sessionen eller vara ett projekt öppnat förut); projektets mapp är där det som skrivs hamnar från och med nu (13.10) |
| `project:save` | renderer → main | `{ project, path? }` → `{ path }` |
| `project:start` | renderer → main | → `{ last, resume, recent, parent }`: det startskärmen erbjuder (13.10) |
| `project:create` | renderer → main | `{ name, parent, project, gather?, git? }` → `{ home, moved, git? }`: ett nytt projekts mapp med projektet sparat i, och arbetet utan projekt flyttat dit; med `git` också ett git-förråd i mappen (13.10b), och `git` i svaret säger hur det gick |
| `project:parent` | renderer → main | → `{ dir }`: mappen ett nytt projekts mapp läggs i, vald i en mappdialog (`null` om den avbryts) |
| `project:unsaved` | renderer → main | arbete utan projekt från och med nu |
| `project:reveal` | renderer → main | projektets mapp i utforskaren |
| `project:forget` | renderer → main | `{ file }` → listan: ett projekt struket ur listan över de senaste (mappen rörs inte) |
| `prg:open` | renderer → main | `{ paths?, zeroPage? }` → `OpenedPrg[]` (`LoadedFile`, för en VICE-snapshot också `vsf`, `entries`, `start` och `snapshot`, 13.7) |
| `disk:open` | renderer → main | `{ path? }` → `{ path, name, bytes }` för en `.d64` (dialog om sökväg saknas; `null` om den avbryts) |
| `file:smart` | renderer → main | `{ zeroPage? }` → `{ files, disk, project, asm, left, problems }`: **Smart attach** (13.4b), en dialog för alla slags filer, var och en läst som dess filändelse säger; mapparna får användas under sessionen (`null` om dialogen avbryts) |
| `export:write` | renderer → main | `{ dir \| target, files: Record<string, string \| Uint8Array> }` → `{ dir, written: string[] }`; `target`: `pick` (mappdialog), `temp` (ny mapp i temp), `project` (projektets `source`), `build` (projektets `build`, utan projekt en ny mapp i temp) |
| `toolchain:build` | renderer → main | `{ dir, entries: string[], assembler? }` (`kick` eller `64tass`, 11.8) → `{ ok, stdout, problems: Problem[], prg?: Uint8Array }` |
| `asm:pick` | renderer → main | → `{ path, dir, entry, assembler }`: en Kick Assembler- eller 64tass-källa vald i en dialog (`assembler`: den källan ser ut att vara skriven för, 11.8), att bygga där den ligger (13.8b); mappen får byggas i under sessionen (`null` om dialogen avbryts) |
| `toolchain:run` | renderer → main | `{ prgPath, labelsPath?, start?, disk? }` → `{ pid, via: 'run' \| 'sys' \| 'monitor' }` |
| `toolchain:pack` | renderer → main | `{ files: { name, prg }[], prefs: PackPrefs }` → `{ ok, output, argv, dir, name?, path?, prg?, packed, report, check, error? }`: Brokkr i en arbetstråd eller Exomizer, efter `prefs.packer`; filen skrivs också i `prefs.dir` när den är satt (en mapp vald i sessionen), och `path` pekar dit (13.8) |
| `pack:folder` | renderer → main | `{ dir?, ask? }` → `{ dir }`: mappen för den packade filen; en mapp sessionen redan får skriva i ges tillbaka direkt, annars (och alltid med `ask`) frågar en mappdialog som öppnas där (`null` om den avbryts) |
| `vice:quicksave` | renderer → main | `{ zeroPage? }` → `{ found, path, saved?, files? }`: VICE:s nyaste quicksave öppnad som snapshot (13.7b) |
| `vice:quicksave-info` | renderer → main | → `{ found, path, saved? }`: finns det en quicksave och när sparades den |
| `vice:quicksaves` | renderer → main | → `{ id, name, saved, size, favourite? }[]`: quicksavesen appen sparat (de nyaste och favoriterna), den nyaste först (13.7b) |
| `vice:quicksave-open` | renderer → main | `{ id, zeroPage? }` → som `vice:quicksave`: en sparad quicksave öppnad som snapshot |
| `vice:quicksave-rename` | renderer → main | `{ id, name }` → listan: ett nytt namn på en sparad quicksave |
| `vice:quicksave-save` | renderer → main | `{ id }` → `{ path }` eller `null`: en sparad quicksave kopierad dit användaren väljer i en spara-dialog |
| `vice:quicksave-favourite` | renderer → main | `{ id, on }` → listan: en sparad quicksave gjord till favorit, eller inte längre |
| `vice:chargen` | renderer → main | → `{ found, path, bytes? }`: C64-tecken-ROM:en (4 KB) ur den VICE som står i inställningarna, för skärmar i Graphics (14.5); sökvägen kommer aldrig från renderaren |
| `vice:quicksaved` | main → renderer | `{ path, saved }`: VICE skrev en ny quicksave |
| `file:save` | renderer → main | `{ name, bytes, title? }` → `{ path }` med en spara-dialog (`null` om den avbryts) |
| `terminal:open` | renderer → main | `{ dir? }` → `{ dir }`: ett terminalfönster (13.6) |
| `vice:attach` / `vice:command` | renderer → main | monitorkommandon → svar |
| `settings:get` / `settings:set` | renderer → main | `Settings` |
| `fs:changed` | main → renderer | `{ path }` (fil-watcher) |
| `window:closing` | main → renderer | fönstret ska stängas (krysset, Alt+F4, File → Exit): sidan svarar med `window:close` inom 2,5 s, annars stängs det ändå (13.10) |
| `window:close` | renderer → main | `{ close }`: sidans svar, fönstret stängs nu (`true`) eller väntar medan sidan frågar användaren (`false`) |
| `git:version` | renderer → main | → `{ path, version }` eller `null`: den git som finns (13.10b) |
| `git:status` | renderer → main | `{ log? }` → `{ git, dir, repo }`: projektets förråd, dess gren, uppströmsgren, före/efter, remotes, ändrade filer och de `log` senaste commitarna (20; med föräldrar och meddelandets resten, `more`: det finns äldre) (`repo` `null`: mappen är inget förråd; `dir` `null`: inget projekt) |
| `git:init` | renderer → main | ett förråd i projektets mapp, med Mimirs `.gitignore` och `.gitattributes` → `{ ok, output, argv, status }` (som alla steg nedan: vad git skrev, dess kommandorader och förrådet efteråt) |
| `git:stage` / `git:unstage` | renderer → main | `{ paths? }`: filer från förrådets rot (inga: alla ändringar) |
| `git:commit` | renderer → main | `{ message }`: det som är stagat, med meddelandet på stdin |
| `git:push` | renderer → main | grenen till sin uppströmsgren, annars till origin som en gren med samma namn (som då blir uppströmsgren) |
| `git:remote` | renderer → main | `{ url }`: origin läggs till, eller får en ny URL |
| `git:diff` | renderer → main | `{ path, from?, staged?, range? }` → `{ text, truncated, binary }`: en fils ändringar, stagade eller inte, eller mellan `range`:s två punkter; en ospårad fil visas hel |
| `git:compare` | renderer → main | `{ from, to }` → `{ range, files }`: filerna som inte är lika mellan två punkter, med ändring och rader (`from` en commits hash eller `null`: ingenting; `to` en commits hash eller `null`: mappen nu, med ospårade filer) |
| `library:list` | renderer → main | → `{ dir, exists, items }`: bibliotekets mapp och dess filer med deras poster i `library.json` (10.6) |
| `library:add` | renderer → main | `{ kind, stem, format?, bytes, entry }` → `{ item, listing }`: filen skriven i sortens mapp under ett säkert, unikt namn (en bitmapp med `format`s ändelse) |
| `library:update` | renderer → main | `{ kind, file, name?, stem?, mc?, colors? }` → `{ item, listing }`: namnet (filen döps om till `stem`), hur den ritas |
| `library:remove` | renderer → main | `{ kind, file }` → bibliotekets innehåll: filen till papperskorgen, posten ut ur `library.json` |
| `library:reveal` | renderer → main | `{ kind?, file? }`: filhanteraren vid filen, eller vid sortens eller bibliotekets mapp |
| `library:pick` | renderer → main | `{ current? }` → `{ dir }` eller `null`: en mappdialog för bibliotekets mapp (Settings sparar den) |
| `scripts:list` | renderer → main | → `{ dir, files: [{ file, text, mtime }] }`: skripten i bibliotekets mapp `Scripts`, en fil var (10.3) |
| `scripts:save` | renderer → main | `{ file, text, was? }` → listan: filen skrivs (ett rent filnamn, `.asm` eller `.js`); `was`, filen den ersätter under ett annat namn, till papperskorgen |
| `scripts:remove` | renderer → main | `{ file }` → listan: filen till papperskorgen |
| `scripts:reveal` | renderer → main | mappen `Scripts` visas i filhanteraren (görs om den inte finns) |

### 13.4b Smart attach

**Smart attach…** står överst i titelradens File-meny (och i kommandopaletten): en dialog (*Smart attach*, flera filer
får väljas) som visar allt Mimir öppnar, och varje fils **filändelse** avgör vad den öppnas som
(`apps/desktop/shared/smart-attach.ts`, `smartKind`):

| Filändelse | Öppnas som |
|---|---|
| `.prg` | PRG-filer, som *Open PRG files…* öppnar dem |
| `.vsf` | en VICE-snapshot (13.7) |
| `.crt` | en cartridge, ett projekt för sig (13.9) |
| `.d64` | en diskavbild som monteras (13.5) |
| `.tap`, `.t64` | en bandavbild (TAP) eller ett T64-arkiv som läggs i datasetten (13.5e, 13.5j) |
| `.json` | ett Mimir-projekt (`.mimir.json`), som *Open project…* öppnar det (13.10) |
| `.asm` | en Kick Assembler-källa som **Brokkr** packar: *Pack a file* (13.8b) öppnas över arbetet med källan vald och Brokkr som packare; KickAss.jar assemblerar den där den ligger och Brokkr packar PRG:n |
| annan eller ingen | läses som en PRG (en snapshot eller cartridge känns ändå igen på huvudet, som när den släpps i fönstret) |

Väljs flera filer öppnas PRG:erna, snapshotarna och cartridgen tillsammans, som med *Open PRG files…*, medan en disk
monteras, ett band läggs i datasetten och en källa packas åt gången: de andra lämnas, och en rad säger vilka och varför (*Not opened: b.asm (Brokkr
packs one source at a time)*). En disk och ett band valda tillsammans ligger båda kvar (annars matar den ena ut den
andra, 13.5e). Ett projekt öppnas för sig, eftersom det tar arbetets plats: är ett projekt bland filerna
öppnas bara det (`smartPlan`). En fil som inte kan läsas sägs med sitt namn, och de andra öppnas ändå.

*Pack a file* över arbetet är samma vy som startskärmens (13.8b), i ett lager över fönstret: arbetet står kvar som det
var bakom, listningens tangenter väntar så länge vyn är öppen, och **Back to \<projektet\>** (*Back to the work* utan
projekt) går tillbaka till det. Dialogen öppnas där Smart attach senast användes (`recent-folders.json`, `smart`).

**Test:** `e2e/app.spec.ts` (*Smart attach opens each file as its extension says*): en PRG och en D64 i samma dialog
(PRG:n öppnas, disken monteras, dialogens titel och filter), en `.vsf` och en `.crt`, en `.asm` (en andra källa lämnas;
*Pack a file* över arbetet med Brokkr vald; med KickAss.jar assembleras och packas `my border.asm`; `g` öppnar inte
*Go to*; *Back to the work* lämnar filerna som de var) och en projektfil (en PRG bredvid lämnas, projektet öppnas).
`test/main.test.ts` prövar `smartKind`, `smartPlan` och kanalens schema.

### 13.5 Diskavbilder (.d64, .g64)

**Mount disk image (D64, G64)…** (titelradens File-meny, kommandopaletten, eller dra och släpp en `.d64` eller `.g64`) läser en 1541-avbild med 35, 40 eller 42 spår,
med eller utan felbyte per sektor (`packages/core/src/c64/d64.ts`). En G64 (spåren som GCR-bitar, som en bitkopierare
läste dem, halvspår och kopieringsskydd med) läses genom sina vanliga sektorer: Sindri avkodar dem till en D64 med en
felbyte per sektor (`diskSectors`, `g64ToD64`; ett spår utan sektorer, ett skydds, läses som fel), så katalogen,
filerna och Spindle-, Bitfire- och BoozeLoader-läsarna fungerar som för en D64. Explorer säger `G64 (GCR tracks)`. Explorer visar katalogen, i sektionen *Disk* direkt
under *Files*, som 1541:an listar den:
diskens namn och id, en rad per fil med block, `"NAMN"` och typ (`*PRG` för en fil som aldrig stängdes, `PRG<` för en
låst), och "blocks free" (spår 1–35 utom katalogspåret). Tomma och raderade poster visas inte.

**Utgåvans nästa sidor.** När disken monteras läses också utgåvans följande sidor i samma mapp: avbilder vars namn
skiljer sig från diskens bara i sidmärket, i ordning (`nextSides()` i `packages/core/src/c64/sides.ts`:
`Mathematical_SideA` → `_SideB`, `-a` → `-b`, `image1` → `image2`, `EdgeOfDisgrace_0` → `_1a`, `_1b`, `Disk1` →
`Disk2`). En annan version i samma mapp skiljer sig i mer än så och tas inte med (`e2ira_A` får `e2ira_B` och
`e2ira_C`, inte `e2ira_101_B`), och inte heller sidor före disken. Släpps flera diskar samtidigt monteras den första
sidan med de andra som nästa. Toasten och raden *Then …* under katalogen i Explorer säger vilka, och en fil som öppnas
från disken får dem med till Sindri (8.11b), liksom `mimir unpack disk.d64`. På årsettorna i CSDB:s Year-top20 hittas
rätt sidor i varje mapp med flera; Royal Artes ena par, vars namn skiljer sig i ett skrivfel (`)` mot `]`), och
Desert Dreams `0-intro`/`1-parti` hittas inte.

Ett klick på en PRG öppnar den som ett nytt projekt, och **+** lägger till den i projektet. Filens byte hämtas längs
sektorkedjan (en kedja som går i cirkel eller pekar utanför disken ger ett fel i stället för att hänga), och
filnamnet blir namnet med de tecken Windows inte tillåter bytta mot `_`, plus `.prg`. SEQ-, USR-, REL- och DEL-filer
listas men öppnas inte. Disken stannar monterad tills den matas ut, även när ett nytt projekt öppnas.

Filerna som finns i projektet är markerade i listan (en linje till vänster, `aria-current`). Med fokus i listan flyttar
`↑` och `↓` (och `Home`, `End`) mellan filerna som går att öppna, utan att listningens markör flyttar sig, och `Enter`
öppnar filen. **Alt+↓** och **Alt+↑** (även i kommandopaletten) öppnar nästa program på disken efter det som öppnades
sist därifrån, eller programmet före, som ett klick gör; är inget öppnat än börjar de med det första (eller sista). Efter
det sista säger en toast *That was the last program on …*. Bandet (13.5e) fungerar likadant, och Alt-pilarna går på
den disk eller det band som filen som öppnades sist kom från (utan någon: disken, annars bandet).

**Disken som på en C64.** Settings → General → *The disk and the tape in the Explorer* väljer mellan *Mimir's list*
(förvalt, som ovan) och *As on a C64* (för bandet: 13.5e, *Bandet som på en C64*): katalogen visas då som skärmen en C64 visar efter `LOAD"$",8` och `LIST`, ljusblått på blått
inom den ljusblå ramen, med VICE:s teckensnitts-ROM (Toolchain → VICE; utan den Mimirs egna bokstäver och siffror,
utan grafik, och det sägs under skärmen) och markören som blinkar efter `READY.`. Bilden ritas pixel för pixel när
panelen är minst lika bred som C64:ans pixlar, annars utjämnad. `packages/core/src/c64/dirlist.ts` bygger raderna som
1541:ans ROM gör (`directoryProgram`), länkar om dem som LOAD gör, listar dem som BASIC:s LIST och skriver ut dem genom
en efterbildad skärmeditor (`directoryScreen`):

- Diskens rad: RVS ON, namnet inom citattecken, id och DOS-typ; shiftade mellanslag (`$a0`) blir mellanslag, inget annat
  ändras, så ett citattecken i namnet avslutar BASIC:s citat och byte från `$80` efter det listas som nyckelord.
- En fils rad: blocken som radnummer, mellanslag så att citattecknet står i kolumn 5, namnet där det första shiftade
  mellanslaget eller citattecknet blir det avslutande citattecknet (efter den 16:e byten om inget finns) och byten
  efter det tappar bit 7; `*`, typen och `<`. Typ 5–7 läser vidare i 1541:ans tabeller (typ 6 och 7 har en nolla som
  avslutar raden, och LOAD gör nya rader av resten).
- Skärmeditorn: citatläge (kontrollkoder inom citattecken visas inverterade, RETURN och DEL verkar ändå), RVS ON till
  RETURN, färgkoderna (färgen gäller rad efter rad), markörrörelser, DEL, INST och teckenuppsättningen (`$0e`).

Rader som samma del av listningen skrev ut är ett element över bilden: en fils öppnar den med klick eller `Enter`, **+**
lägger till den, `↑` `↓` och markeringen av filerna i projektet fungerar som i listan; diskens rad, andra typer än PRG,
`BLOCKS FREE.` och `READY.` går inte att öppna. En fil som katalogens egna koder skrivit över (HOME, DEL) listas under
skärmen. **Aa** bredvid utmatningsknappen byter teckenuppsättning som Commodore+Shift. *Mimir's list* eller *Restore
defaults* visar disken som förut.

**Test:** `test/dirlist.test.ts` jämför skärmen cell för cell (skärmkod och färg) med x64sc 3.10:s, med äkta
drivemulering (1541:ans egen ROM), för diskar med udda namn, typ 5–7 och ett disknamn med citattecken och kontrollkoder;
mot VICE stämmer också varje synlig rad på 14 diskar ur CSDB:s topp 200 (*The Lab*, *1337*, *The Hat*, *Aloft*, *Edge
of Disgrace* …). `e2e/app.spec.ts` (*the disk as a C64 lists it*): inställningen, raderna, öppna, lägga till, piltangenter,
Aa och tillbaka till listan.

Vid **Build & Run** läggs en kopia av den monterade disken i VICE:s drive 8 (`-8 <kopia>.d64` eller `.g64`, i en ny
byggmapp), så ett program som laddar fler delar från disken hittar dem, och ett program som sparar ändrar inte
originalet. Projektets filer som öppnats från disken skrivs tillbaka i kopian som de byggdes, i sina egna sektorer
(`writeDiskFile`: en D64:s sektorer, en G64:s datablock kodade på nytt där de låg, så resten av spåret, ett skydds
spår också, är orört); en fil som behöver fler eller färre block än den har på disken skrivs inte tillbaka, och det
sägs. Är projektets första fil diskens första program (det `LOAD"*",8,1` laddar) och ingen programstart är satt,
autostartar VICE kopian i stället (`-autostart <kopia>`), så diskens egen boot laddar de byggda filerna – också en
kopieringsskyddad G64:s. Annars läggs programmet i minnet med disken i drive 8. Det
kräver PRG-läget inject (diskavbildsläget lägger en egen disk i drive 8), så `-autostartprgmode 1` läggs till om
inställningarna säger något annat. Ett program som läggs rakt i minnet lämnar drivenheten som vid påslag, utan att
ha läst disken; på en C64 laddades det från disken (`LOAD"*",8,1`), och snabbladdare räknar med det (Sparkle i *We
Are The Anomaly* hänger med drivens lampa blinkande). Med en disk laddas därför PRG:n utan RUN (`-autoload`) och
VICE skriver diskkommandot `I` (initiera: driven läser disken) före `run` eller `sys <start>`. Kommandot skrivs utan
sträng: `open15,8,15:poke781,15:sys65481:poke780,73:sys65490:sys65484:close15:` (kanalen öppnas utan namn, och
KERNAL:ns CHKOUT, CHROUT och CLRCHN skickar `I`). En sträng som skrivs vid READY kopierar BASIC till strängutrymmet,
och ett program som laddar upp till `$a000` eller längre (ett uppackat, `$0801-$f344` till exempel) lämnar inget
kvar: `open15,8,15,"i"` stannade där med ?OUT OF MEMORY innan programmet startade. En snapshot
har med sin drive som den var. Ett program som startas från monitorn (13.2: över BASIC:s arbetsområde eller skärmen)
initieras numera också: kommandot skrivs vid READY innan programmet laddas, och `sys679` stannar i monitorn som sedan
laddar och startar det (förut fick det ingen initiering).
`test/d64.test.ts` läser diskar som VICE:s `c1541` skrivit och låter `c1541` läsa och validera diskar som `makeD64`
skrivit; `test/vice.integration.test.ts` kör i riktiga VICE ett program som laddar sin andra del från disken, och ett
som läser diskens id ur driven (`M-R` av `$0012`): det finns där bara efter initieringen, också för ett program som
laddar upp till `$f344`.

**Loaderflikarnas filer (2026-11-20).** Varje flik i bottenpanelen som listar en disks eller ett bands filer (Spindle,
Bitfire, Booze, Sparkle, Krill, Covert, DLoC, Pirate Slayer, Para-Protect, Tape; IFFL med *parts*) har bredvid *Copy script* (eller
*Copy list*) två knappar:
- **Export files to project** skriver flikens filer som egna källkoder i en mapp i projektets mapp, döpt efter
  disken eller bandet (`<projekt>/spindle-demo/`), utan att röra projektets listning. Filerna som ett anrop av loadern
  laddar tillsammans (ett Spindle-jobb, en Sparkle-bundle, en IFFL-dels bitar) blir en källkod (`job02.asm`), andra
  filer en var (`file01_4000.asm`). Varje grupp analyseras för sig, i en worker av sin egen, med projektets
  inställningar (`exportGroup`, `packages/core/src/group-export.ts`). En grupp med flera filer skrivs för Kick Assembler
  som en källkod: överst en `.file` och en `.segmentdef` per fil, sedan en gång det filernas huvuden definierade
  (`#import` av `include/c64-hardware.asm`, hårdvarunamnen, PETSCII-koderna, nollsidan, musiken) och sist varje fil i
  sitt segment (`.segment Job02_4000`). Namnen en fil definierade för en annan ("labels defined in other files")
  behövs inte. Assemblerad ensam skriver den varje fil som en egen PRG. 64tass har inga segment: där får varje fil sin
  egen källkod. Binärfilerna en källkod importerar (`gfx/`, `music/`, `data/`) får gruppens namn först
  (`bundle00_music_…`), så två grupper aldrig tar varandras, och `original/` har varje fil som den laddades.
  Varje grupp kontrolleras med den inbyggda assemblern (källkoden utan segmentraderna; varje fils byte där den
  laddas), och toasten säger om alla blir samma byte igen. Utan projekt frågar den först: arbetet blir ett projekt
  (*Export files to project needs a project*, som Save gör det), sedan exporten. **+** på en rad lägger fortfarande
  till en fil i projektet.
  **Mätt (2026-11-20):** 8 Sparkle-diskar ur Year-top20 2020 (Memento Mori, Christmas Megademo, 5 Shades of Grey):
  245 grupper, alla samma byte igen, 1–3 s per disk; Memento Moris tre Spindle-diskar: 85 jobb, alla. KickAss.jar 5.25
  på Memento Mori disk 1:s 14 sammanslagna källkoder skrev alla 59 PRG:er byte för byte som filerna.
- **Save files…** sparar alla filerna i en mapp man väljer, med skriptet eller listan som skriver disken igen (vad varje
  flik sparar står i dess avsnitt).

### 13.5b Spindle 3-diskar (Spins laddskript)

Spin, Spindles diskbyggare, läser ett laddskript med ett stycke per laddaranrop (ett **jobb**). Varje rad i ett stycke
är en bit: filen som laddas, dess adress, offset och längd. `NN:` är en etikett att söka till. Skriptet finns inte på
disken, men jobben gör det: Spin packar varje jobb och lägger det i omgångar av sektorer som drivkoden läser i vilken
ordning som helst. `readSpindleDisk()` (`packages/core/src/c64/spindle-disk.ts`) läser omgångarna och packar upp dem
till varje jobbs bitar (`SpindleDisk`, `SpindleJob`, `SpindleChunk`). Filnamnen finns inte på disken.

Formatet är Spindle 3.0:s och 3.1:s (`disk.c`, `pack.c` och `stage1.s`, MIT-licens):
- **Spår 18** har startprogrammet (18/8, 18/18, 18/9, 18/15), drivkoden och, i 18/17 på byte 253, den första
  kedjeposten. I 18/6 ligger söktabellen med etiketterna, baklänges.
- **En kedjepost** är 3 byte: flaggor (`$80` nytt jobb, `$40` nästa spår, `$20` sidans slut) och en bit per
  sektornummer (0–4 i första byten, 5–12 och 13–20 i de andra) för sektorerna i nästa omgång. En av dem har nästa post
  på byte 253.
- **En sektors första byte** är dess nummer, med `$40` när den har nästa post och `$80` när en enda enhet fyller den.
  Utfyllnadskopior av en sektor har samma nummer. Resten är poster uppifrån och ned: postens byte, sedan dess längd.
- **En enhet** är en destination (höga byten först) och en länk som uppackaren använder, sedan delar:
  `11llllll` och l+1 byte som de är, `10llllhh oooooooo` en kopia av l+3 byte från o+1 byte högre, och `0ooooooo` en
  kopia av 2 byte från o byte högre. Byten är omkastade för den seriella bussen (`scramble_bits`).
- **Andra poster:** 2 byte är kedjehuvuden. 3 byte med `$4c` är ett hopp som laddaren gör efter jobbet (Pefchains
  sidodörr). En enhet till laddarens sida är en ändring av laddaren (shadow-RAM under I/O).

Kopiorna kommer från högre adresser, så ett jobb packas upp från sin högsta byte och nedåt. **Startprogrammet** ger
adressen det fortsätter på efter jobb 1 (`spin -e`) och laddarens sida (`-r`). Spår 18 ger sidans och nästa sidas
knackkod (`-m`, `-n`), när en trackmo har flera sidor. Disken räknas som en Spindle 3-disk när startprogrammet har
början av Spindle 3:s residenta sida och hela kedjan går att följa till slutet.

**I appen:**
- Explorer säger om en monterad disk *Spindle 3 disk: N jobs the loader reads, not files*, med knappen **Load script**.
- Bottenpanelens flik **Spindle script** finns också då. Den visar laddskriptet med en rad per bit: jobb (och dess
  etiketter), adresser, längd, ett filnamn (`job02_1000.bin`, påhittat) och anmärkningar (*then jumps to $307a*,
  *loads under I/O*).
- Ett klick på raden öppnar biten som en PRG på dess adress, och **+** lägger till den i projektet.
- **Copy script** kopierar skriptet så som Spin läser det, med flaggorna för `spin` i en kommentar.
- **Save files…** sparar varje bit som skriptet namnger den (`job02_1000.bin`, bara byten, skriptet ger adressen) och
  som PRG (`job02_1000.prg`), med skriptet (`<disk>-spin.txt`). **Add files to project** lägger till alla bitar (13.5).
- Spelar ett jobbs kod en PETSCII-animation står det i anmärkningarna: *PETSCII animation, not packed: 105 frames
  ($8000–$cc4d) for the player at $faaf* (Breadbin of Horror, sida 1, jobb 13: pumpan som växer ur en grodd). Det är
  ingen packad fil: spelaren läser en ruta i taget ur strömmen och skriver den på skärmen (Sindri körd från `$8000`
  stannar på en JAM). `findPetsciiAnims()` (`packages/core/src/c64/petscii-anim.ts`) känner igen spelaren på dess kod
  i jobbets egna bitar: slingan som skriver en körning (`lda (ptr),y / tax / lda t1,x / sta (scr),y / lda t2,x /
  sta (col),y / iny / dec n / bne / jmp next`) och före den körningens huvud (`and #$0f / cmp #$0f / beq`,
  `cpx #$ff / beq`, fyra `lsr` till n). Var rutorna börjar läses ur koden som sätter strömpekaren (`lda #<start /
  sta ptr / lda #>start / sta ptr+1`), hur många ur räknaren koden sätter bredvid (`jsr spelaren / dec räknaren /
  bne`). Formatet: en ruta är körningar fram till en 0-byte; en körning är en byte H, positionen flyttas H & 15 steg
  (15: byten efter läggs till, och fler så länge de är `$ff`), sedan följer H >> 4 index (0 är 256) till spelarens
  två tabeller. Rutorna visas inte: Mimir säger bara vilka filer de ligger i. I arkivets 161 120 demo- och
  introfiler finns spelarens slinga bara i Breadbins kopior (12).
- Är ett jobb animationsdata som en spelare i ett annat jobb lagrar ruta för ruta (Bliss Machines blixtar, disk 1:
  jobb 6–8, spelaren i jobb 5) står det i anmärkningarna: *animation data, not packed: frames 1–174 of 448 for the
  player at $1f9d (job 5)*, och vid spelarens jobb *its player at $1f9d plays the animation data in jobs 6–8 (448
  frames)*.
- Varje bit som har en animations rutor i sig (av båda slagen) har etiketten *animation* efter filnamnet, och
  etikettens hjälptext säger vad den håller. En sådan bit som öppnas kallas inte packad: en rad över listningen
  (*job0d_8000.prg is animation data, not packed: …*) och ett kort i analysöversikten säger
  vad den är, och Sindri kör den inte. `spindleStoreAnims()` (`packages/core/src/c64/store-anim.ts`) lägger jobben i
  minnet i laddordning, hittar spelaren på dess kod (`lda (p),y / iny / bne / inc p+1`, lagringen `sta lo / stx $hh00`
  i sin egen operand, fyra tabeller), läser strömmen från koden som sätter pekaren och tar den bara när den slutar där
  en bit slutar. Formatet: en ruta är N grupper; en grupp är ett index till antal och sida (0: sidan och antalet står
  i strömmen), sedan för varje värde ett index till antal och värde (0: de står i strömmen) och lika många låga bytes.
- Har snapshoten också Pefchain-drivers (8.11f) står de under laddskriptet.

**Mätt:**
- de diskar `spin` och `pefchain` 3.1 byggde av Spindles exempel och egna testdelar: varje bit är byte för byte lik
  sin fil;
- Mojos fyra sidor (33–39 jobb var) och Memento Moris sida 1 (16 jobb): ingen kopia saknar sin källa, och de
  uppackade jobben stämmer med RAM i VICE-snapshots tagna vid laddaranropen.

En Sparkle-disk känns inte igen som en Spindle-disk. **Test:** `test/spindle-disk.test.ts`, med diskar som
`test/helpers/spindle-disk.ts` skriver på samma sätt som Spindle. `fixtures/d64/spindle-demo.d64` är en av dem.

### 13.5c Bitfire-diskar (d64writes kommandorad)

Bitfire, Bitbreakers loader, har med flit inget laddskript: varje del laddar nästa fil (`link_load_next_comp`) eller en
fil efter dess nummer. Det som liknar ett skript mest är kommandoraden till d64write, Bitfires diskbyggare. Den listar
filerna i den ordning de laddas (`-b`), startprogrammet (`--boot`), sidan (`--side`), dir-arten (`-a`) och vanliga filer
(`-s`). Bitfire lägger sina filer utanför diskens katalog, i en egen katalog på spår 18, med varje fils laddadress och
längd. `readBitfireDisk()` (`packages/core/src/c64/bitfire-disk.ts`) läser den och sektorerna i den ordning d64write
fyller dem. En fil som är packad med Bitfires packare, bitnax (0.x) eller dali (1.x), packas upp. Filnamnen finns inte
på disken.

Formatet är d64writes (BSD-licens), och katalogen har ändrats mellan versionerna:
- **0.x (till och med 0.7, 2020):** 6 byte per fil i 18/18, 18/17 och 18/16: spår, sektor, laddadress och längd − 1.
  Sidan står i byte `$ff`. Varje fil börjar i en egen sektor. Filerna är packade med bitnax.
- **1.0 och 1.1 (2022):** 4 byte per fil (laddadress, längd − 1) i 18/18 och 18/17. Sist kommer den första filens spår,
  vilken i ordningen dess sektor är på spåret, dess första byte och sidan (`$fc`–`$ff`).
- **Efter 1.1:** samma, men de 4 byten står först och laddadressens höga byte är − 1.
- **1.2 och senare:** de 4 byten först, sedan en kolumn med 63 låga byte, en med höga byte − 1 och två med längd − 1.

Från 1.0 följer filerna på varandra utan glapp från spår 1 sektor 0, och hela sektorn är deras. d64write fyller var
fjärde sektor på ett spår (från 1.2 var tredje från spår 18), sedan igen från sektor 1, 2 och 3. Sidan är `$f0` + sida
− 1. Startpositionen som en katalogsektor anger för sin första fil måste stämma med var filerna hamnar. Annars är det
inte det formatet.

**dali** skriver vart filen packas upp (2 byte) och sedan en zx0-ström:
- Först en literal: en Elias-gamma-längd, sedan byten. Efter en literal kommer en kopia med förra offseten (0) eller en
  ny (1). Efter en kopia kommer en literal (0) eller en ny kopia (1).
- Talen är sammanflätad Elias-gamma: en 0 före varje bit, en 1 sist. Från 256 kommer de 8 låga bitarna först. Bitarna
  läses uppifrån i en byte, som hämtas när den behövs.
- En ny offset är ett tal (dess höga del + 1) och en byte: de 7 låga bitarna, sedan 1 för längd 2. Annars följer
  längden − 1 utan sin första 0. Talet 256 avslutar strömmen.
- En fil packad på plats har inget slut. Den slutar där skrivningen når läsningen, och resten är byten som de är.

**bitnax** (`unpackBitnax()`) läses som `lz.c` och `resident.asm` i Bitfire 0.7 (BSD-licens, bara lästa). Strömmen är
densamma i hela GitHub-historiken, från första incheckningen 2016 till 0.7:
- Först kommer vart filen packas upp och var uppackningen slutar (2 byte vardera; med `--overlap` bara den första).
  Bitarna läses uppifrån i en byte, som hämtas när den behövs, mellan de andra byten.
- En typbit kommer före varje literal (1) och kopia (0), men inte före kopian efter en literal kortare än 256.
- En literals längd är en 1 och biten för varje bit efter den första, sedan en 0 (256 blir 0). Sedan kommer byten.
- En kopias längd är 0 för 2. Annars kommer en 1 och sedan varje bit av längd − 1 efter den första, följd av 0, den
  sista av 1. Längden 257 avslutar strömmen.
- 2 bitar till ger ett prefix på 3 bitar, och det anger offsetens bitar: 8, 3, 6 eller 10 efter en kopia på 2, annars
  4, 7, 10 eller 13. Sedan kommer offset − 1. Under 8 bitar är bitarna inverterade, annars kommer de höga bitarna och
  sedan den låga byten inverterad.
- En fil packad på plats (standard) slutar vid slutadressen, och resten är byten som de är. En fil som packas upp någon
  annanstans (`--load-addr`) slutar också där, och efter den kommer slutet.
- Bitfires första demos (2014–2015, som Comaland, Comaland 100 % och Fantasmolytic) har ingen slutadress, alltid
  slutet och offseten i en annan ordning: 3, 6, 8 och 10 efter en kopia på 2. En disk har en depacker, så den ordning
  som packar upp flest filer gäller för hela disken (`oldBitnax`).
- En kopia från minnet före filens början (packad med en ordbok, `--full-dict`) går inte att packa upp, eftersom det
  minnet är okänt. Den filen lämnas packad.

En disk räknas som en Bitfire-disk när katalogen på spår 18 har sidbyten och första filen på spår 1, sektor 0, byte 0.
För 1.x måste katalogsektorernas startpositioner stämma, och för 0.x måste varje fil börja efter den förra. En katalog
först (efter 1.1 och 1.2, som packar med dali) räknas bara när minst en fil packas upp. Startprogrammet är den post i
den vanliga katalogen som pekar på spår 18. En dir-art är rader som pekar dit eller är DEL med 0 block.

**I appen:**
- Explorer säger om en monterad disk *Bitfire disk: N files the loader reads, not in the directory*, med knappen
  **Bitfire script**.
- Bottenpanelens flik **Bitfire script** finns då. Den har en rad per fil: nummer, var den laddas, vart den packas upp,
  storlek (packad → uppackad), ett filnamn (`file02_3800.lz`, påhittat: numret och uppackningsadressen) och
  anmärkningar (*packed with dali, in place*, *packed with bitnax*, *not packed*, var den börjar på disken). En disk
  packad som de första demona säger *packed as in 2014–2015* i rubriken.
- Ett klick på raden öppnar filen som en PRG: uppackad där den packas upp, annars som den laddas. **+** lägger till den.
- **Copy script** kopierar d64writes kommandorad, med en kommentar per fil ovanför.
- **Save files…** sparar varje fil som den är på disken (`.lz`, det `-b` tar, med laddadressen) och uppackad som PRG
  när den är packad, med kommandoraden (`<disk>-d64write.sh`). **Add files to project** lägger till alla (13.5).

**Mätt:** alla 276 419 diskar i referensarkivet lästes på 8 minuter. 1 476 är Bitfire-diskar: 916 av 0.x, 200 av 1.0
och 1.1, 35 efter 1.1 och 325 av 1.2 och senare. Bland dem finns The Lab, 1337, Next Level, Comaland, Eyes och
Wonderland XIV. På 1.x-diskarna packas nästan alla filer upp, till exempel alla 47 på The Lab sida 1 och alla 73 på 1337
sida 1. Filerna som inte packas upp laddas som de är, som Next Rounds teckentabeller. Ingen Spindle- eller Sparkle-disk
tas för en Bitfire-disk.

**Mätt, bitnax:** på de 916 0.x-diskarna (159 olika, räknat efter innehåll) packas 23 466 av 24 836 filer upp (4 483 av
4 834 på de olika), 20 208 av dem på plats. 653 diskar (102 olika) packas upp helt. 92 diskar (15 olika) är packade som
de första demona, och där packas 2 323 filer upp. Alla 1 476 Bitfire-diskar läses och packas upp på 9 sekunder. Några
av diskarna:
- Comaland sida 1–4: 20 av 22, 21 av 22, 17 av 17 och 42 av 42. På sida 1 är de två som inte packas upp data och en
  tabell som inte är packade. På sida 2 är det 18 KB tät data på `$6c00` som inte går att läsa som bitnax.
- The Ghost sida A och B: 17 av 17 och 45 av 45.
- Eyes sida A och B: 38 av 38 och 29 av 29.
- 2600: 38 av 39. Den sista är musikrutinen på `$e600`, som inte är packad.

Av filerna som inte packas upp är 12 olika packade med ordbok. Resten ser ut som filer som inte är packade: samplingar,
tabeller, musik och BASIC-program.

**Test:** `test/bitfire-disk.test.ts`, med diskar, dali-filer och bitnax-filer som `test/helpers/bitfire-disk.ts`
skriver som d64write, dali och bitnax gör (egna enkla packare, ingen kod från Bitfire). bitnax-testerna täcker literaler
(också 256 med en typbit efter), kopior med alla 8 offsetbredder, filer packade på plats, för någon annanstans, med
`--overlap` och som de första demona, och filer som inte är bitnax. `fixtures/d64/bitfire-demo.d64` är en av diskarna:
demot packat med slut, en tabell som inte är packad och en fil packad på plats.

### 13.5d BoozeLoader-diskar och skriptet i koden

BoozeLoader är HCL:s loader för Booze Design. Den finns i deras demos från Edge of Disgrace (2008) till Codeboys &
Endians (2025) och i demos av Hitmen, Genesis Project och andra. Källkoden är inte offentlig, så formatet är läst ur
diskarna och ur det som körde i Sindri. BoozeLoader har inget skript och ingen länkare: programmets egen kod anropar
loadern med filens nummer (`lda #fil / jsr $0200`), anropar delen den laddade, laddar nästa och så vidare. Den koden är
skriptet. `readBoozeDisk()` (`packages/core/src/c64/booze-disk.ts`) läser diskens filer, och `findBoozeScript()`
(`packages/core/src/analyze/booze.ts`) läser skriptet ur programmet (`AnalysisResult.booze`, `BoozeScript`,
`BoozeStep`) när analysen hittat BoozeLoader (8.11c).

**Disken:**
- **Drivkoden** ligger i 18/18, 18/15 och 18/12. Drivenheten läser den själv: startprogrammet skickar ett enda `M-E` på
  39 byte, vars egna byte låter DOS:en läsa de tre sektorerna med sin jobbkö och starta koden. Därför finns drivkoden
  aldrig i C64:ans minne. 18/18 börjar med `tsx / stx $04xx` och anropar `jsr $f50a / bvc *`. DOS:en söker spåren (jobb
  `$e0` kör koden på `$0300`), GCR avkodas medan byten skickas, och sektorerna följs genom sina länkar.
- **Sidan** står i byte `$ff` i 18/0 (`'1'`, `'2'`; Edge of Disgraces startdisk har `'0'`). C64:an väntar på den med ett
  nummer från `$80` (`$b1` är sida 1).
- **Filtabellen** har 2 byte (spår, sektor) per filnummer, i 18/9 (18/6 i Edge of Disgrace). Drivkoden säger vilken
  sektor (`ldx #9 / stx $0f`). En andra sida kan sakna drivkod och ha bara tabellen. Den äldsta versionen (Andropolis,
  Cycle, Tsunami) har ingen tabell: programmet skickar spår och sektor.
- **En fil** är en vanlig kedja av länkade sektorer, med laddadressen först. Den är packad med ByteBoozer så att den
  packas upp på plats medan den laddas. En kedja som är längre än vad minnet rymmer tar programmet i bitar (en fil i
  Edge of Disgrace).

**ByteBoozer 2.0** (`unpackByteBoozer2()`, från 2016) skriver vart filen packas upp (2 byte) och sedan strömmen:
- Bitarna läses uppifrån i en byte, som hämtas när den behövs, mellan de andra byten.
- En typbit kommer före en literal (0) eller en kopia (1), men inte före kopian efter en literal kortare än 255.
- En längd är 1 och, så länge en 1 kommer, nästa bit (sammanflätad Elias-gamma, högst 8 bitar). En literal är så många
  byte, en kopia en byte mer. 255 avslutar strömmen.
- Två bitar till, och om kopian är längre än 2, väljer offsetens bredd: 3, 6, 8 eller 10 bitar efter en kopia på 2,
  annars 4, 7, 10 eller 13. Under 8 bitar är offset − 1 bitarna inverterade. Från 8 kommer de höga bitarna som de är och
  sedan den låga byten inverterad.
- En byte som packaren lämnat efter slutet godtas (den påbörjade en byte med bitar som den inte behövde).

**ByteBoozer 1.x** (`unpackByteBoozer1()`, till 2015) skriver först en byte med bitar (redan skiftad, som uppackaren
håller dem), sedan vart filen packas upp och strömmen. Literaler, kopior och slutet är som i 2.0, men offseten byggs av
grupper: 2 bitars prefix ger 4, 2, 2 eller 2 bitar efter en kopia på 2 och 5, 2, 2 eller 3 efter en längre, och före
varje grupp efter den första läggs 1 till.

En disk räknas som en BoozeLoader-disk när drivkoden finns där. Utan drivkod (en andra sida) prövas tabellen i 18/9 och
18/6, och minst hälften av filerna måste packas upp. Den ByteBoozer som packar upp flest av diskens filer gäller för
hela disken.

**Skriptet:**
- **Loaderns ingång** är en rutin nära dess residenta delar som börjar som den (`pha / jsr` som skickar numret, eller
  `cmp #2 / bne` i den äldsta versionen), eller en adress som programmet inte har än (den residenta delen kopieras dit
  senare) och anropar med ett nummer i A minst tre gånger.
- **Sträckorna** är koden runt varje anrop av loadern, bakåt till instruktionen efter en `rts`, `rti` eller `jmp` och
  framåt till en sådan.
- **Ofta spåras skriptet inte**, eftersom det kopieras någon annanstans innan det körs eller bara nås från loaderns egen
  sida. Då läses `lda #n / jsr loader` också i byte som analysen inte spårat: bakåt över `jsr`, laddningar med `#` och
  skrivningar, framåt till en `rts` eller `jmp`. En sådan sträcka måste ladda minst två gånger eller ligga högst 64
  byte från nästa anrop (en rad små rutiner, som Triads).
- **Ett svansanrop** (`lda #n / jmp loader`) laddar också.
- **Stegen** är laddningar (`load $07`), sidbyten (`side 2`) och andra anrop (`call $4003 a=$04 x=$05`), med A, X och Y
  som laddningarna med `#` närmast före sätter dem. I den äldsta versionen är en laddning spår och sektor (`load 3/0`).
  Där laddar A = 1 utan att packa upp (`load 3/0 as it is`), och A = 2 packar upp det som ligger på X/Y (`unpack $4000`).
- **Källkoden:** filhuvudet har skriptet som kommentarer, och en `====`-rad markerar var varje sträcka börjar.

**I appen:**
- Explorer säger om en monterad disk *BoozeLoader disk: N files the loader reads, not in the directory*, med knappen
  **Booze script**.
- Bottenpanelens flik **Booze script** finns när en sådan disk är monterad eller när analysen hittat skriptet. Antalet
  är skriptets laddningar plus diskens filer.
- Diskens filer har en rad var: nummer, var filen laddas, vart den packas upp, storlek (packad → uppackad), ett filnamn
  (`file07_2000.prg`, påhittat av numret och uppackningsadressen; `t3s0_1000.prg` på en disk utan tabell) och
  anmärkningar (*packed with ByteBoozer 2*, *not packed*, var filen börjar och hur många sektorer den har). Ett klick
  öppnar filen som en PRG, uppackad där den packas upp, och **+** lägger till den. **Copy list** kopierar listan.
  **Save files…** sparar varje fil som PRG (uppackad, annars så mycket minnet rymmer) och, när det skiljer, som den är
  på disken (`.b1`/`.b2` packad, `.raw` för en fil längre än minnet), med listan (`<disk>-booze.txt`). **Add files to
  project** lägger till alla (13.5).
- Skriptet har en rad per steg: var dess kod börjar, raden och filen på den monterade disken med vart den packas upp
  (när skriptet är på diskens sida). Ett klick går till koden, och knappen öppnar filen. **Copy script** kopierar
  skriptet, varje laddning med sin fil.

**Mätt:**
- Alla 276 414 diskar i referensarkivet lästes på 7,5 minuter. 379 är BoozeLoader-diskar, 57 olika räknat efter
  innehåll: 45 med drivkod och 12 utan (Codeboys & Endians sida 2 och 11 av Triad och Twilight, vars startprogram
  skickar drivkoden själva). 41 har tabellen i 18/9, 6 i 18/6 och 10 ingen tabell; 25 är packade med ByteBoozer 2 och
  30 med ByteBoozer 1. Utöver Booze Designs egna finns demos av Afrika, Hitmen, Genesis Project, Paragon, c0zmo, Triad
  och Twilight. Ingen av dem är en Bitfire- eller Spindle-disk.
- Av de 57 diskarnas 1 281 filer packas 1 267 upp, och 47 diskar packas upp helt. De som inte packas upp är
  startprogram som också står i tabellen, data som inte är packad och Edge of Disgraces fil på 302 sektorer.
- Codeboys & Endians sida 1: alla 39 filer packas upp, de 25 som Sindri laddade när demot kördes hamnar på samma
  adresser, och fil `$19` är byte för byte lik minnet efter laddningen.
- Startprogrammen på 904 olika diskar (CSDB Top500 och Booze Design; 865 som Sindri packade upp) analyserades med och
  utan BoozeLoader: 30 fynd ändrades, alla från *A fast loader (not one of the known ones)* till BoozeLoader, och inget
  annat. 26 av dem fick ett skript (704 laddningar, 19 lästa delvis ur byte som inte spårats). De 4 utan är Edge of
  Disgraces startdisk, Andropolis (ett enda anrop i det programmet), Industrial Breakdown och Mekanix.
- Triads demos anropar loadern med ett svansanrop (`lda #n / jmp loader`), som också räknas som en laddning.

**Test:** `test/booze-disk.test.ts` och `test/booze.test.ts`, med diskar och filer som `test/helpers/booze-disk.ts`
skriver som BoozeLoaders diskar och ByteBoozer 1 och 2 ser ut (egna enkla packare; av drivkoden bara de få byte som den
känns igen på). Testerna täcker literaler (också 255 med en typbit efter), kopior med alla offsetbredder och prefix,
filer packade på plats, tabellen i 18/9 och 18/6, en sida utan drivkod, en disk utan tabell, diskar som inte är
BoozeLoaders, skriptet spårat och i byte som inte spårats, och den äldsta versionen. `fixtures/d64/booze-demo.d64` är en
av diskarna: ett startprogram vars kod laddar fil 0–2, rasterdemot packat med ByteBoozer 2, en tabell som inte är packad
och en fil packad på plats.

### 13.5e Bandavbilder (.tap)

**Insert tape image (TAP, T64)…** (File-menyn, kommandopaletten, knappen *Insert TAP/T64…* på den tomma startsidan, Smart attach,
eller dra och släpp en `.tap`) lägger ett band i datasetten. Bandet är ett eget tillstånd bredvid den monterade
disken, med en egen sektion *Tape* i Explorer (under *Disk*) och en egen utmatningsknapp, men det som laddas sist är
det man arbetar med: ett band som läggs i matar ut disken, och en disk som monteras matar ut bandet (toasten slutar
då med *; ejected spel.tap*), så att Explorer, bottenpanelens flikar och Build & Run inte har kvar ett medium från
förut. Båda ligger kvar bara när de kommer i samma steg: Smart attach med en disk och ett band, eller båda släppta på
fönstret på en gång. `readTape()` (`packages/core/src/c64/tap.ts`) läser avbilden:

- **Pulserna.** En TAP (`C64-TAPE-RAW`) har längden på varje puls som datasettens läshuvud skickar till CIA1:s
  FLAG-linje, från en fallande flank till nästa: version 0 en byte per puls i enheter om 8 cykler (0 = en paus),
  version 1 samma men 0 följt av exakta cykler i 3 byte, version 2 (C16:s) halvvågor, två per puls.
- **KERNAL:ns format (CBM).** En ledare av korta pulser, varje byte en lång och en mellanlång puls och 9 bitpar (kort +
  mellan = 0, mellan + kort = 1, lägsta biten först, sist udda paritet), lång + kort i blockets slut. En fil är ett
  huvudblock på 192 byte (typ, start, slut, namn och resten av bandbufferten vid `$033c`, där många bandladdare har sin
  kod) och ett datablock, vart och ett två gånger (synkbyten `$89`…`$81`, kopian `$09`…`$01`) med en XOR-kontrollsumma.
  Pulslängderna följer bandets fart (kort från ledaren, mellan 1,375× och lång 1,79×, justerade efter varje bit). Den
  kopia som lästes rent används; annars slås kopiorna ihop byte för byte, och felet står vid filen. Ett datablock på 192
  byte som ser ut som ett huvud tas som data när huvudet säger 192 byte. Ett relokerbart program (typ 1) laddas av
  `LOAD` (sekundäradress 0, som SHIFT+RUN/STOP) i början av BASIC, så det öppnas vid `$0801` och var det sparades ifrån
  står vid filen. Ett huvud som säger mer än datablocket har (en laddare som tar över medan KERNAL:n laddar) står som en
  anmärkning, inte ett fel: filen är det blocket har. Ett block som har fler byte än huvudet säger (en hel bandbuffert på
  192 byte för de 12 eller 52 en bootfil laddar över vektorerna vid `$0300`) är filen bara till huvudets slut, som
  KERNAL:n lagrar det och VICE laddar det; anmärkningen säger hur många byte blocket har.
- **TapeTool (Martin Piper).** Se 13.5g.
- **Turbo Tape 64** (och Action Replay 7.2:s "Turbo Tape 250"): en 0 och en 1 omkring 263 cykler isär, högsta biten
  först, ledaren `$02`, synk `$09`…`$01`; ett huvud (1, start, slut, en byte, namnet) och ett datablock (0, byten,
  XOR). Datablocket läses till den längd huvudet anger (datan kan innehålla `$02`), och en kontrollsumma som stämmer är
  det som skiljer Turbo Tape från andra laddare med samma ledare och synk.
- **Freeload** (Oceans, och Imagines, CRL:s, Domarks, Gremlins band) och **US Golds bandladdare** (Turbo Out Run, 720,
  Masters of the Universe): två pulslängder, högsta biten först; en ledare av en byte (Freeload `$40`, US Gold `$20`)
  och en synkbyte (`$5a`, `$ff`), sedan US Golds 16 byte namn (PETSCII, mellanslag som `$20`), start och slut (lägsta
  byten först, slutet ett förbi), datan och en XOR-kontrollsumma. Formaten lärdes ur Sindris körningar av banden:
  byten laddaren lagrade medan motorn gick, hittade i bandets bitar (8.11c). Utan namn heter en Freeload-fil
  `file_<start>`. Kontrollsumman skiljer filerna från data som råkar ha ledaren och synken. En fil vars summa inte
  stämmer läses ändå när en lång ledare (minst 16 byte; äkta filer har 64–128) leder till den, sträckan slutar med
  summan (högst 64 bitar efter den) och andra filer i samma format på bandet har summor som stämmer: laddarna
  kontrollerar inte alla summor (Ghostbusters bootfil, Kixx, jämför bara summan för den sista filen i en rad, inte för
  teckensnittet vid `$7000` före den). Filen får felet `checksum: the data's XOR is …, the tape says …`. Utan någon fil
  vars summa stämmer (Hero Quest, Epyx band) är det ett annat format med samma ledare och synk, och Rainbow Islands
  nivåfiler har 35 byte till efter summan: de förblir okänd turbodata. Ett huvud vars slut tar med summan läses också:
  slutar sträckan där summan skulle börja (färre än 8 bitar kvar) och är XOR av all data 0, så är den sista byten
  summan av de andra. Gauntlets första nivå `A` på nivåbandet (`$2000`–`$2e01`, i The Deeper Dungeons `$2000`–`$3401`):
  spelet ber om `A` en gång och sedan `A1` för varje nivå, dess laddare (vid `$0934`, via LOAD-vektorn) lagrar alla
  3 585 byte, summan vid `$2e00`, läser en summa ur nästa fils ledare och spelet ser inte på status. Filen tas med de
  byte laddaren lagrar och anteckningen `the header's end takes in the sum …`, utan fel.
- **Mega-Save** (Palace, Hewson, Level 9, Alligata, Llamasoft, CRL …; Tazz, Cauldron, Firelord, Iridis Alpha): laddaren
  i bootfilens bandhuvud (`$0351`, startad av bootfilen vid `$02a7`) startar om CIA2:s timer B vid varje puls, en
  one-shot från `$0107`, `$016e` eller `$01fa` cykler (de tre hastigheterna), och en 1 är att den hann ta slut; högsta
  biten först. Varje fil: `$20`-byte, en ledare av `$63` (minst åtta här; banden har hundratals, en tabell med byten 0
  till 255 i annan data har en), synkbyten `$64`…`$ff`, en byte som inte är 0, ett huvud på 10 byte (start, slut, ett
  förbi, `$0000` till minnets slut, var programmet startas, en flagga för att ladda nästa fil och en för att hoppa dit,
  två till), datan och en XOR-kontrollsumma. Filen heter `file_<start>`; Tape-flikens anteckning säger vad laddaren gör
  sedan: går vidare till nästa fil, startar den på adressen, eller RUN (BASIC länkas om och RUN skrivs i
  tangentbordsbufferten). Formatet lästes ur Tazz bootkod; en fil vars summa inte stämmer behålls, med felet.
- **Novaload** (Novagens egen, och Elites, Encores, US Golds Americana, Epyx, MicroProse, Martech, Activision …;
  Paperboy, Mercenary, 1942, Winter Games): en puls längre än cirka 500 cykler är en 1 (CIA1:s timer A, one-shot från
  `$03f4`, har hunnit under `$0200`; den första Novaload läser toppbiten av `$81f4`), lägsta biten först; före varje fil
  en ledare av 0-bitar (cirka 2 060; minst 256 här, annan data har några dussin före en 1 och `$aa`), en 1 och synkbyten
  `$aa`. Sedan något av två:
  - *en fil* (det Novaloads LOAD läser, med namn): namnets längd, namnet, starten minus 256, slutet, antal byte i sista
    blocket och antal block plus ett, summan av de byten; sedan blocken, 256 byte vart utom det sista, vart och ett följt
    av summan av alla byte efter synkbyten (de tidigare summorna med). Antalet block ska stämma med start och slut. Filen
    heter som på bandet, utan namn `file_<start>`;
  - *sidor*, som laddaren i bootfilens bandhuvud läser i sitt avbrott (med ett pip på SID:en för varje byte): byten
    `$55`, sedan sida för sida (sidans nummer, dess 256 byte, summan av dem och numret) till en sida 0. Sidor som följer
    på varandra i minnet blir en fil `file_<start>`, och Tape-flikens anteckning säger hur många sidor den har. Två sidor
    ska stämma: en sida stämmer ibland av en slump i annan data.

  Formaten lästes ur Paperboys (Elite) bootkod och den LOAD den lägger i `$0330`, körda i Sindri med bandet: alla
  81 356 byte de lagrade är desamma som läsaren ger, i samma ordning. Den äldre Novaload (Turbo Esprit) läser samma
  filer med samma summor. Ett block eller en sida vars summa inte stämmer behålls, med felet.
- **Wildload**, Interceptor Micros laddare (TAPClean:s namn; varje kedjas första block fyller bandbufferten med "WILD
  SAVE (C) INTERCEPTOR MICROS 1987 WRITTEN BY ANDREW CHALLIS JANUARY 1987", och analysen, 8.11c, kallar den Wildload
  (Interceptor Micros). Activision, Thalamus Hits, Electric Dreams, Domark, Image Works, Incentive, Mirrorsoft …; Delta,
  Karnov, International Karate, APB, Joe Blade):
  bootfilen, som startar genom IRQ-vektorn som KERNAL:ns LOAD lägger tillbaka från `$029f`, läser laddarens 208 byte
  till stacksidan med KERNAL:n (`$f84a`), dekrypterar dem med sitt bandhuvud och läser resten i ett avbrott på
  FLAG-linjen: CIA1:s timer A, omstartad från `$03e0` vid varje puls, har gått under `$0200` (bit 1 i dess höga byte)
  efter en puls längre än cirka 480 cykler, och det är en 1; lägsta biten först. En ledare av `$a0` (som laddaren letar
  efter bit för bit; banden har 230–256, minst 32 här), synkbyten `$0a`…`$01`, sedan block direkt efter varandra: ett
  huvud på 5 byte (adressen till blockets sista byte, antal byte, en flagga), byten från den sista och nedåt, var och en
  XOR den låga byten i sin adress, och XOR av byten den lagrat. Ett huvud med flaggan `$fe` avslutar kedjan (laddaren
  hoppar in i det den laddat, på olika ställen i olika spel), `$ff` får den att leta efter nästa ledare; annars är det
  ett block, som lagras med `$01` = 0 när flaggan är 0 (i RAM under I/O), annars med `$01` = 5, så att ett block vid
  `$d000`–`$dfff` hamnar i VIC:ens och CIA:ornas register och färgminnet: så sätter kedjan upp laddbilden. Varje block
  är en fil `file_<start>`, och Tape-flikens anteckning säger när ett block går till I/O eller under den och vad
  laddaren gör efter kedjans sista block. Det första blocket i en kedja ska ha en summa som stämmer: Microload
  (Interceptors egna band: Bigtop Barney, Front Line) och Rainbow Arts laddare har samma ledare och synk men andra
  huvuden. Ett senare block vars summa inte stämmer behålls, med felet, och ett som bandet tar slut i ger de byte som
  finns på det. Formatet lästes ur Deltas (Thalamus) laddare, körd i Sindri med bandet: alla 55 398 byte den lagrade
  är läsarens, i samma ordning.
- **Microload** (TAPClean:s namn; Interceptor Micros egna spel: Bigtop Barney, Front Line, Guzzler, Melonmania; och
  Electric Dreams Aliens, Chameleon, Dandy, Epyx Movie Monster Game, Winter Games, Jumpman, Players Velocipede, Ronald
  Rubberduck, och den första filen på Magic Bytes band): laddaren ligger i bootfilens bandhuvud, vid `$0351`, och
  bootfilen vid `$02a7`, som BASIC:s väntevektor `$0302` startar, gör den till avbrottet vid `$fffe`. Varje puls på
  FLAG-linjen startar om CIA2:s timer A från `$014d`, och en 1 är att den hann ta slut (333 cykler); lägsta biten först.
  En ledare av `$a0` (som laddaren letar efter bit för bit; 255 byte på banden, 857 på Magic Bytes, minst 32 här),
  synkbyten `$0a`…`$01` (laddaren skriver om sin egen gren för varje steg), sedan starten och längden som ett negativt
  tal (som räknas upp till 0), datan från första byten och uppåt och deras XOR. En summa som inte stämmer startar om
  datorn (`$fcf2`). Bootfilen säger hur många filer laddaren läser (`$fa`) och var spelet startar; den första filens
  kod körs medan resten laddas. Varje fil heter `file_<start>`. Bandet stannar efter varje fil, så en fil vars summa
  inte stämmer tas bara där sträckan slutar med den (med felet): Wildloads kedjor och Rainbow Arts block (ett
  blocknummer före starten) har samma ledare och synk, och lästa som Microload hamnar deras längder någon annanstans.
  En Wildload-kedja eller en Microload-fil tar sina pulser: en fil i ett annat format inne i dem är deras data som
  råkar ha dess ledare, synk och en summa som stämmer (en Freeload-fil på 64 byte i Ronald Rubberducks `$0800`).
  Formatet lästes ur Bigtop Barneys bootkod, körd i Sindri med bandet.
- **Cyberload** (System 3, Thalamus, Activision, Accolade, Electronic Arts, MicroProse, Gremlin, Virgin …): en puls
  längre än CIA1:s timer A (one-shot, oftast cirka 500 cykler) är en 1, högsta biten först, och varje synkbyte har en
  ledare av `$0f`-byte före sig (minst fyra här). Laddaren laddar i fyra steg efter KERNAL-bootfilen, var och ett i ett
  eget format; de lärdes ur Tuskers och The Last Ninjas steg, körda i Sindri med bandet, och det de läser stämmer byte
  för byte med det Cyberloads egen kod lagrade i körningen.
  - *Första steget* (som laddaren i bandhuvudet läser när den dekrypterat sig): synken `$f0`, sedan en byte att lägga
    till adressen den lagrar på (den börjar på `$ffd5`, så den första går till nollsidan) och byte, var och en följd av
    en bit: 1 lagra och fortsätt, 0 lagra inte (den blir kvar på stacken) och en bit till, 1 en ny byte att lägga till,
    0 slut. Det lägger andra stegets kod i nollsidan och sin egen igen i bandbufferten, med bandhuvudets första 21 byte
    som de var (det är så det känns igen, och var `$033c` ligger), och dess RTS tar de två sista byten den lämnade på
    stacken: in i nollsidan (`$0002`). Filen är dess byte från den första den lagrar till den sista, med det bootfilen
    lämnade emellan (IRQ-vektorn `$0314/$0315` som KERNAL:ns LOAD lade tillbaka från `$029f/$02a0`).
  - *Andra steget* (koden i nollsidan): synken `$f0`, adress och längd XOR en nyckel, byten XOR en annan, ingen
    kontrollsumma; längden ska ta sträckan till dess slut. Koden dekrypterar sig själv med byten vid `$0314`, så
    nycklarna läses genom att köra den på Sindris 6510 tills den anropar bytläsaren i bandbufferten (`ldx #0 / jsr … /
    eor #k1 / sta $02,x / inx / cpx #4 / bcc / jsr … / eor #k2`): `$ae`/`$d2` på de flesta band, `$9c`/`$7a` på
    Firebirds (HERO, Ubik's Musik), andra på The Last Ninja.
  - *Tredje steget* (i ett avbrott på FLAG-linjen): block med synken `$cc` och ett huvud på 8 byte: adressen, antal
    byte (0: 256), en byte som gör XOR av huvudet och datan 0, flaggor (bit 7: laddaren anropar adressen i huvudets två
    sista byte efter blocket), en byte, den adressen; sedan datan. Block som fortsätter där det förra slutade blir en
    fil (`file_<start>`), som slutar med ett block med bit 7 (anteckningen säger vart laddaren hoppar) eller där
    adressen inte fortsätter. Ett block vars summa inte stämmer tas bara där det fortsätter filen, med ett fel.
  - *Fjärde steget*, Cyberloads LOAD med namn (också i spelets minne, för dess nivåer): en synkbyte som spelet väljer
    (`$aa` på de flesta, `$55` på Myth; inte de andra stegens `$cc` och `$f0`), ett huvud med 16 byte namn,
    laddadress och längd, på de senare banden (Tuskers) ett ord vars 1,5 gånger är timern datan läses med, och XOR av
    huvudet; en byte till på de senare; sedan datan 256 byte i taget, var och en följd av XOR av allt sedan huvudet.
    Vilket huvud det är visar sig på att blocken stämmer. Namnet ska vara tecken man kan skriva, med mellanslag eller
    nollor efter (`D`, `0B`, `0:MINI-PUTT`, Accolades `TITLE.GRA`): data av en och samma byte om och om igen har XOR 0
    vad den än är, och togs annars för huvuden.
- **Firebirds bandladdare** (Firebird, Silverbird, Rainbird, och Psygnosis, Odin, Thor, Activision, Melbourne House,
  Ariolasoft …; Bubble Bobble, Thrust, Gunstar, Blood Money, Rock n Wrestle): bootfilen laddar laddaren med KERNAL:n
  (Bubble Bobbles andra fil, `$1c00`–`$1dff`) och den läser bandet i ett avbrott på FLAG-linjen som startar om CIA2:s
  timer A, en one-shot från `$0232` cykler, och en 1 är att den hann ta slut; högsta biten först. Den söker sin
  ledarbyte bit för bit och läser sedan hela byte till en ring på 32 vid `$033c`. Varje block: ledarbyten (9–11 på
  banden, minst fyra här), dess komplement och ledarbyten igen, sedan ett av två slag:
  - *första steget* (laddaren bootfilen laddar): nästa blocks ledarbyte (det första blockets är `$0f`), blockets nummer
    (från 0) och adress; 256 byte (64 i block 0), en byte och så många byte laddaren hoppar över (0: 256), datans XOR
    och vart laddaren hoppar efter blocket: tillbaka in i sig själv, det sista blockets in i koden det har med sig.
    Blocken bildar en kedja (varje block har den ledarbyte och det nummer det förra sa), och kedjan blir filer av det
    minne den fyller: ett block som fortsätter där ett annat slutar hör till dess fil, och en sida som laddas igen räknas
    (Bubble Bobbles laddare laddar sin egen sida vid `$1c00` fem gånger mitt i spelet, samma byte); de senare bytena
    gäller. Filen heter `file_<start>`, och Tape-flikens anteckning säger hur många block den har, hur många gånger den
    laddats och vart laddaren hoppar efter den när det inte är tillbaka in i sig själv. Det sista blocket (Bubble
    Bobbles `$bf00`) dekrypterar det som laddats, varje spel på sitt eget sätt (Bubble Bobbles med blocket vid `$0200`
    och laddarens två sidor, och åtta byte till från bandet: nyckeln, från och till, vart det hoppar), så filerna är
    byten som laddaren lagrade dem; Sindri kör resten;
  - *filer* som en andra laddare läser, som programmet laddat med första steget och anropar (Bubble Bobbles vid `$4900`,
    för `$5800`–`$cfff` och `$0400`–`$47ff`): samma läsning, en ledarbyte för hela filen, och i varje block numret
    (från 0 i varje fil), adressen, en byte (0), sidan filen slutar före (0: minnets slut), vart laddaren hoppar efter
    filen (0: den återvänder), 256 byte och deras XOR. Block som följer på varandra i minnet med samma ledarbyte, slut och
    hopp är en fil `file_<start>`; anteckningen säger ledarbyten, antalet block och vad laddaren gör sedan, och block
    som saknas i början eller slutet står som fel.

  En kedja eller fil behöver två block vars summa stämmer (eller ett block som är en hel fil): data med en ledarbyte,
  komplementet och en summa som råkar stämma ger enstaka block, och ledarbyten är inte `$00` eller `$ff` (data av nollor
  har dem). Ett block vars summa inte stämmer tas bara där det fortsätter en kedja eller fil, med felet. Formaten lästes
  ur Bubble Bobbles laddare vid `$1c00` och den dess första steg dekrypterar, körda i Sindri med bandet; alla 72 256
  byte i filerna är byte de lagrade.
- **Bandets andra sida, baklänges.** Där den här sidan är tom kan datasetten höra det som är inspelat på kassettens
  andra sida. Den sidan går åt andra hållet, så dess pulser kommer sist först, dess filer från slutet till pilotens
  början och varje byte med bitarna åt andra hållet. En sträcka som inget format läser läses därför också baklänges
  (`backwardsFiles`, med Cyberloads LOAD med namn, fjärde steget ovan). En fil som fortsätter in under den här sidans
  inspelning (där hörs den andra sidan inte) tas så långt dess hela block räcker, när minst två av dem stämmer, med ett
  fel som säger var bandet slutar ha den och var huvudet säger att den slutar; spelad framlänges tas en sådan fil inte
  (laddaren läser vidare). Filen står med formatet och **◂** i Explorer (*other side ◂* i Tape-fliken) och en
  anteckning; ingen laddare på den här sidan laddar den, så den har ingen bootfil (`tapeBoot` ger null) och Sindri kör
  den utan bandet. Preservers *Ik+ system 3.tap*: sida A har en kopia av spelet (KERNAL-bootfilen `IK +`, Novaload-
  filen `NOVA` `$0801`–`$c648`, en Action Replay-backup packad med SuperCrunch) och sedan 122 s "turbodata" med pulser
  på 344 och 728 cykler. Den är sida B:s Cyberload-fil `M` (troligen originalets huvudfil: `$0200`, `$be00` byte, timern
  `$0154` × 1,5 = 510 cykler) baklänges, med piloten och huvudet vid bandets slut; 109 av dess 190 block hörs, de fem
  närmast Novaload-filen med en bit fel var (blocksummorna skiljer på bit 3), och resten ligger under Novaload-filen.
  Läsaren ger `$0200`–`$6eff` (koden vid `$6604` sätter rasteravbrottet `$674f`, som finns där), byte för byte som
  sträckan avkodad för hand. Bara Cyberloads filer läses baklänges: med alla format tog Freeloads svagare kontroll 64
  byte av Rockin Rolls musik (byte `$40` som pilot, en summa som råkade stämma) för en fil. Av arkivets 1 931 band
  ändrades bara IK+ (okända sträckor 8 912 till 8 911); ingen annan fil ändrades.
- **Okänd turbodata.** Det som återstår mellan KERNAL-blocken och pauserna med två pulslängder (en 1 som är 1,3–3 gånger
  så lång som en 0) och som inte är en ledare (fyra bytevärden som utgör 90 %) listas som turbodata som inget format här
  läser, med sina två pulslängder. Den läses av Sindri (13.5f). En sträcka med för få pulser av den andra längden för
  att den ska synas (ett block av nästan bara 0-bitar, som Cyberloads block av en tom del av en bild, när bandet står
  still mellan blocken) läses med längderna från sträckan före, när nio av tio av dess pulser har dem.

Explorer listar filerna i bandordning med var de börjar (m:ss), namnet (`+header` när bandbufferten har kod), typen
(KERNAL-filer `PRG`/`BASIC`/`SEQ`) eller formatet, och ett klick öppnar en fil som ett nytt projekt, **+** lägger till
den. En KERNAL-fil vars huvud har kod öppnas med huvudet som en andra fil, `<namn>-header.prg` vid `$033c-$03fb`
(bandbufferten): där ligger bandladdarens kod, som ska återassembleras med datan. Huvudfilen körs inte av Sindri (den
är inget program). **Unpack** av bootfilen ersätter både den och huvudfilen med det uppackade programmet: de är en
KERNAL-fil i två, och Sindri körde dem tillsammans. Annars skulle huvudfilen ligga kvar under programmet där det täcker
bandbufferten (Tuskers första steg, `$029f-$07e7`, och spelet, `$0200-$fd94`), den senare filen vinna de byten, och det
uppackade programmet inte gå att bygga byte för byte (Build & Run: *Build failed verification*); med två filer satte
Unpack inte heller någon programstart. Var de enda två filerna i projektet blir det uppackade ett projekt för sig, med
starten och `$01` från Sindri. En fil i en turboladdares format (ett block i en Wildload-kedja, en Cyberload-del, en
TinyHeader-fil …) som inte kör där den laddas körs av Sindri från bandets bootfil, vars laddare laddar den, och
**Unpack** ger programmet laddaren laddar den i (13.5f, *En turbofil som inte startar där den laddas*). SEQ-filer, slutmarkören och filer utan känd laddadress (en TinyHeader-fil vars bootladdare inte kunde
läsas) listas men öppnas inte. Under listan står hur många TapeTool-filer och sträckor med okänd turbodata bandet har.

**Bandet som på en C64.** Samma inställning som disken, Settings → General → *The disk and the tape in the Explorer* →
*As on a C64* (13.5), visar bandet som en C64 visar det, i dess teckensnitt och färger med samma ritning som katalogen
(`components/C64Screen.tsx`), på två sätt (`packages/core/src/c64/tapelist.ts`).

*Som en katalog* (förvalt, `tapeDirectory`). Ett band har ingen katalog, så skärmen är katalogen som bandets filer
skulle ge på en disk, listad som `LOAD"$",8` och `LIST` listar en disks med samma regler och skärmeditor (`dirlist.ts`:
`fileLine`, `headerLine`, `directoryLines`, `listScreen`), som VICE listar ett bands innehåll när det sätts i
(`imagecontents/tapecontents.c`):

- Diskens rad (RVS efter nollan): bandets namn, en T64:s eget och annars bandfilens namn utan `.tap`/`.t64` med stora
  bokstäver, och där en disk har sitt ID bandets längd (`m:ss`; en T64: `T64`).
- En rad per fil i bandets ordning, alla format, även turboladdarnas; slutmarkören utelämnas. Blocken är de filen skulle
  ta på en 1541 (laddadressen medräknad, 254 byte per block: DEMO med 12 287 byte är 49). Namnet: mellanslagen efter det
  är KERNAL:ns utfyllnad och avslutar det som shiftade mellanslag gör på en disk; därefter gäller 1541:ans regler (första
  citattecknet stänger, byten efter förlorar bit 7, kontrollkoder inom citattecken visas inverterade och utanför verkar
  de). Typen är PRG eller SEQ (en datafil, och data utan huvud som heter `(NO HEADER)`), en T64:s C64S-ögonblicksbild FRZ;
  en turboladdares fil har ett `T` före typen (`TPRG`), där en disk har `*`, eftersom KERNAL:n inte kan ladda den (VICE
  märker Turbo Tape-filer så). En fil som bandet inte ger något namn får Mimirs namn med stora bokstäver och `_` som
  PETSCII `$a4` (▁): `"FILE▁C000"`.
- Ingen `BLOCKS FREE.`-rad (VICE har ingen för band heller); `READY.` och den blinkande markören efter sista raden.

En fils rad öppnar filen och **+** lägger till den, som disken. Filer som namns kontrollkoder skrev över står under
skärmen med raderna från Mimirs lista.

*Som LOAD hittar dem* (**FOUND** bredvid **Aa**, `tapeScreen`): det KERNAL:n skriver när `LOAD` söker igenom bandet
till slutet efter ett namn som ingen fil har, utskrivet med katalogens skärmeditor:

- `PRESS PLAY ON TAPE`, `OK` när PLAY trycks och `SEARCHING`, var och ett efter en RETURN (`OK` med en efter sig också),
  som meddelandena vid `$f0bd` i KERNAL:n har dem; `FOR` och namnet som LOAD fick är utelämnade.
- KERNAL:n läser varje block på bandet till bandbufferten vid `$033c` och tar det för ett huvud när första byten är 1,
  3 eller 4 (FAH vid `$f72c`): `FOUND` efter en RETURN, sedan byte 5–20 i bufferten genom CHROUT, alla 16 med
  utfyllnaden, så att namnens färgkoder, RVS, citattecken, markörrörelser, DEL, CLR och `$0e` verkar som på C64:an. Ett
  programs datablock som börjar med 1, 3 eller 4 tas också för ett huvud och skriver en egen `FOUND`-rad: dess byte
  5–20, eller (ett block kortare än 21 byte) det som blocket skrev över huvudet före det, med kontrollsumman efter sista
  byten (DATA4 med datan `04 10 20 30 41` blir `FOUND EATA4`).
- En datafils block (typ 2) hoppas över. Slutmarkören (typ 5) och ett datablock som börjar med 5 avslutar sökandet på
  en C64 med `?DEVICE NOT PRESENT  ERROR` (KERNAL:n lämnar typen som felnummer); skärmen fortsätter förbi dem, som ett
  nytt `LOAD` skulle.
- En turboladdares filer är inga KERNAL-block och syns inte. Ett T64-arkivs filer gör det (VICE:s bandfällor lägger
  varje posts huvud i bufferten), men inte dess C64S-ögonblicksbilder.

Skärmen slutar efter sista `FOUND`, utan `READY.` och utan markör: C64:an söker fortfarande. Raderna som en fil skrev ut
(dess `FOUND` och datablockets) är ett element över bilden: klick eller `Enter` öppnar filen, **+** lägger till den,
`↑` `↓` och markeringen av filerna i projektet som i listan; KERNAL:ns meddelanden och filer som inte öppnas (SEQ) går
inte att öppna. Efter en CLR i ett namn visas skärmen från toppen, som C64:an har den. Under skärmen står, med raderna
från Mimirs lista, filerna som inte är på den, och varför: en turboladdares filer (*which the KERNAL does not see*),
data utan huvud, en T64:s ögonblicksbilder och namn som andra namns kontrollkoder skrev över (Barbarians bootfil
börjar med vit färg och CLR, så bara det sista namnet syns). Slutmarkören står inte där: en C64 visar inget av den.
Bandets längd och huvudraden visas inte. **FOUND** igen visar katalogen. **Aa** bredvid utmatningsknappen byter
teckenuppsättning i båda.

**Test:** `test/tapelist.test.ts` jämför skärmen cell för cell (skärmkod och färg) med x64sc 3.10:s, äkta
datasettemulering, `LOAD"ZZZ"` och PLAY tryckt från VICE:s monitor (`tapectrl 1`), för band med udda namn (färgkoder,
RVS, citattecken, shiftade tecken, 16 tecken, CLR, markör upp, RETURN, DEL, gemener), en datafil, datablock som börjar
som huvuden och slutmarkören (`test/helpers/tapelist-tapes.ts`, VICE:s rader i `test/helpers/tapelist-vice.ts`), och
för `fixtures/tap/cyberload-demo.tap` (bootfilens datablock ger `FOUND :EP[…`) och `fixtures/t64/mimir-demo.t64`.
Mot VICE stämmer också raderna på band ur C64Tapes-org: *Galactic Attack* (där CODE:s datablock börjar med 4 och
skriver `FOUND .8@KS↑π`) och *Crush, Crumble and Chomp* sida 2 (KRAK:s datablock ger ett tomt `FOUND`, ARAC:s börjar
med 5 och avslutar sökandet). VICE:s sökning missar då och då ett block efter en `FOUND`, ett annat varje gång samma
band körs (också med monitorn bara var 20:e sekund), så raderna är tagna ur körningar som läste dem; en körning som
missade DATA4:s huvud men läste dess datablock skrev `FOUND ENEAKY ONE`, DATA1:s datablock med DATA4:s kontrollsumma
över sig, som bufferten här säger. `fixtures/tap/mimir-demo.tap` (TapeTools bootfil, huvud och data i en kopia
var) jämförs inte: efter `FOUND MIMIR TAPE` tömmer VICE skärmen och står på `READY.`. På arkivets 921 band (874 med
KERNAL-filer) ger skärmen 1 200 `FOUND`-rader, 8 av dem från datablock; 314 band har namn med kontrollkoder, och på 9
skriver ett namns koder över ett annat (oftast en CLR i bootfilens namn). `e2e/app.spec.ts` (*the tape as a C64 finds
its files*): inställningen, raderna, öppna, lägga till en turbofil under skärmen, Aa och tillbaka till listan.

**Tape-fliken** (bottenpanelen, bara med ett band i datasetten) visar allt på bandet i bandordning: tid, offset i
TAP-filen, format, namn, laddadress, antal byte och anmärkningar (kopior, kod i huvudet, TapeTools namnbyte, block, RLE,
slumpad ordning, fel); de okända sträckorna med antal pulser och pulslängder. En rad öppnar filen, **+** lägger till
den. **Save files…** sparar varje fil som PRG i en vald mapp (ett TapeTool-band också `boot.bin` och `build.bat`,
13.5g).

Mätt på användarens arkiv (921 band i C64Tapes-org, kommersiella spel): 45 s för alla (49 ms per band), 1 295
KERNAL-filer varav en med läsfel (Froggy: ett skadat datablock), 46 Turbo Tape-filer, 723 Freeload-filer och 613 från
US Golds laddare (på 132 band, 126 av dem utan något kvar som inte läses) och ingen falsk TapeTool-fil; 639 band har
turbodata från en laddare som inte är känd här (765 före Freeload och US Gold), 47 har ingen KERNAL-fil (andra sidor).
I *Preservers/Tap* (1 009 band): 793 Freeload-filer och 996 US Gold-filer på 156 band. Cyberload (2026-11-14): i
C64Tapes-org 487 filer på 41 band (30 första och andra steg, 90 filer av tredje stegets block, 337 av det fjärde),
ingen med fel; sträckorna med okänd turbodata gick från 11 921 till 7 294 och 37 band har inget kvar (Tusker: bootfilen
och 20 filer, de fyra stegen och nivåerna D–P). I Preservers 1 493 filer på 90 band (tre med block vars summa inte
stämmer, med rena pulser: skadade band), 11 890 sträckor till 9 488. Inga filer i andra format försvann; sträckor av
nästan bara 0-bitar gav 6 nya US Gold-filer. Kvar på Creatures, Hawkeye och Snare är Thalamus egen nivåladdare (anropad
vid `$01a0`), inte Cyberload. Mega-Save (2026-11-15): i båda samlingarna (1 931 band) 292 filer på 76 band, alla med
en summa som stämmer (alla bootfilernas laddare är samma kod, bara hastigheten skiljer); sträckorna med okänd turbodata
gick från 16 782 till 16 491 och band med inget kvar från 655 till 728. Inga filer i andra format ändrades. Novaload
(2026-11-16): 3 323 filer på 266 band; sträckorna med okänd turbodata gick från 16 491 till 14 183 och band med inget
kvar från 728 till 986, utan att någon fil i ett annat format ändrades. Äkta ledare har 2 006–2 414 nollbitar; de sex
huvuden med en summa som stämde men ett blockantal som inte gjorde det hade 16–128, liksom alla ensamma sidor och sidor
utan `$55` (upprepade `$aa`); äkta sidor har 9–216. 17 filer har ett fel: 8 där huvudet säger mer än bandet har
(Labyrinths O-filer en byte mer än två block, Beach Head II, Shanghai) och 9 med en blocksumma som inte stämmer, 7 av
dem i sista blocket på rena pulser (Turbo Esprits A: laddaren sätter status `$30`, men spelets laddkod ser inte på den
och VICE laddar vidare). Freeload- och US Gold-filer med en summa som inte stämmer (2026-11-17): i båda samlingarna två,
Ghostbusters (Kixx) teckensnitt vid `$7000` och Chicago 30:s fil vid `$e000`, båda med de byte deras laddare lagrar när
Sindri kör banden (Ghostbusters laddare kopierar teckensnittets första 1 KB till `$f000`); inga andra filer eller
sträckor ändrades (sträckorna med okänd turbodata 14 183 till 14 181). Huvuden vars slut tar med summan (2026-11-18):
av arkivets 2 860 band fick bara Gauntlets fem nivåband sin fil `A` (tre av Gauntlet, två av The Deeper Dungeons, alla
lästa till slutet nu), utan att någon annan fil eller sträcka ändrades. Firebirds laddare (2026-11-17): i båda
samlingarna 371 filer på 57 band, ingen med fel; sträckorna med okänd turbodata gick från 14 181 till 9 333 och band med
inget kvar från 988 till 1 045 (alla 57 läses till slutet), utan att någon fil i ett annat format ändrades. Alla
kedjor börjar med block 0 vid `$0200` och ledarbyten `$0f`, ledarna har 9–11 byte, och det sista blocket hoppar in i
sig självt (`$bf00` på 15 band, annars `$c400`, `$0800`, `$cf00` …). Andra träffar på mönstret (Jack Nicklaus, Pub
Games, Grand Monster Slam, Tour de France) var data av en och samma byte, ledarbyte `$00`, `$ff` eller `$aa`, och ger
inga filer. På 51 av de 57 banden laddar Sindri alla filer, och alla 2 720 704 byte är läsarens (lagrade medan motorn
gick). Först var det 48: Thrust (två avbilder) spelar Firebirds jingel med nedräkningar i RAM som Sindri tog för att
programmet står still, och på Preservers Seabase Delta läste Sindri en lång puls som en nolla efter ett sent avbrott
(en CIA-timer som laddas om tappade ett underflöde); båda är rättade (*Program som väntar på tiden* och *Timing* i
8.11b). De andra sex stannar i programmets egen kod, som i VICE: Blood Money och Flying Shark laddar sina nivåer under
spelet, Captain Fizz väntar på F1, F3 eller F5 i en meny, Star Trek visar sin titel tills avbrottet räknat 2 150
bildrutor (43 s; en väntan på en räknare som avbrottet ökar väntar Sindri inte ut, *Program som väntar på tiden* i
8.11b), Revs laddar Silverstone-banan och väntar sedan på Brands Hatch (ledarbyte `$16`) och huvudfilen (`$17`), som
inte finns på det bandet (VICE står på "LOADING BRANDS HATCH TRACK" efter bandets slut), och Revs Gold Edition väntar
i sin banväljare på två siffertangenter. Wildload (2026-11-18): av arkivets 3 286 band (utom Private) 1 064 filer på
63 band (Activision, Thalamus Hits, Electric Dreams, Domark, Image Works, Incentive, Mirrorsoft, Players …), 4 383 276
byte, ingen med fel; sträckorna med okänd turbodata gick från 10 119 till 9 880 och band med inget kvar från 1 668 till
1 730, utan att någon fil i ett annat format ändrades. Alla 239 kedjor slutar med ett huvud med `$fe` eller `$ff`, alla
ledare har 230–256 byte, och alla bootfiler dekrypterar samma laddare, bara med en annan kantfärg, nollsidans variabler
flyttade (Firetrack, Explorer), timer B (Quedex) eller ett annat hopp efter kedjan (`$02eb` i Delta). Kvar är Karnov
sida B:s två första sträckor, som är skadade på avbilden (pulser på 128–144 cykler bland bitarna, synken bryts efter
`$0a $09 $08`). Microloads band (Interceptors egna, 224 och 432 cykler, Bigtop Barney, Front Line) och Rainbow Arts och
Magic Bytes (cirka 200 och 440 cykler, ledare på 800–1 000 byte) har samma ledare och synk, men deras första block
stämmer inte som Wildload och ger inga filer. Sindri körde de 59 banden med en bootfil: på 48 laddar den alla
Wildload-block, och alla 3 142 703 byte laddaren lagrade (`sta (zp),y` efter `eor zp`, var laddaren än låg) är
läsarens i samma ordning. De andra elva stannar i spelens egen kod: nivåer och banor som laddas under spelet (Karnov,
Super Hang-On, Super Sprint, Championship Baseball, Quedex), Bombuzal som väntar vid `$0a0a`, och två avbilder där
Wildload-spelet kommer efter ett annat spels bootfil (Basket Master: Imagines Freeload-filer och sedan Championship
Sprint; Zzap-bandet). Microload (2026-11-19): 185 filer på 35 band, 2 263 780 byte, ingen med fel; sträckorna med
okänd turbodata gick från 9 880 till 9 699 och band med inget kvar från 1 730 till 1 763. Den enda andra ändringen är en
Freeload-fil på 64 byte vid `$8040` som försvann på båda avbilderna av Ronald Rubberduck: den låg inne i Microload-filen
vid `$0800`, vars byte laddaren lagrar (Sindri). Alla 35 bootfiler har samma laddare, bara antalet filer och var
spelet startar skiljer, och alla ledare har 255 byte utom Magic Bytes 857. Kvar på de banden är Rainbow Arts block
(Clever & Smart, Western Games). Sindri körde de 34 banden med en bootfil: på 28 laddar den alla filer, och alla
1 481 929 byte laddaren lagrade är läsarens i samma ordning; de andra laddar mer senare (Winter Games grenar, Movie
Monster Games delar, Aliens, Vampire's Empire) eller börjar med ett BASIC-program (Token of Ghall). `test/tap.test.ts`
läser det
`makeTap()` skriver (namn, typer, adresser, båda kopiorna, en trasig puls i en kopia eller båda), versionerna 0–2,
relokeringen, TapeTool och Turbo Tape, Cyberloads fyra steg (skrivna av `test/helpers/cyberload-tape.ts`, med en egen
kod för andra steget), Wildloads kedjor (`wildChain` i `test/helpers/tapetool-tape.ts`: block som laddas nedifrån, I/O
och RAM under den, båda slutflaggorna, en summa som inte stämmer, ett block bandet tar slut i, en sträcka som börjar
med bitarna 1, 0, 1), Microloads filer (`microFile`: Magic Bytes längre ledare, en fil upp till minnets slut, en summa
som inte stämmer där sträckan slutar och där den inte gör det, Rainbow Arts block och Wildloads kedja som inte ger
några, en Freeload-fil i en Microload-fils bitar som inte blir en egen), och fixturerna `fixtures/tap/mimir-demo.tap`,
`fixtures/tap/cyberload-demo.tap` (de fyra stegen, rasterdemot fjärde stegets fil `DEMO`),
`fixtures/tap/wildload-demo.tap` och `fixtures/tap/microload-demo.tap`.

### 13.5f Datasetten i Sindri och i VICE

En fil som öppnas från bandet körs av Sindri med bandet i en emulerad datasette (`packages/sindri/src/tape.ts`),
som en fil från en disk körs med disken i en 1541. Pulserna når CIA1:s FLAG-linje (ICR bit 4, och IRQ med masken)
medan motorn går (6510-porten driver bit 5 lågt), och PLAY är nedtryckt (port bit 4 läses som 0). Bandet står där
filen slutade, så programmets egen bandladdare läser vidare därifrån. Sindri gör LOAD:s arbete från bandet i stället för
KERNAL:ns rutiner, som skulle ta minuter av C64-tid: huvudet läggs i bandbufferten, datan där den ska (en relokerbar
fil med sekundäradress 0 i början av BASIC), och bandet spolas fram till efter filen. Som KERNAL:n sparar Sindri
IRQ-vektorn i `$029f/$02a0` före laddningen och lägger tillbaka den efter: en bootfil som laddas över `$029f/$02a0`
startar genom nästa avbrott, som kommer direkt (KERNAL:n avslutar laddningen i sitt band-IRQ och slår på CIA1:s timer A,
vars underflöde redan väntar), före BASIC hinner använda vektorer som filen laddat över. Motorspärren `$c0` sätts som
KERNAL:n gör när den startar motorn, annars slår KERNAL:ns IRQ på motorn så fort PLAY är nedtryckt. Pekarna som en LOAD
från bandet lämnar sätts också: starten i `$c1/$c2`, slutet i `$ae/$af` och `$ac/$ad` (Mastertronics och Codemasters
bootfiler rensar minnet från (`$ac`) upp till `$0800`, och stannade direkt utan dem). KERNAL:n anropar STOP (`JSR $FFE1`
vid `$f8be`, genom vektorn `$0328`) hela tiden medan dess avbrott lagrar filens byte, så en fil som laddas över den
vektorn med en adress i RAM anropas där innan resten av den har kommit in. En sådan laddning lagrar en byte i taget och
anropar vektorn efter varje; när den kommer tillbaka (till `$f8c1`) fortsätter laddningen, och en som inte gör det har
startat programmet (KERNAL:n avslutar aldrig den LOAD:en). Novaloads äldre bootfiler startar så (Turbo Esprit, Airborne
Ranger, Boulder Dash: `$02ed`, som hoppar in i filen när en byte längre fram har laddats), och gick till READY eller en
reset utan det, med laddaren letande efter en fil utan att något namn satts upp. KERNAL:n lagrar också bara ett
datablocks byte fram till slutet som huvudet anger och läser resten: en bootfil vars block är en hel bandbuffert på 192
byte för de 12 eller 52 huvudet anger (vektorerna vid `$0300`, som Incentives Zodiac och Epyx Summer Games har) laddar
bara dem, inte mellanslagen efter, som skulle föra IRQ- och STOP-vektorerna till `$2020`; Mimirs läsare (13.5e) och
Sindris ger filen de byten. Mätt 2026-11-16 på de 103 band i arkivet vars bootfil laddas över STOP-vektorn med en adress
i RAM (93 av dem Novaloads): förut sparade 5 ett senare lager än bootfilen (65 slutade i en reset, 12 vid READY, 8 i en
JAM), nu alla 103: 100 vilar i ett program, ett stannar i en JAM efter 272 s band (Barry McGuigans Boxing) och två når
tidsgränsen. Sedan Sindri väntar på tiden (*Program som väntar på tiden*, 8.11b) kommer Boulder Dash förbi sin bild
till spelet på `$599e` (titelbilden i VICE) och Kennedy Approach förbi sin FOR-slinga: den laddar spelet från bandet
(utan diskettstation på bussen, som dess BASIC kollar) och vilar i spelets alternativmeny, som VICE visar den utan
diskettstation. Av de 103 banden ändrades de två och Pirates (menyn, 30 s senare), av de 76 nedan inget, och C64-tiden
växte med 2,3 %. Av 76 andra band går 74 som förut; de två andra hör till de
18 bootfiler vars huvud säger färre byte än blocket har, som nu laddar bara dem (Cricket Crazy, Zodiac, Quake Minus 1
når sina spel; Epyx eget Summer Games-band, som hänger sig i VICE också, stannar i en JAM). Ett program som
väntar medan bandet spelar laddar, inte vilar; efter bandets slut väntar Sindri 5 s till. Ett program som stängt av
motorn med mer kvar på bandet vilar inte heller förrän 5 s efter: Cyberload tonar ut ljudet i 2,5 s mellan laddningen och
Tusker, och Sindri sparade laddaren vid `$fd03` (som läser delarna från bandet igen) i stället för spelet vid `$6440`.
Tiden räcker till resten av bandet och 30 s till. Sindris RAM slås på som VICE:s (x64sc 3.10, `POWER_ON`): fyra byte
`$00` och fyra `$ff` från `$0002`, inverterat var annan 16 KB, som startrutinen lämnar utom `$0002-$0101` och
`$0200-$03ff`. Cyberloads andra steg jämför RAM:et under KERNAL:n vid `$f37a-$f478` med sig självt och raderar nollsidan,
sig självt med, när det är en och samma byte överallt; med RAM som började som bara `$00` kom Tusker inte längre än
laddarens första steg. Där inget skrev före lagrets start (eller laddade under det) har det sparade programmet `$00`,
inte ränderna, som förut. En körning stannar vid 500 lager (`budget`): program har några dussin, men en laddare som
startar om sig själv gång på gång gör två lager varje gång, vart och ett långsammare än det förra (Ping Pong, vars kod
READY. skrev över på skärmen: Sindris LOAD från bandet skriver inte KERNAL:ns meddelanden, så READY. hamnar på rad 8 och
inte rad 14 som i VICE).

Mätt mot Sindri före ändringarna (november 2026) på 1 771 filer ur arkivet: de 161 enfilsdemona i Onefile-top200 är
oförändrade; av 350 demodiskar ur Year-top20 är 307 oförändrade, 42 har samma omfång med andra byte (räknade ur RAM som
inget skrev, nu som i VICE) och en (Memento Mori, Spindle-sida 3 ensam) stannar i en JAM vid `$0300` som VICE; av 1 260
band är 1 087 oförändrade, 75 kommer till ett senare lager (bland dem Cyberloads spel, som stannade i laddarens första
steg: Tusker, 3D Pool, Antiriad, Back to the Future II, Bad Dudes, Arkanoid II), 5 packas upp som inte gjorde det
(Germany 1985, Hercules, Chase H.Q. sida B med flera), 73 har samma omfång med andra byte, 13 ett annat omfång eller
start, 2 sparar ett tidigare lager (Apollo 18: spelets start `$0900`, inte rutinen vid `$759d` som det anropar) och 2
(Ping Pong) stannar vid 500 lager med laddaren sparad, som förut. Lagerrapporten säger var bandet stod och hur långt det spelade (`Tape: datasette: …`), och
läsningar från bandet räknas som laddning när ett lager sparar det det laddade. Den sparade porten är programmets: bit 4,
som PLAY håller låg, räknas inte. Mätt på bootfilerna från de 98 första sidorna bland de första 100 banden i arkivet: 93 spelar bandet i mer än 5 s
(80 innan pekarna sattes; de 13 är budgetband som Mastertronics, Codemasters och Zeppelins, som nu läser 18–416 s),
81 slutar i ett program som kör, 9 vid READY, 5 i en reset och 2 i en JAM efter laddningen, och ett är ett BASIC-spel
som läser sina data med KERNAL:ns egna rutiner; 80 sparar ett senare lager än bootfilen (67 innan). Ett band tar median
2,1 s (max 10,0 s) för i snitt 163 s C64-tid. Utan IRQ-vektorn vid `$029f/$02a0` och motorspärren kom bara 14 av de första 25
längre än bootfilen (11-A-Side Soccer, APB och 3D Pool startar genom vektorn).

**En turbofil som inte startar där den laddas.** En fil i en turboladdares format (13.5e: ett block i en Wildload-kedja,
en Cyberload-del, en TinyHeader-fil …) är en del av det laddaren laddar, och laddaren startar det den laddat, inte där
filen laddas. Deltas (Thalamus) `file_1000` är det packade spelet som kedjan laddar till `$1000-$beff`: Sindri körde den
med `SYS 4096`, stannade efter tre instruktioner i en JAM vid `$1005`, och Unpack sa *Sindri found nothing to unpack in
file_1000*. Bootfilen vars laddare laddar en turbofil är den sista KERNAL-filen före den på bandet (`tapeBoot()` i
`tap.ts`; ingen för en KERNAL-fil, en T64:s eller en fil utan någon före sig). Packar filen körd för sig inte upp något och
är den inte heller *not packed* (en krasch till READY, en JAM, en gräns), kör Sindri bandet som en C64 laddar det:
bootfilen med bandet efter den, som när bootfilen själv öppnas (`unpackPrg` med `UnpackTape.boot` i
`packages/core/src/sindri.ts`; körningen sparas för nästa fil från samma band). Sindri skriver nu var bandet stod när
varje lager började (`LayerReport.tape`, pulsen), så det första lager som började när bandet passerat filens slut är det
första efter att laddaren laddat den (`BootRun.after`), och ett lager under vilket bandet passerar slutet på en annan fil
eller sträcka på bandet är laddaren som läser vidare, inte en uppackare (`BootRun.loading`: Firetracks andra steg vid
`$1000`, som laddar resten av kedjan, packar inte upp blocken före sig). Kör bootfilen så långt är körningen filens: den
är uppackad när ett lager därifrån fram till programmet Sindri sparar, utom laddarens, packade upp något, och Unpack tar
programmet i filens ställe (Delta: `$02a1-$ffff` med start `$1770`, genom kedjans slut vid `$02eb` och Super
Compressors lager, byte för byte VICE:s RAM när spelet startar vid `$1770`). Startade laddaren ett program som kör som det
är, och slutar körningen där program hamnar utan BRK, är svaret *not packed* med skälet (*… is not packed: A loader on
the tape loads it: Sindri ran the tape's boot file "…" (alone, from $…, it stopped: jam). The program its loader started
after loading it never jumped into code it wrote …*), och att Unpack på bootfilen ger programmet som laddaren startar
det. Kommer bootfilens laddare aldrig förbi filen (en bana spelet laddar senare, en Turbo Tape-fil man laddar själv) står
filens egen körning kvar, och rapporten säger att bootfilen också kördes. En fil som kör där den laddas körs som förut,
och en programstart som användaren satt gäller. Lagerrapporten börjar med vad filen gjorde för sig (*Alone, started at
$1000, it stopped: jam, …*) och vilket lager som började efter laddningen; packningsnotisen säger *A loader on the tape
loads it: Sindri ran the tape's boot file "DELTA", and after its loader had loaded it peels off 7 layers: …*.
`mimir unpack spel.tap --file file_1000` gör detsamma. Mätt 2026-11-19 på 4 132 turbofiler med en bootfil före sig på
441 band (alla 93 med Wildload eller Microload, var fjärde av de andra 1 394 band i arkivet som har sådana): 653 kör där
de laddas som förut; de 3 479 som inte gör det (2 638 till READY efter en BRK, 722 i en JAM, 90 startade inte) gav alla
*Sindri found nothing to unpack*, nu ger 919 programmet laddaren laddar dem i, 1 089 *not packed* med skälet, 1 459 når
bootfilen aldrig (som förut, med anmärkningen) och 12 packar inte upp något efter laddningen. Wildload: 980 filer på 59
band, 343 uppackade och 468 *not packed* genom bootfilen, 47 som den inte når, 119 som kör där de laddas. Utan regeln om
laddarens lager hade 87 av banden filer med båda svaren, nu 27 (som Bomb Jack II, vars laddare vid `$0100` läser bandet
och skriver `$4000-$ffff` i ett och samma lager). En körning av en fil som faller tillbaka tar median 35 ms, eftersom bootfilens körning sparas; den
första på ett band tar bootfilens tid (Delta 6 s).

**En fil som en laddare på disken laddar.** Disk-Speeds filer (13.5p) står i laddarens tabell, inte i katalogen, och kör
inte heller för sig: Elites 2NDBIT och 3RDBIT avkodar spelet självt när alla fem filerna ligger inne, så 2NDBIT körd från
`$6A00` stannar i en JAM vid `$6AA6`. En fil som öppnas ur Disk-Speed-fliken har därför med sig disken och dess bootfil
(`GAME`) och var filen ligger i minnet (`UnpackDiskBoot`, `unpackPrg`:s sista argument). Packar filen körd för sig inte
upp något och är den inte *not packed*, kör Sindri disken från bootfilen som LOAD och RUN gör (körningen sparas för nästa
fil från samma disk). Det första lagret som började när lagren före det skrivit eller kört mer än hälften av filens byte
är det första efter laddningen (`BootRun.after`, `from: 'disk'`): ett lagers rapport har bara det det skrev som inget
senare lager skrev över och som det inte körde (Elites PATCH körs inne i laddaren, och avkodaren sparar nollsidan över
OVERs första byte), och bootfilens egen kod (lager 0) räknas inte, för PATCH laddas där bootet avkodade sig självt. Sedan
som för bandet: uppackad när ett lager därifrån packade upp något, och Unpack tar programmet i filens ställe. För Elite
ger alla fem filerna spelet, `$0308-$FFFF` med start `$886F` och `$01 = $3C`, genom avkodaren på `$0200`; Fighter Pilots
tre filer ger *not packed* (programmet på `$0C00` kör som det är); den tyska Elite (OTD) ger spelet med start `$8ED3`.
Texterna säger *disk* där de för ett band säger *tape* (*A loader on the disk loads it: Sindri ran the disk's boot file
"GAME" …*). Testet: `packages/core/test/sindri.test.ts` (en egen disk vars boot kopierar en avkodare till `$C000`,
laddar DATA med KERNAL:n och hoppar dit; DATA för sig stannar i en JAM).

`mimir unpack spel.tap [--file NAMN]` packar upp bandets första program (eller det namngivna) med bandet i datasetten,
`--tape band.tap` lägger ett band i datasetten för en PRG; Sindris egen CLI tar samma (`sindri spel.tap`, `--tape`).

**Build & Run** med ett band i datasetten:
- När projektets första fil kommer från en KERNAL-fil på bandet skrivs bandet om: den byggda filen (och dess huvud, när
  huvudfilen finns i projektet, med start och slut från den byggda datan) som bandets första fil i KERNAL:ns format,
  därefter bandet som det var efter filen (`replaceTapeFile()`), och VICE autostartar det (`-autostart <namn>.tap`):
  KERNAL:n laddar den återassemblerade bootfilen och dess laddare läser vidare från bandet. Det som låg före filen tas
  inte med.
- Annars läggs en kopia av bandet i VICE:s datasette (`-1 <kopia>.tap`, i en ny byggmapp) bredvid programmet; PLAY
  trycks i VICE när programmet ber om det.
`test/vice.integration.test.ts` autostartar i riktiga VICE ett band vars bootladdare läser nästa fil med turbo och
avslutar VICE med en kod, också efter att bootfilen skrivits om.

### 13.5g TapeTool-band (kommandoraden som skriver bandet igen)

Martin Pipers TapeTool skriver TAP-filer med egna turboladdare (källorna följer med: `TapeLoaderCIA*.a`,
`TapeLoaderCIAIRQ.a`, `ScrollerMusicLoader.a`). Formatet, läst ur källorna och mätt på TapeTools utdata:
- Två pulslängder, en 1 dubbelt så lång som en 0 (`TapeTurboSpeed` × 2 och × 4, som standard 256 och 512 cykler);
  laddarna startar CIA1:s timer A som one-shot från 3 × `TapeTurboSpeed` − `$11` vid varje flank, och en timer som
  hunnit gå ut är en 1. Högsta biten först, ledaren `$ff $c3`, synkbyten `$aa`.
- **Hela huvudet:** `$f0`, `$96` (`$b7` när blocket är RLE-packat), filens namnbyte, start, antal block i filen, slut, en
  XOR av huvudet från synken; datan och dess XOR. Ett RLE-block har den packade längden som slutets låga byte och
  längden − 1 som höga; först står flyktbyten, sedan byten, flyktbyte + antal (0 = 256) + värde för en körning, och
  flyktbyten sist.
- **TinyHeader** (`otft`): `$69` direkt efter synken, sedan datan och dess XOR, utan namn och adress: bootladdaren i
  bandhuvudet vet var den ska och hur lång den är. Adressen läses därför ur bootladdarens kod: `sta <start>` som räknas
  upp, sedan `lda` av operandens byte jämförda med slutets (`cmp #<slut`, `cmp #>slut`), som i alla tre
  TinyHeader-laddarna. Datan går till nästa ledare; byten före den är kontrollsumman. En TinyHeader godtas bara efter
  TapeTools egen ledare, den har inget annat att kontrollera.
- **Checksummeblock** (`otfb`, `otfbr`): ett block per sida (laddaren märker block efter startadressens höga byte), i
  minnesordning eller slumpad (`n <frö>`), och filer kan flätas samman (`s`). Block med samma namnbyte samlas till en fil
  tills dess antal är nått; ett block vars sida redan finns börjar en ny fil. Saknade block och glapp står vid filen.
- **Bootfilen** (`ocb1`): ett KERNAL-huvud med laddaren i bandbufferten, datan bara en gång; datan ligger över `$0302`
  (eller laddaren startar annars när LOAD är klar).

**Kommandoraden** (`tapeToolScript()`): Tape-fliken visar och kopierar (**Copy script**) TapeTools kommandorader som
skriver bandet igen, en per fil som i TapeTools `ExampleBuild.bat`. Bootfilen sparas som `boot.bin` (namnet, resten av
huvudet och datan efter varandra) och ges till `ocb1` med sina offsetar; en TinyHeader-fil med `otft`, de andra med
`otfb` (`otfbr` när block var RLE-packade), `s` före en fil som är sammanflätad med den före, `n 1` där blocken inte låg
i minnesordning (TapeTool blandar med fröet det får, så ordningen kan skilja), och varje fils ledare (`otl`) räknad
utan de ledarpar TapeTool själv skriver: 4 före en TinyHeader eller hel fil, 2 före varje block och 2 efter (8 efter
ett RLE-packat, tid för laddaren att packa upp). Filer TapeTool inte skriver nämns i en kommentar. **Save files…**
sparar filerna och raderna som `build.bat`. En annan hastighet än TapeTools standard ges med `ft <0> <1> 1 $aa` på
varje rad. Med TapeTool 1.0.0.10 bygger raderna om TapeTools exempelband (`test.tap` från `ExampleBuild.bat`) **byte för
byte identiskt**, och likaså fyra SEUCK Redux-spel ur arkivet som är utgivna på TapeTool-band (The Last Hope Redux,
Double or Nothing Redux, Vampire Hunter 2 Redux och Dark Force Redux; de tre sista med `TapeTurboSpeed` `$a0`).

Analysen känner TapeTools laddare (8.11c): bitläsningen (`pha / lda #$10 / bit $dc0d / beq / lda $dc04 / cmp $dc04 /
beq / clc / lda #$19 / sta $dc0e`), IRQ-laddarens (`lda $dc0d / ldx #$19 / stx $dc0e / lsr / rol`) och väntan på
synken och TinyHeader. Fixturen `fixtures/tap/mimir-demo.tap` (`test/helpers/tapetool-tape.ts`) har en egen liten
bootladdare i TinyHeader-stil, raster-demot som TinyHeader-fil, en sinustabell i två block i omvänd ordning och en fil
med RLE-packade block; inget av TapeTools egen kod finns i repot.

### 13.5h Pirate Slayer (Electronic Arts kopieringsskydd)

`readPirateSlayerDisk` (`packages/core/src/c64/pirateslayer.ts`) läser skyddet på en monterad disk; analysen av bootet
finns i `docs/pirateslayer.md`.

- **Nyckeln** (bara en G64 har den): spår 2 (V2), 36 och 37 (V1) och 35 (PirateBusters) söks bit för bit efter
  mönstren, inramade var som helst. För V2 räknas varje kopia ett varv: D7:orna, CC AD-paren efter EB och om de 12
  byten `55 AE 9B 55 AD 55 CB AE 6B AB AD AF` följer. Bitfasen (där avbildens byte måste ramas in för att nyckeln ska
  läsas) och antalet SYNC-märken (inga) sägs.
- **Bootet**: EA:s eget (`EA` och `LOADER` med texten `+2 PIRATESLAYER BOOT PROGRAMMED BY KRIS HATLELID`), stack-bootet
  (`EA` på `$0102`, känt på sina första byte, kontrollen körd som DOS-jobb) eller ett eget (Ferrari Formula Ones
  `FF1-BOOT` på `$00AE`: var resten hamnar räknas ut som KERNAL:ns laddslinga gör). Filer som har drivens kontroll
  okrypterad räknas upp.
- På en D64 sägs att nyckelspåret saknas och att bootet därför fallerar kontrollen.
- **Filerna utanför katalogen**: sektorkedjor som ingen katalogpost startar (`looseChains` i `d64.ts`: en kedja börjar
  på en sektor som ingen annan länkar till, och varje sektor på den läses utan fel, ligger utanför spår 18 och utanför
  katalogens filer och länkar vidare eller slutar). EA:s laddare läser dem med laddadressen först och sista sektorns
  andra byte som antal byte. Med EA:s eget boot är alla lagrade XOR `$EA`; kedjan på 3/0 är den första, som driven
  skickar så fort nyckeln är hittad. Stack-bootets kedja på 3/0 är lagrad XOR `$A5`. Andra kedjor läses som de är.
  En kedja med färre än tre byte räknas inte. Namnet är påhittat av första sektorn och laddadressen (`t3s0_8f1f.prg`).

Vid montering säger toasten och Explorer (*Disk*) vad som hittats, och fliken **Pirate Slayer** i bottenpanelen visar
nyckeln (spår, mönster, SYNC, bitfas, kopiorna), bootet och vad det gör, var kontrollen finns, bootets text och
filerna utanför katalogen: en rad per fil med första sektorn, block, var den laddar, storlek, namn och vad som läser
den. En rad öppnar filen som en PRG på laddadressen, avkodad, och + lägger till den i projektet; byte efter `$FFFF`
lämnas utanför. **Save files…** sparar alla filerna avkodade som PRG:er i en mapp man väljer, med `files.txt` som listar
dem (`pirateSlayerFileList`: en rad per fil med första sektorn, block, var den laddar, nyckeln och vad som läser den),
och **Copy list** kopierar samma lista. Analysen känner igen laddaren i spelets första fil (8.11c), och källans huvud beskriver hur den anropas
(kommandot i A, spåret i Y, sektorn i X).

Bootet körs i Sindri med G64:an i driven, nyckelspår och allt (13.5, 8.11b): Arctic Fox, Chuck Yeager's Advanced
Flight Trainer, Demon Stalkers och Ferrari Formula One packas upp till spelet; Dan Dares avbild är skadad (också i
VICE). Det krävde att Sindri läser G64:s spår bit för bit (ett spår utan SYNC glider en bit per varv, som en riktig
skivas inramning), läser CIA-timrar i instruktionens sista cykel (en timer som går visar aldrig 0), lägger badline-DMA
i cykel 11–54, låter CLK och DATA som C64:an släpper nå driven en cykel senare (ATN direkt), knyter stegmotorns fas till huvudets läge
(`UJ` flyttar huvudet från nyckelspåret), lagrar LOAD genom pekaren på `$ae/$af` och räknar busstrafik med driven som
arbete; se `docs/pirateslayer.md`. Laddaren känns igen i analysen (8.11c). `test/pirateslayer.test.ts` och
`test/g64.test.ts` gör egna skivor (bara nyckelns bytemönster, inget av EA:s kod); Sindris `test/g64.test.ts` provar
läsningen bit för bit, timrarna, stegmotorn och LOAD-pekaren.

### 13.5i Sparkle-diskar (Sparkles laddskript)

Sparkle är Spartas (OMG) loader och diskbyggare för trackmos, från 2019. Diskbyggaren läser ett skript (`.sls`) där
varje stycke är en *bundle*: filerna och bitarna av filer som ett anrop av loadern laddar. De är inga filer på disken.
Sparkle packar bundlarna efter varandra i block om 256 byte, utan glapp (en bundle börjar i blocket där den förra
slutar), och driven skickar en bundles block i den ordning de passerar huvudet. Varje block säger själv var dess byte
ska, så C64:an packar upp varje block när det kommer. `readSparkleDisk()` (`packages/core/src/c64/sparkle-disk.ts`)
läser en Sparkle-sidas bundlar (`SparkleDisk`, `SparkleBundle`, `SparkleChunk`), och `sparkleScript()` skriver
laddskriptet igen. Formatet är läst ur *Memento Mori* (Genesis Project, 2020), *All Hallows Eve* (2022) och *5 Shades
of Grey* (Lethargy, 2020), och kontrollerat mot loadern när den kör i Sindri och mot diskarnas egna uppackare.
Skriptets syntax är den i Sparkles manual (3.4); Sparkles källkod (Sparkle2, SparkleCPP) bekräftar blockens layout,
taggarna, interleaven och katalogen.

**Disken:**
- **Startprogrammet** (katalogens första post, på spår 18) kopierar den residenta delen till `$0160–$02ff` (den äldsta
  till `$0180–$02ff`, i tre halvor) och skickar ett `M-E` som låter DOS:en läsa drivkoden från spår 18 (18/11–18/15,
  eller 18/2, 6, 10, 14 och 18 i den äldsta). Det laddar första bundlen med `lda #>start-1 / pha / lda #<start-1 / pha
  / jmp load`: skriptets *Start*. Den residenta delen ger också loaderns nollsida (`sta (zp),y`, skriptets *ZP*) och
  dess anrop: nästa bundle (`jsr $01f9` i Memento Mori, `$01f6`, `$01fc` och `$0200` i andra versioner, `$0180` i den
  äldsta), och `lda #nummer / jsr $0160` före väljer en annan ur drivens katalog (Memento Moris tredje sida startar sin
  huvudkod från sista bundlen, `$33`; The Machine laddar 83 bundlar så).
- **Drivens nollsida** är 18/14. Drivkoden hämtar varje hastighetszons interleave där (`ldx zp,y` med Y = sektorerna på
  spåret, i de flesta versioner från `$4f` + Y) och skriver in den i sin sektorvandring: skriptets *IL0–IL3*. Läsaren
  hittar inställningen på spår 18 (`ldx zp,y / stx / ldx #1 / stx / cpy #21 / beq / dex / stx`), annars tas `$4f`.
- **Blocken** är spår 1 till 35 (40), förbi 18, och varje spårs sektorer i den ordning driven vandrar: vidare från där
  vandringen på förra spåret slutade, en interleave i taget, nästa sektor när den är tagen. Förbi spårets sista sektor
  går den tillbaka med spårets antal sektorer (och en till på ett spår med 21), och över spår 18 hoppar den två steg.
  Första blocket är 1/0.
- **Ett block** är byten som C64:an tar emot dem. Byte 0 är första byten med bitar, resten läses uppifrån och ned: vart
  byten ska (låg, hög; en hög byte 0 betyder under I/O-området och följs av den riktiga), sedan poster. En bit 0 är en
  literal på 1 byte, en bit 1 en längre, längd − 1 i en nibble (två per byte, den låga först; 0: en hel byte följer).
  Efter en literal kommer en kopia; efter en kopia betyder bit 1 en kopia till och 0 en literal. En kopiebyte vars två
  låga bitar inte är 0 kopierar `(b & 3) + 1` byte från `(b >> 2) + 1` ovanför. Bitarna tas uppifrån i en byte, vars
  lägsta 1 markerar var de slutar; en ny byte läses när de tar slut. Kopior kommer från högre adresser, så en bundle
  packas upp ovanifrån och ned. De andra posterna finns i tre slag (`SparkleItems`):
  - **`f8`** (Memento Mori): `(b >> 2) + 1` byte från nästa byte + 1 ovanför; 0 avslutar blocket, `$f8 n` (n inte 0)
    kopierar n + 1 byte, `$f8 0` avslutar bundlen (nästa börjar under: dess bitar, sedan vart den ska) och `$fc` ger en
    ny adress.
  - **`old`** (5 Shades of Grey, Gamertro, Fatzones demos till 2023): samma poster, men blockets byte 0 har 8 bitar (den
    1 som avslutar dem läggs in när den första läses, `sec / rol`), och en bundle som börjar under slutet av en annan
    fortsätter med dess bitar och nibble (`lda #bitar / ldx #plats` på `$0180` sparar dem).
  - **`84`** (All Hallows Eve 2022 och senare, också Sparkle 3): längden i bit 2–6, avståndets höga byte först när bit 7
    inte är satt: `1LLLLL00 o` kopierar L byte från o + 1 ovanför, `0LLLLL00 h o` från (h o) + 1. Med L = 1 följer en
    byte med längden (`$84 n o`, `$04 h n o`; `$84 0` avslutar bundlen), med L = 0 (`$80`) en ny adress; 0 avslutar
    blocket.
- **Byte 1** i första blocket och i ett block där en bundle slutar är drivens: hur många block till nästa bundle som går
  förbi blocket tar. Driven skickar 0 i dess ställe. Antalet är kodat (`SparkleCountCode`): `raw` som det är (de äldsta),
  `bits` varje bit flyttad (bit i till 3, 1, 2, 0, 7, 5, 6, 4) och alla inverterade (Memento Mori), `eor` EOR `$7f` när
  bit 0 och 3 är lika och annars `$76` (All Hallows Eve). Antalet 0 avslutar sidan; de äldsta sidorna slutar i stället
  med 1, och blocket efter är tomt eller en fil i katalogen. Bundlar som slutar i samma block läses ändå. Samma kod i
  BAM:ens byte `$ff` och `$fe` ger sidans nummer och nästa sidas (inte i de äldsta). **Att varje bundle slutar där
  antalen säger är kontrollen** att vandringen, posterna och kodningen stämmer: läsaren prövar slagen och tar det som
  packas upp till sidans slut.
- **Drivens katalog** i 18/17–18/18 har 4 byte per bundle efter dess nummer (högst 128). I Memento Mori: spåret där den
  börjar, var vandringen börjar på spåret, sektorerna kvar på spåret från dess block (alla tre kodade som antalet) och
  var i blocket den börjar; `indexed` säger att den stämmer med varje bundle. Senare skript ger bara vissa bundlar ett
  nummer (`DirIndex`), och deras katalog läses inte här.

**En bundle** blir bitar (`SparkleChunk`): en per följd av adresser, med *io* när någon av dess byte i `$d000–$dfff`
packades upp under I/O-området (Sparkle sätter `$01` ett block i taget, så en fils block utanför I/O-området säger det
inte). `blocks` är hur många nya block driven läser för den; 0 är en bundle som låg helt i blocket där den förra slutade.
`complete` är falskt om sidans sista bundle inte gick att packa upp (dess block räknar med block som inte är Sparkles);
de bundlar som kontrollerats före den är då sidan.

**Skriptet** (`sparkleScript`): kommentarsrader med vad disken är och vilken sida, sedan `Path`, `Header`, `ID` (de
fem tecknen på `$a2–$a6` i BAM:en), `Name`, `Start`, `IL0–IL3` och `ZP`, och ett stycke per bundle efter en tom rad,
med en `File:`-rad per bit (`File:` och en tabb, sedan `"bundle01_d000.prg*"`; `*` under I/O-området). Filerna är
PRG:er med bitens adress, och namnen är påhittade av bundlen och adressen. Anteckningar står på egna rader, eftersom
Sparkle läser text efter en `File:`-post som dess parametrar men hoppar över rader den inte känner igen.

**I appen:**
- Explorer säger om en monterad disk *Sparkle disk: N bundles of files the loader reads, not in the directory*, med
  knappen **Sparkle script**; monteringen säger *a Sparkle disk with N bundles of files (side n)*.
- Bottenpanelens flik **Sparkle script** finns när en sådan disk är monterad. Rubriken säger sidan, antalet bundlar och
  filer, hur en del laddar (nästa bundle med dess anrop; `lda #nummer / jsr $0160` väljer en ur drivens katalog) och
  interleaven.
- En rad per bit: bundlens nummer (hex, som programmet anropar med), var den laddar, storlek, filnamnet och anmärkningar
  (var bundlen börjar och hur många block, att startprogrammet går till Start efter den första, *under the I/O area*).
  Ett klick öppnar biten som en PRG på sin adress, och **+** lägger till den.
- **Copy script** kopierar laddskriptet. **Save files…** sparar alla bitar som PRG:er i en mapp man väljer, med
  skriptet som `<disk>.sls` bredvid.
- Analysen känner igen Sparkle i startprogrammet (mottagarloopen, också med `ldy #$00`) och i en del som sparats från
  `$0200` (blockuppackaren, båda slagen av poster, 8.11c).

**Mätt:**
- Memento Moris tre sidor: 16, 17 och 52 bundlar i 635, 577 och 458 block, IL 5/4/3/3 (sida 3: 8/4/3/3), sidorna 1 → 2
  → 3, katalogen stämmer för alla bundlar. Varje block som Sindri tog emot på sida 1 (420 block) är byte för byte en
  sektor i den ordning läsaren räknar fram.
- **Mot loadern i Sindri** (varje skrivning av uppackaren, med loaderns egna anrop för nästa bundle, slutet och
  nummer): Memento Mori sida 1 och 3, The Santas' Christmas Megademo sida A och B, XXX sida 1, We Love to Party, All
  Hallows Eve disk 1, The Machine och Gamertro sida 1: nästan 1,7 miljoner skrivningar, inga fel. The Machine laddade
  84 av sina 85 bundlar hela, 83 av dem efter nummer.
- **Mot diskens egen uppackare** (den residenta delen ur startprogrammet körd på Sindris 6502, matad med blocken i
  läsarens ordning): på de 240 lästa diskarna med startprogram (E2IRA:s saknar ett) är varje bundle densamma som läsaren ger, utom The
  Machines bundlar från 54, som skriver i nollsidan där emulatorn har andra värden än C64:an (Sindri ovan stämmer).
- I CSDB:s Year-top20 (och mappen med nyare demos) har 264 diskar Sparkles `M-E`, 142 olika. 133 olika läses, alla till sidans slut: 62 `f8` med
  `bits` (2020–2022), 13 `f8` med `eor` (2022), 9 `old` (2020–2023) och 49 `84` med `eor` (2022–2025, också Sparkle 3:s
  Nightworks, Crimbo 1982 och Fünfzig 90%), sammanlagt 1 794 bundlar och 4 459 filer (16,9 MB), 4 ms per disk. Inte
  lästa: Lethargys Median (fyra sidor) och Padawans Awakening, vars ändrade drivkod räknar annorlunda, och Sparkle 3:s
  senaste (Wavemode, Aloft), som har drivkoden på ett annat sätt. Ingen av dem tas för en Spindle-, Bitfire-,
  BoozeLoader- eller Pirate Slayer-disk.

**Test:** `test/sparkle-disk.test.ts`, med diskar som `test/helpers/sparkle-disk.ts` skriver som Sparkle lägger ut dem
(en egen enkel packare för alla tre slagen av poster, de tre kodningarna, drivens vandring, Memento Moris katalog och
sidnummer; av drivkoden och startprogrammet bara de få byte som de känns igen på). Testerna täcker literaler med nibble
och hel byte, alla kopior (också från längre bort än 256 byte), nya adresser, I/O-området, en bundle i blocket före, en
sista bundle som delar block, de äldsta sidornas slut, Memento Moris sektorordning och antal, All Hallows Eves antal,
diskar utan katalog eller startprogram och andra loaders diskar. `fixtures/d64/sparkle-demo.d64` är en av diskarna:
rasterdemot som första bundle, en bundle med en fil under I/O-området och en liten i blocket där den slutar.

### 13.5j T64-arkiv (.t64)

En T64 är emulatorn C64S:s bandarkiv: ett bands filer, inte dess pulser. Den läggs i datasetten som en TAP (13.5e):
**Insert tape image (TAP, T64)…** (File-menyn, kommandopaletten, *Insert TAP/T64…* på den tomma startsidan, Smart
attach, eller dra och släpp en `.t64`), och `readTape()` läser den med `readT64()` (`packages/core/src/c64/t64.ts`)
när huvudet är en T64:s. En fil som heter `.t64` men är en TAP (`C64-TAPE-RAW`) läses som en TAP.

- **Huvudet.** 64 byte: en signaturrad utfylld med nollor till 32 byte (`C64 tape image file`, `C64S tape file`, `C64S
  tape image file`; den sista ibland med en egen rad efter, `*Conv 64*`), versionen (`$0100` eller `$0101`), hur
  många poster katalogen har plats för och hur många den säger används, och bandets namn (24 byte PETSCII).
- **Katalogen.** 32 byte per post: C64S-typen (0 ledig, 1 en bandfil, en annan utan 1541-typ en minnessnapshot från
  C64S), 1541-filtypen (oftast `$82`; vilken som helst tas som ett program), start- och slutadress (slutet ett förbi,
  som i ett bandhuvud), var filens byte börjar i T64:an och namnet (16 byte PETSCII, utfyllt med mellanslag). Datan
  följer katalogen, varje fils byte utan laddadress.
- **Som VICE läser dem.** Varje post av typ 1 är en fil, vad huvudet än säger används (89 av arkivets T64:or säger 0),
  i katalogens ordning. Katalogen slutar där den första filens byte börjar. En fil är så lång som slutadressen säger bara
  när dess byte finns där och slutet inte är `$c3c6` (som en gammal konverterare skrev för varje fil); annars är den
  det som ligger fram till nästa fils byte (eller T64:ans slut), och en anmärkning säger det. En post vars byte skulle
  börja efter T64:ans slut är ett fel. En snapshot listas (`FRZ`) men öppnas inte.

Explorer listar filerna med postnumret där en TAP har tiden, namnet och typen (`PRG`), och under listan *N files · T64
"namn"*. Tape-fliken har *Entry* i stället för tid, formatet `T64 PRG`, offset i T64:an och anmärkningarna (fel slut,
en annan 1541-typ än `$82`); rubriken säger T64:ans namn, version och signatur. En fil öppnas, **+** lägger till den,
och **Save files…** sparar varje fil som PRG.

**Sindri.** En fil från en T64 körs med T64:an i datasetten. Den skickar inga pulser (FLAG-linjen får inga flanker, och
den räknas inte som laddning: ett program som väntar på pulser vilar och stannar), bandet står före en post, och
LOAD från bandet läser dess filer som från en TAP: nästa fil vars namn börjar med det som efterfrågas, huvudet (typ 3,
start, slut, namnet) i bandbufferten, datan där filen sparades. Hittas inget från där bandet står söks från början igen,
som VICE gör (prövat i VICE 3.10: `LOAD"PART2",1,1` hittar en fil före bootfilen). Lagerrapporten säger *datasette: a
T64 of N files, the tape stood after the file (before file 2), now before file 3*. `t64Files()` i
`packages/sindri/src/tape.ts` läser katalogen med samma regler som `readT64()`. `mimir unpack spel.t64 [--file NAMN]`
och `sindri spel.t64` packar upp T64:ans första program (eller det namngivna) med T64:an i datasetten, och `--tape` tar
en T64.

**Build & Run** med en T64 i datasetten (`writeT64()`):
- När projektets första fil kommer från T64:an (och ingen programstart är satt) skrivs en T64 med den byggda filen som
  första post och T64:ans filer efter den, de av dem som är i projektet som de byggdes, och VICE autostartar den: dess
  LOAD från bandet hittar de byggda filerna. Filerna före den tas inte med, och slutadresserna skrivs rätt.
- Annars läggs en kopia av T64:an i VICE:s datasette (`-1 <kopia>.t64`) med projektets filer från den återskrivna som
  de byggdes; PLAY trycks i VICE när programmet ber om det.
- VICE läser en T64 bara genom sina bandfällor (den har inga pulser), som en standardkonfiguration har av: med en `.t64`
  får VICE `-trapdevice1`.

Mätt på användarens arkiv: 63 175 filer som heter `.t64` lästes på 28 s. 63 090 är T64:or (40 522 `C64 tape image
file`, 22 288 `C64S tape file`, 278 `C64S tape image file`, 2 `C64 TAPE IMAGE`) med 67 249 filer (59 705 har en fil,
19 fler än 5); 54 filer slutar vid `$c3c6`, 37 till där deras byte inte finns, 2 före sin start, och 3 poster pekar
förbi slutet. De 85 andra är webbsidor, PRG:er och 8 TAP:ar med fel ändelse. Sindris `t64Files()` läser samma filer och
byte som `readT64()` i alla.

**Test:** `test/t64.test.ts` (huvudet, signaturerna, en TAP, en PRG och en webbsida som inte är T64:or; katalogen som
`makeT64()` skriver; lediga poster, 30 platser, 0 använda, en post med text; `$c3c6`, ett slut efter nästa fil och före
starten, ett slut före datans slut, en avkortad T64; en snapshot; Sindri läser detsamma; `writeT64()` med och utan byggda
filer och från en post; fixturen `fixtures/t64/mimir-demo.t64` och Sindri med den). Fixturen (`test/helpers/t64-demo.ts`)
är en egen bootfil vid `$0801` som kopierar en laddare till `$c000`, laddar `MIMIR DEMO` med `LOAD` från bandet och
startar det, rasterdemot och en sinustabell vars post slutar vid `$c3c6`; VICE autostartar den och visar rasterdemot.
Sindri: `packages/sindri/test/tape.test.ts` (katalogen, LOAD efter och före bootfilen med stand-ins och ROM:ar, inga
pulser). `test/vice.integration.test.ts` autostartar T64:or i riktiga VICE och lägger en i datasetten.
`packages/cli/test/cli.test.ts` och `e2e/app.spec.ts` (*a T64 in the datasette*) prövar CLI:t och appen.

### 13.5k Diskar för Krills loader (cc1541:s kommandorad)

Krills loader (Krill/Plush) laddar vanliga filer i diskens katalog, var och en en kedja av länkade sektorer med
laddadressen först. En del laddar en fil efter dess namn (`ldx #<namn / ldy #>namn / jsr load`, namnets byte fram till en
0) eller, med ett tomt namn (bara en 0), nästa fil i katalogen. Loadern har inget laddskript: katalogen är ordningen, och
namnen är ofta rader i en dir-art. Det som liknar ett skript mest är kommandoraden till cc1541, diskbyggaren som följer
med loadern: den skriver filerna i den ordningen och med de namnen. `readKrillDisk()`
(`packages/core/src/c64/krill-disk.ts`) läser katalogen och filerna (`KrillDisk`, `KrillEntry`, `KrillFile`), och
`cc1541Script()` skriver kommandoraden.

Loadern packar upp en fil medan den laddas, med den uppackare den byggdes med. Här läses filer packade med dess ZX0,
som Artline Designs *Nightfall* (2024) har dem. Formatet är läst ur den residenta delen av demots loader (`$0200–$03f8`:
anropet på `$0200` skickar namnet, uppackaren börjar på `$0300`), och anropen ur Sindri: först `"----------------"`
efter namn, sedan tomma namn som laddar nästa fil i katalogen (fil 2–6 i katalogens ordning).

**ZX0 i Krills loader** (`unpackKrillZx0()`):
- Först vart filen packas upp (2 byte, den höga först), sedan en zx0-ström. Det är dalis ström (Bitfire 1.x, 13.5c) med
  bitarna åt andra hållet i en byte och adressen åt andra hållet.
- Först en literal: en Elias-gamma-längd, sedan byten. Efter en literal kommer en kopia med förra offseten (0) eller en
  ny (1). Efter en kopia kommer en literal (0) eller en ny kopia (1).
- Talen är sammanflätad Elias-gamma: en 0 före varje bit, en 1 sist. Från 256 kommer de 8 låga bitarna först. Bitarna
  läses nedifrån i en byte (`lsr`), som hämtas när den behövs.
- En ny offset är ett tal (dess höga del + 1) och en byte: de 7 låga bitarna, sedan 1 för längd 2. Annars följer
  längden − 1 utan sin första 0. Talet 256 avslutar strömmen.
- En fil packad på plats har inget slut. Den slutar där skrivningen når läsningen efter en kopia, och resten är byten
  som de är. Bara några få byte får vara kvar så: mindre än en fjärdedel av filen. Andra byte vars två första säger
  att de packas upp strax ovanför där de laddas slutar efter några få byte och lämnar nästan allt (gamla diskar som
  Underground, 1989, och Pac Runner har sådana filer).

**Disken:**
- En disk räknas när minst två av dess filer packas upp så, och dubbelt så många som filerna som varken packas upp eller
  är BASIC-program på `$0801` (startprogrammet laddas med LOAD). En disk packad på annat sätt har då och då en fil som
  råkar packas upp.
- En katalogpost utan sektorer (spår 0, eller 18/0, BAM:en) är en rad i en dir-art. En post som börjar där en tidigare
  gör är samma fil (en loop-fil).
- Version 146 med Doynax LZ (GoatLight) läses också, se 13.5l, revision 166 med TinyCrunch (Space Beer), se nedan, och
  byggen med Exomizer, också de som laddar efter spår och sektor (Triads Continuum), se nedan. Byggen med andra
  uppackare (Pucrunch, ByteBoozer, Levelcrush) läses inte.

**Skriptet** (`cc1541Script`): först kommentarsrader om vad disken är och hur loadern laddar, och en rad per katalogpost
(filnamnet, var den laddas, vart den packas upp; en rad utan fil, samma fil som en tidigare). Sedan cc1541:s kommandorad:
- `-n` och `-i`: rubriken och id:ts fem tecken (`$a2`–`$a6` i BAM:en), och `-S` när interleaven inte är cc1541:s 10.
- Per post `-f` med namnet, `-B` när katalogen visar ett annat antal block än filen har (en dir-art visar ofta 0), `-T`
  för annat än PRG, och `-w` med filen, `-l` för en loop-fil eller `-L` för en rad utan fil.
- Namnen skrivs som cc1541 tar dem: bokstäver (`$41`–`$5a`) med små bokstäver, siffror, mellanslag och skiljetecken som
  de är, och alla andra byte som `#` och två hexsiffror (också `"`, `#`, `$` och `!`, som ett skal läser). Det är
  cc1541:s egen syntax (`-f "start#a0,8,1"`; källan, version 4.2, gör om små bokstäver till `$41`–`$5a`).
- Filerna heter `file01_0fa0.zx0`: posten och vart den packas upp (`.prg` när den inte är packad). Det är filen som den
  är på disken, som cc1541 skriver den.

**I appen:**
- Explorer säger om en monterad disk *Krill's loader: N files packed with its ZX0, loaded in the directory's order*,
  med knappen **Krill script** (för Exomizer och spår/sektor, se nedan). Monteringen säger *a disk for Krill's loader with N files packed
  with its ZX0*.
- Bottenpanelens flik **Krill script** har en rad per fil i katalogens ordning: posten, namnet som 1541:an listar det,
  var den laddas, vart den packas upp, storlek (packad → uppackad), filnamnet och anmärkningar (*packed with its ZX0,
  in place* eller *with an end*, *a BASIC program: loaded with LOAD and RUN*, var den börjar, *the directory shows 0
  blocks (16)*).
- Ett klick på raden öppnar filen som en PRG: uppackad där den packas upp, annars som den laddas. **+** lägger till den.
- **Copy script** kopierar cc1541:s kommandorad. **Save files…** sparar varje fil som den är på disken (`.zx0`, `.dnx`
  med Doynax LZ, `.tc` med TinyCrunch) och uppackad (`.prg`) i en mapp man väljer, med kommandoraden som
  `<disk>-cc1541.sh`.

**Mätt:**
- *Nightfall* (100 %-versionen): 27 filer, startprogrammet och 26 packade på plats (den största, `$0a`, från 10 914 till
  49 118 byte). Katalogen visar 0 block för alla, och två rader dir-art har ingen fil. Demot i Sindri laddade 6 filer
  på 86 s, och var och en är byte för byte vad läsaren packar upp.
- **Mot loaderns egen uppackare:** den residenta delen ur Nightfalls minne (`$0200–$03ff`) körd på Sindris 6502, med
  hela filen i minnet (blockväntan ersatt med `sec / rts`), packar upp varje fil som läsaren gör: alla 150 filer på de 11
  olika diskarna i Year-top20 (2,9 MB). 34 av Fishbomb sida B:s 38 filer säger själva att de packas upp från `$0000`; de
  kördes `$4000` högre, eftersom de annars skriver över uppackaren (strömmen är densamma: offseten är relativa).
- **Hela referensarkivet** (276 937 diskar på 8 minuter): 100 diskar läses, 28 olika, med 513 filer, varav 472 packade
  (323 på plats) som packas upp till 5,2 MB. Alla 472 är byte för byte vad Nightfalls uppackare ger på Sindris 6502.
  Demona är Nightfall, Morph, Eroismo, X2023 (Creators), Fishbomb, Orangi24, Innerverse, Assembly 2003 Memories
  (Hedelmae), Norwegian Arm och Tunnel Vision; spelen Shadows tre FablePhobia +3DS och Sanapyramidis preview; och
  IDE64-versionerna av Attitude 7–13, Naturality, Perfect Way och Samar Music Disk 1. Filerna som inte packas upp är
  startprogrammen och några få andra (Fishbomb sida A:s autostart på `$0326`). I Year-top20 och mappen med nyare demos:
  19 diskar, 11 olika. Ingen disk tas av en annan läsare (Spindle, Bitfire, BoozeLoader, Sparkle).
- Utan regeln om en fjärdedel gav arkivet 134 diskar: 33 till var gamla diskar (Underground från 1989, Pac Runner,
  TigerDisk, Dasher …) vars filer slutade på plats efter 2–36 byte och lämnade 90–100 % av sig själva. Utan regeln om
  BASIC-program gav Kings Size två BASIC-program som packades upp med slut.

**Test:** `test/krill-disk.test.ts`, med filer och diskar som `test/helpers/krill-disk.ts` skriver (en egen enkel packare
med loaderns ZX0, ingen kod från loadern): bitarnas ordning och adressen mot en ström skriven för hand, literaler och
kopior (också 16-bitars längder, långa offset och en upprepad offset), filer packade på plats och med slut, byte som inte
är en sådan fil (också byte som slutar på plats efter några få och lämnar resten), katalogen med BASIC-program, dir-art-namn, en rad utan fil och en loop-fil,
filnamnen, PRG:erna, cc1541-namnen och kommandoraden, och andra loaders diskar. `fixtures/d64/krill-demo.d64` är en av
diskarna: ett BASIC-startprogram, rasterdemot packat med slut, en fil packad på plats under ett dir-art-namn och en rad
dir-art. `e2e/app.spec.ts` (*a mounted disk for Krill's loader*) monterar den.

**Revision 166 med TinyCrunch** (Fossil, *Space Beer*, 2019). Mimir sa att startprogrammet hade Krills loader men läste
inga filer på disken, så det fanns ingen Krill script-flik och filerna gick inte att öppna en och en: loadern är byggd
med ChristopherJams TinyCrunch, som läsaren inte kände. Formatet är läst ur den residenta uppackaren i demots minne
(`$0374–$03ef`, efter att startprogrammet installerat loadern), `unpackKrillTinyCrunch()`, `KrillDisk.packer`
`'tinycrunch'`, filerna `.tc`:
- först den sista byten filen packas upp till, sedan vart den packas upp − 1 (2 byte, den låga först), sedan strömmen:
  en byte per token, inga bitar;
- `$00` avslutar (den sista byten skrivs sist); `$01–$7f` en kopia på (token >> 3) + 2 byte från upp till 2048 bakåt
  (`$800` minus tokens 3 låga bitar och nästa byte); `$80–$bf` en literal på token − `$7f` byte; `$c0–$ff` en kopia på 2
  byte från `$ff` − token bakåt (1–63);
- den packas upp på plats och läser strömmen där filen laddats: när skrivningen når byte i strömmen som inte lästs än
  läser den det den skrev. Space Beers J läser sitt slut ur en 0 som den skrev 9 byte före filens eget slut, och
  slutar 9 byte efter det.
- En fil räknas när strömmen slutar med filen, eller där uppackningen skrivit över filens sista byte (slutet en 0 den
  skrev); den kopierar bara byte den packat upp (TinyCrunch packar en fil för sig); och en literal på färre än 64 byte
  följs aldrig av en till (en packare gör dem till en). Eftersom varje byte är en token räcker inte mindre: utan de
  två sista reglerna togs 889 diskar i arkivet, mest gamla demos som Activas Ghostbusters Demo, vars startprogram
  "slutar" med sin första byte långt från filen.
- **Kontroll:** alla 15 packade filer på Space Beer är byte för byte vad demots egen uppackare gör av dem på Sindris
  6510 (med blockväntan ersatt med `rts`), och vad demot hade i minnet efter varje laddning när Sindri körde det från
  disken med 1541:an (alla 15 delar, J också).
- **Hela referensarkivet** (277 850 diskar): 76 diskar med TinyCrunch, 11 utgåvor (Krill-läsaren tar 403, med ZX0 och
  Doynax LZ samma 327 som förut, de andra läsarna samma som förut): Space Beer, Limbo Living (Fossil), 1981 (Desire),
  Pixels 35, Artificial Intelligence, Seaworld, Secam, Strawberry Strings, HeartMix sida B, Attitude #1 (IDE64) och
  spelet Hardhat Construction Co (två versioner). Krills loader, revision 164, 166 eller 184, finns i minnet efter
  startprogrammet på alla utom HeartMix sida B (inte bekräftat: Sindri fann ingen loader från sidans första fil) och
  Hardhat, vars spel har en egen TinyCrunch-uppackare och laddar sina banor själv; dess filer läses ändå (som Krills).
  I Sindri, i ögonblicket då loaderns uppackare returnerar: Secam 70 av 70, 1981 8 av 8, Pixels 35 10 av 10 och de 32
  filer Strawberry Strings hann ladda innan det startade om, byte för byte.
- **Test:** `test/krill-disk.test.ts` med en egen TinyCrunch-skrivare i `test/helpers/krill-disk.ts`: tokens mot en
  ström skriven för hand, alla sorters token, på plats, ett slut som uppackningen skrivit (som J), byte som inte är en
  sådan fil (också två korta literaler i rad och ett startprogram som "slutar" på sin första byte), och disken.
  `fixtures/d64/krill-tc-demo.d64` (rasterdemot packat på plats, en fil som packas upp på annat ställe) monteras av
  `e2e/app.spec.ts` (*a mounted disk for Krill's loader built with TinyCrunch*).

**Exomizer, och filer efter spår och sektor** (Triad, *Continuum*, Datastorm 2014, Year-top20 2014 nr 5). Mimir sa
*A fast loader (not one of the known ones)* om det uppackade programmet och läste ingenting på disken: alla filer är
DEL-poster med dir-art-namn. Startprogrammet (en Exomizer-sfx) installerar *Krill's Loader, version 146, configuration
81E.40.0.1.0.120010.18101C.0100101100* (texten finns i installeraren, som skrivs över sedan). Residenten ligger på
`$0200–$05ff`: `loadraw` på `$0200` (`jsr openfile / jsr pollblock / bcc / cmp #1 / rts`), `loadcompd` på `$020b`,
Exomizers uppackare på `$0487`, och på `$0471` en ingång som packar upp ur minnet (X/Y). Det här bygget tar inte ett
namn utan ett spår och en sektor: `ldx #spår / ldy #sektor / jsr $020b`. Med carry satt laddar `loadraw` till adressen i
`$06/$07` i stället för filens laddadress. Läses nu (`unpackKrillExomizer()`, `KrillDisk.packer` `'exomizer'`,
`KrillDisk.protocol`, filerna `.exo`):
- **Filen** är `exomizer mem -f`: laddadressen (2 byte, som loadern lägger blocken på), sedan vart den packas upp (2
  byte, den höga först), sedan en Exomizer-ström som packas upp framåt medan blocken kommer in, läst där filen
  laddats. Strömmen läses med Brokkrs läsare: protokoll 0 (Exomizer 2, Continuum, Fairlights och Onslaughts demos
  2010–2016), 7 (Lifecycle, Fleshlite, Battle Stations) eller 39 (Still Standing); disken får det protokoll som läser
  flest filer. Strömmen ska läsas till filens sista byte, och en fil som packas upp på plats (dess byte når strömmens)
  ska ha strömmen slutande minst Brokkrs säkerhetsmarginal efter datan, annars skulle uppackningen skriva över en byte
  den inte läst än.
- **Anropen** (`KrillDisk.calls`, `KrillCall`) läses ur filernas egen kod (uppackad, eller som den är när den inte är
  packad; inte BASIC-startprogrammet): en `jsr` eller `jmp` direkt efter kod som sätter X och Y (`krillCallRegs()`:
  den kortaste raka kodbiten, högst 24 byte, av omedelbara laddningar, tabelläsningar, `tax`/`tay`/`asl`, lagringar och
  `clc`/`sec`). X och Y är ett spår och en sektor där en fil börjar (`how` `'ts'`), en post i en tabell med spår och
  sektorer (`'table'`: `ldy tab+1,x / lda tab,x / tax`, posterna läses så länge var och en är en fils början), eller
  adressen till ett namn i samma fil som finns i katalogen (`'name'`). En rutin räknas som loaderns när två anrop
  anropar den (eller ett som laddar en fil efter namn), eller den ligger högst `$20` från en sådan (`loadraw` och
  `loadcompd` ligger 11 byte isär). I analysen är rutiner inom `$20` från varandra en grupp, som räknas med två
  anropsställen (tre utan residentdel funnen) eller ett anrop med ett namn, och aldrig KERNAL:s hopptabell (`$ff81`–):
  ett ensamt `ldx #4 / ldy #3 / jsr` nära residenten finns i flera byggens egen kod, och `ldx #<"M-R" / ldy #>"M-R" /
  jsr $ffbd` i ett annat. Programmet
  laddar antingen efter namn eller efter spår och sektor: anropen av det slag som har färre tas bort
  (`KrillDisk.by`; `null` för en Exomizer-disk utan anrop i filerna, där bygget kan vara vilket som helst, och fliken,
  Explorer och kommandoraden säger det). Med carry satt och en adress lagrad i två byte nollsida före anropet säger anropet vart filen ska
  (`dest`).
- **Filer utanför katalogen:** ett anrop efter spår och sektor kan peka på en sektorkedja som inte finns i katalogen.
  Den blir en fil (`entry` −1, namnet `t21s10_9000.exo` efter var den börjar), packas upp och läses efter anrop i sin
  tur. Ett anrop som pekar mitt i en annan fils kedja, på BAM:en eller katalogen pekar inte på någon fil.
- **Var disken känns igen:** `KrillDisk.found` är `'code'` när loaderns egen kod eller namn finns i en av filerna (som
  den är eller uppackad, `loaderCodeIn()` med Krill-tecknen i 8.11c), annars `'files'`: filerna är packade som loadern
  läser dem, men startprogrammet som installerar loadern är för det mesta packat. `exomizer mem -f` kan andra loaders
  läsa också.
- **Programmets skript** (5.15c, `findKrillScript()`, `AnalysisResult.krill`): analysen känner version 146 och äldre på
  `pollblock` (`ldx #$03 / stx $dd02 / cmp #$fe … ldx #$33|$37 / bit $dd00 / bvc / bmi / stx $dd02`, lika i alla byggen
  som mötts: Continuum, Revolved, GoatLight, Trick and Treat, Demolicious, Eclectic, Better), och läser anropen av
  loaderns rutiner (högst `$200` från residenten) på samma sätt som diskläsaren, i kod analysen spårat och i byte den
  inte spårat (Continuums laddningar körs av demots egen skriptmotor och nås inte). `krillLoads()` ger varje anrop dess
  fil på den monterade disken (efter namn när disken har namnet, annars efter var en fil börjar), och
  `krillScriptText()` skriver skriptet med cc1541:s kommandorad efter.
- **cc1541:s kommandorad** säger när bygget laddar efter spår och sektor (en disk som skrivs om måste ha varje fil där
  den börjar nu; det kontrolleras inte för kommandoraden), listar filerna utanför katalogen (kommandoraden skriver dem
  inte) och anropen i filerna som kommentarer.
- **I appen:** Explorer säger *Krill's loader: N files packed with Exomizer 2, loaded by their track and sector (6 not
  in the directory)*. Krill script-fliken visar också filerna utanför katalogen (posten är var de börjar, namnet *not in
  the directory*), vem som laddar varje fil (*loaded by the program at $084c, file04_2000.exo at $2625*), en tabell med
  anropen i filerna (fil, var, rutin, skriptrad, fil), och när analysen hittat skriptet en tabell med programmets
  laddningar (var, skriptrad, filen på disken med en knapp som öppnar den, anmärkningar); en rad där går till koden. Den
  finns också utan monterad disk. *Copy script* i skriptets del kopierar skriptet med kommandoraden, och *Save files…*
  sparar också `<disk>-krill-script.txt`.
- **Continuum:** 28 filer: startprogrammet, 20 packade i katalogen, en opackad (25/8, 29 435 byte på `$4800`, laddas
  med `loadraw`) och 6 packade utanför katalogen (spår 21–23). Huvudprogrammet laddar 2/20, 3/1, 5/19, 6/6, 9/15,
  11/17, 12/17, 17/10 och 24/12 (nio jobb, `clc / ldx / ldy / jsr $020b / bcs / rts`, som demots skriptmotor lägger i
  en kö). Delarna laddar resten: 5/19 laddar 6/17 och 6/16, 12/17 laddar 16/19, 24/12 laddar 25/8 opackad, 17/10
  laddar 19/18 och 20/9 opackade till `$e000` och `$f000` och packar upp dem ur minnet (`$0471`), och 20/9 har en
  tabell med 12 spår och sektorer: animationens bilder, varav sex utanför katalogen. Disk 2 (*2bextras*) är samma disk
  med tre filer till.
- **Kontroll:** alla 26 packade filer är byte för byte vad demots egen uppackare (ingången `$0471`, med residenten ur
  minnet efter installationen) gör av dem på Sindris 6510. Sindri körde demot från disken till slutet (264 s till den
  sista laddningen) och loggade varje anrop: alla 27 filer, i den ordning demot laddar dem (2/20, 3/1, 5/19, 6/17,
  6/16, 6/6, 9/15, 11/17, 12/17, 16/19, 17/10, 19/18 och 20/9 opackade till `$e000` och `$f000`, de 12 bilderna ur
  tabellen, 24/12 och 25/8 opackad), och efter varje är minnet byte för byte läsarens fil. Förut stannade Sindri efter
  92 s i en kopia av drivkod på `$0e2f`: den tog CIA:s avbrott och NMI en cykel för tidigt (rättat i Sindri, se dess
  README).
- **Demots skriptmotor** (inte läst av Mimir, bara beskriven här): huvudprogrammet kör varje bildruta (från IRQ:n,
  `$063d`) ett kommando ur en lista av ord, kommandots adress följd av dess argument; ett kommando som inte är klart
  gör `pla / pla / rts` och körs igen nästa bildruta. Kommandona: `$0689` lägg ett jobb i kön (4 platser, huvudloopen
  på `$0664` kör dem: laddningarna), `$0777` vänta tills kön är tom, `$0782` vänta till bildruta n, `$06c8`/`$06da`
  sätt och vänta ut en räknare, `$075d`/`$0771` sätt en rutin och vänta tills den sätter carry, `$06f4` hoppa,
  `$0727` anropa, `$072d` anropa skriptet vars adress står först i en del (delarnas huvud: `+0` och `+2` skript, `+4`
  init), `$0733` tillbaka, `$0796`/`$0799` skriv en byte eller ett ord, `$0825` byt rasterlista. Triads *Revolved*
  (2013) har en annan, äldre motor.
- **Referensarkivet** (Year-top20, 2 803 diskar): Krill-läsaren tar 179 diskar (var 77), alla 102 nya med Exomizer och
  inga tidigare lästa av en annan läsare; 17 av dem (6 utgåvor) laddar efter spår och sektor (Continuum, Fairlights
  Lash, We Are Mature, Techno Viking, Trick and Treat A, C och D, One Quarter). Sindri och analysen på en disk per utgåva: Krills
  loader i 34 av de 40 nya utgåvorna, i de sex andra stannade Sindri i ett intro innan loadern finns i minnet (We Are
  Mature, One Quarter, Algotecher, Bad Apple 64, Trafolta, Fleshlite). `pollblock`-tecknet känner nu också Trick and
  Treat, Demolicious, Eclectic, Better, Revolved och Solaris, som förut var okända.
- **Hela referensarkivet** (277 829 diskar): Krill-läsaren tar 870 (var 403). De 467 nya är alla Exomizer-diskar (73
  olika; 403 med protokoll 0, 51 med 7, 13 med 39), med 1 540 packade filer på de olika diskarna (19,5 MB uppackat), och
  ingen av dem lästes förut av någon annan läsare (Covert-läsaren, som kommer efter, skulle inte ha tagit någon). 79
  diskar (13 olika: Continuum, Lash, We Are Mature, Techno Viking, One Quarter och Trick and Treat A, C och D) laddar
  efter spår och sektor; bara Continuum har filer utanför katalogen. På 60 av de 467 finns loaderns kod i en fil.
- **Test:** `test/krill-exomizer.test.ts` med `packKrillExomizer` (Brokkrs packare) i `test/helpers/krill-disk.ts`:
  framåt till ett annat ställe, på plats och en byte för nära, protokoll 7 och 39, en disk efter namn, en disk efter
  spår och sektor med en del som laddar på alla tre sätten och en kedja utanför katalogen, ett ensamt anrop och ett som
  pekar mitt i en fil, programmets skript (spårat och inte spårat, efter namn), och fixturerna
  `fixtures/d64/krill-ts-demo.d64` och `fixtures/prg/krill-ts-script.prg`, som `e2e/app.spec.ts` (*Krill's loader
  loading by track and sector*) öppnar.

### 13.5l Diskar för Covert Bitops-loadern (makedisks och maked64:s kommandofil) – och GoatLight

Covert Bitops-loadern (Cadaver, Lasse Öörni) finns i två generationer: version 2, *Autoconfiguring Loader/Depacker*
2.0–2.29 (2002–2020), och version 3, *Loadersystem* 3.0–3.06 (2023). Den laddar vanliga filer i diskens katalog, var och
en en kedja av länkade sektorer, efter namn:
- version 2 med två bokstäver i X och Y (namnets två första tecken) eller en pekare till ett helt namn som slutar med en
  0 (en `*` avslutar det tidigare);
- version 3 med ett nummer i A: namnets två första tecken som hexsiffror (`"00"`–`"FF"`; resten av namnet tittar
  drivkoden inte på).

Filen går till minnet byte för byte, som drivkoden skickar den, med den rutin programmet anropar. `readCovertDisk()`
(`packages/core/src/c64/covert-disk.ts`) läser katalogen och filerna (`CovertDisk`, `CovertEntry`, `CovertFile`,
`CovertCall`), och `covertScript()` skriver kommandofilen som bygger disken igen.

**Källorna** är Cadavers egna: loaderns alla releaser från hans sidor (cadaver.github.io: `loader.zip` = 2.05,
`loader212.zip`, `loader223`–`229`, `loader30`–`306`, var och en med källkod, testprogram och en färdigbyggd
exempeldisk), c64loader, c64gameframework, Hessian, MW4 och Steel Ranger på GitHub, och c64tools med `makedisk.c`.

**Filerna:**
- *Som de är:* de två första byten är laddadressen (`LOADFILE`, `LoadUnpacked`), eller programmet säger vart
  (`LoadUnpackedRaw`).
- *Exomizer 1/2* (`LOADFILE_EXOMIZER`, version 2): filen är `exomizer level` (Exomizer 1: `exomizer -r`) som den är:
  var den slutar, den höga byten först, sedan strömmen (protokoll 0), som packas upp baklänges. Med `-f` (loadern
  byggd med `FORWARD_DECRUNCHING`) är adressen starten och den packas upp framlänges. En fil som får plats åt båda
  hållen tas baklänges, loaderns standard.
- *Exomizer 3* (2.27–2.29 byggd med `EXOMIZER_VERSION_3`): detsamma med `exomizer3 level`, protokoll 7 (bitarna
  uppifrån i en byte, längre offset i hela byte, första literalen utan flagga), och framlänges med `-f`.
- *Exomizer 3 raw* (`LoadExomizer3Raw`, version 3): `exomizer3 raw -T4 -M256 -P-32 -c`, bara strömmen, framlänges dit
  programmet säger (X och Y). Cadavers egna spel packar så också (`pack3`, som lämnar Exomizer 3.1:s protokoll 39 som
  det är), men deras motorers loaders och chunk-filer (`pchunk`) är deras egna och läses inte här.
- *Pucrunch* (`LOADFILE_PUCRUNCH`, version 2): `pucrunch -c0`: en laddadress som loadern hoppar över, `"pu"`, slutet,
  escape-värdet, starten, parametrarna, högst 31 RLE-byte och sedan strömmen. Det är Pucrunchs gamla format, som
  loaderns uppackare läser (en byte över tabellen är 5 bitar och 3 till); dagens Pucrunch skriver 15 RLE-byte.
- Strömmarna läses med Brokkrs Exomizer-läsare (den läser alla protokoll) och en egen Pucrunch-läsare
  (`unpackCovertExomizer`, `unpackCovertExomizer3Raw`, `unpackCovertPucrunch`, `unpackCovertFile`). En fil räknas bara
  när strömmen slutar där filen slutar.

**Disken:**
- En disk räknas när loaderns kod finns i en av dess filer, som den är eller uppackad: installerarens drivkommandon
  `M-W` och `M-E` lagrade baklänges (version 2: `20 00 00 "W-M" 05 00 "E-M"`, version 3: `20 04 04 "W-M" .. .. "E-M"`),
  annars mottagarloopen (3.0 och 3.01: `lda #$10 / ora $dd00`, version 2 och 3.02 och senare: `lda $dd00 / ora #$10`).
- Eller när minst två av dess filer är packade som loadern läser dem, och dubbelt så många som filerna som varken är
  packade eller BASIC-program på `$0801` (de laddas med LOAD och prövas inte), som för Krills loader (13.5k).
- Versionen är kodens, annars den som packar så (raw: version 3).
- Andra loaders som läser `exomizer level`- eller `pucrunch -c0`-filer som de är skulle också räknas; deras filer packas
  upp lika rätt. Monteringen prövar läsarna i ordningen Spindle, Bitfire, BoozeLoader, Sparkle, Krill, Covert.

**Anropen i koden** (`CovertCall`): loadern har inget laddskript, programmet ber om en fil efter namn. I filernas kod
(uppackad, eller i en fil som inte är packad) läses `ldx #"A" / ldy #"B" / jsr`, `ldx #<namn / ldy #>namn / jsr` (namnet
i samma fil, avslutat med 0) och `lda #$01 (/ ldx #<till / ldy #>till) / jsr`, när de namnger en fil på disken.
`lda #n / jsr` finns överallt: en rutin räknas som loadern när den anropas med två av diskens filer eller fler, eller
från ett program med loaderns kod och med X och Y satta också. En raw-fil packas upp dit det första anropet som laddar
den lägger den; utan ett sådant öppnas den på `$1000` (`COVERT_RAW_AT`). Ett startprogram som är packat med en
Exomizer-sfx (det vanliga) har sina anrop utom räckhåll här.

**Hur disken byggs:** med Cadavers egna verktyg, *makedisk* (c64tools; loaderns exempeldiskar, BOFH, MW4) och
*maked64* (Hessian, Steel Ranger, c64gameframework). Båda tar en kommandofil med en rad per fil, den lokala filen och
namnet på disken (`_` för mellanslag), och på kommandoraden diskens namn (16 tecken rubrik, 2 till, id:t, ett till och
DOS-typen: `_` för `$a0`, `.` för ett mellanslag) och interleaven.
- makedisk skriver filerna i kommandofilens ordning, från katalogen och utåt: spår 17 nedåt, sedan 19 uppåt (med
  interleave över 10 tvärtom), och katalogen i samma ordning.
- maked64 skriver från spår 1 och uppåt i den ordning som står efter den första tomma raden, med en fils egen interleave
  efter dess namn; med `dir` får filerna gå på spår 18 också.
- Båda börjar en fil på första lediga sektorn på ett spår (från sektor 0 uppåt; med interleave över 10: 0 och sedan
  nedåt) och går `interleave` sektorer vidare, annars till nästa lediga på spåret, annars till nästa spår.
- `readCovertDisk` lägger ut filerna som vart och ett av verktygen gör och säger vilket som lagt disken (`tool`), i
  vilken ordning (`order`) och med vilken interleave (diskens: den flest filer tar, och en fils egen, `fileInterleave`).

**Skriptet** (`covertScript`, `covertScriptText`): kommandofilen så som verktyget läser den (`seq`), anteckningar om
disken och varje post med anropen som laddar den (`notes`), och kommandoraden, till exempel
`makedisk examples.d64 examples.seq LOADER_EXAMPLES___LE_2A 12`. makedisk tar varken kommentarer eller tomma rader i sin
kommandofil (en tom rad skriver förra filen igen), så anteckningarna står för sig. Ett namn med byte som inte kan
skrivas i en kommandofil (skiftade bokstäver, grafik, `$a0` inne i namnet) står som `?`, med en anteckning om byten.
Filerna heter `file01_0801.exo`: posten och vart den packas upp (`.exo`, `.exo3`, `.puc`; `raw` för en raw-fil utan
adress; `.prg` när den inte är packad).

**I appen:**
- Explorer säger om en monterad disk *Covert Bitops loader: version 2, 3 files packed (Exomizer 1/2, Exomizer 3,
  Pucrunch), 1 load call read from the code; files loaded by name, laid out by makedisk*, med knappen **Covert
  script**. Monteringen säger *a disk for the Covert Bitops loader (…)*.
- Bottenpanelens flik **Covert script** har en rad per fil: posten, namnet som 1541:an listar det, var den laddas
  (*packed* för en packad fil), vart den packas upp (*raw* när programmet säger det), storlek (packad → uppackad),
  filnamnet och anmärkningar (packaren och hur filen görs, *raw: the program says where*, loaderns egen kod, anropen som
  laddar den, var den börjar, blocken katalogen visar). Under raderna står anropen och kommandofilen med kommandoraden.
- Ett klick på en rad laddar in filen i Mimir som en PRG: uppackad där den packas upp, annars som den laddas. **+**
  lägger till den i projektet.
- **Copy script** kopierar anteckningarna, kommandofilen och kommandoraden. **Save files…** sparar varje fil som den är
  på disken och uppackad (`.prg`) i en mapp man väljer, med `<disk>.seq` (kommandofilen) och `<disk>-makedisk.txt` eller
  `<disk>-maked64.txt` (anteckningarna och kommandoraden).

**Loadersökningen** (8.11c) kände bara igen version 3. Nu känns version 2 igen på sin mottagarloop (`lda $dd00 / ora
#$10`), 1-bitsloopen (`lda #$10 / eor $dd00 / sta $dd00 / asl / ror`, som bara räknas med loaderns egen kod) och
installerarens `M-W`/`M-E` baklänges: testprogrammen i 2.05, 2.12 och 2.29 hittas.

**Kommandoraden:** `mimir disks <mapp>... [--list] [--json]` läser varje D64 och G64 i mapparna som appen gör när den
monterar en, och räknar diskarna och de olika diskarna (efter innehåll) som varje loaders läsare tar; `--list` skriver
en rad per disk med vad läsaren säger. Det är så arkivet räknas och falska träffar letas.

**Mätt mot Cadavers egna diskar** (exempeldiskarna i loaderns 16 releaser, 2.05, 2.12, 2.23–2.29 och 3.0–3.06):
- Alla läses, versionen av koden i testprogrammen. Alla 28 packade filer (Exomizer 1 och 2, Exomizer 3, Exomizer 3 raw,
  Pucrunch) är byte för byte vad loaderns egen uppackare gör av dem: rutinen ur testprogrammet på samma disk
  (`loadfile_exomizer`, `loadfile_pucrunch`, `LoadExomizer3Raw`) körd på Sindris Cpu, med `openfile` och `getbyte`
  fångade så att `getbyte` ger filens byte (version 3:s `GetByte` lämnar carry som den är, version 2:s nollar den;
  2.05 läser genom en omslagsrutin `php / jsr getbyte / bcs / plp / rts`).
- 15 av de 16 är lagda som makedisk lägger dem (inte 2.05:s). Testhjälparen skriver de 15 igen byte för byte ur det
  läsaren läste: namnet, interleaven, ordningen och filerna. maked64-porten skriver c64gameframeworks `example.d64` igen
  byte för byte ur dess `example.seq`.
- 3.x-diskarnas raw-fil `01` får sin adress, `$4000`, ur testprogrammets anrop `lda #$01 / ldx #<$4000 / ldy #>$4000 /
  jsr`.
- Ingen av Mimirs andra fixture-diskar tas, inte heller GoatLight eller Cadavers musikdiskar. c64gameframeworks
  exempeldisk tas inte: tre av dess åtta filer är Exomizer 3 (raw och `level -f`), de andra fem `pchunk3`-filer, och
  dess loader är motorns egen.

**GoatLight** (Fairlight, Noice och Offence, Revision 2015, CSDb 137495) togs för en Covert-disk, men är det inte.
CSDb:s credits säger *Loader … Krill of Plush*, sd2iec:s lista över produktioner med Krills loader säger version 146, och
startprogrammet (som Sindri packar upp: en Exomizer-sfx till `$0800–$9766`, start `$4800`) har texten *Krill's Loader,
version 146, configuration 81E.40.1.0.0.120002.18101C.01101011000110000010.6.0A2712120201.2.0*: filnamn på 2 tecken
(`FILENAME_MAXLENGTH` 2) och uppackare 2, Doynax LZ (Doynamite). Mimir kallade startprogrammet *A fast loader (not one
of the known ones)*. Nu:
- Krill-läsaren (13.5k) läser också version 146 med Doynax LZ (`unpackKrillDoynax`, `KrillDisk.packer` `'doynax'`,
  filerna `.dnx`). Formatet är läst ur loaderns `doynaxdecomp.s` (r146) och ur den residenta delen i GoatLights minne:
  - först vart filen packas upp (2 byte, den låga först), sedan strömmen. Bitarna läses uppifrån i en byte, som hämtas
    när den behövs; literalernas byte och fjärran offsets låga byte tas ur strömmen mellan dem;
  - en 1 börjar en literal: längden som sammanflätad Elias-gamma (en 0 före varje bit till, en 1 sist; 0 är 256), sedan
    byten, den sista först. Efter en literal på 256 byte kommer en 1 eller 0 igen, efter en kortare alltid en kopia;
  - en kopia: 3 bitar (den första 1 för en kopia på 2 byte, sedan vilket av fyra offsetintervall), offseten (i bitar,
    eller höga bitar och en byte, räknad nedåt från intervallets topp), och för en längre kopia längden − 1 som gamma
    (en databit, sedan 0 för att fortsätta eller 1 för att sluta). Längden 256 avslutar strömmen, som ska sluta där
    filen slutar;
  - loadern packar upp på plats och läser strömmen där filen laddats. När skrivningen når byte i strömmen som inte är
    lästa än läser den det den skrev: GoatLights `C1` skriver över tre sådana byte, och läsaren gör likadant
    (`KrillUnpacked.overwritten`, som tabellen och skriptet visar).
- ZX0 prövas först, sedan Doynax LZ: diskens filer ska packas upp med samma uppackare.
- Loadersökningen känner igen version 146 på installerarens versionstext (`"Krill's Loader, version "` i PETSCII med
  stora och små bokstäver), och GoatLights startprogram kallas nu *Krill's loader*.
- **Mätt:** sida A har 30 poster (28 filer: startprogrammet och 27 packade, två rader dir-art), sida B 8 poster (6 filer:
  5 packade och `D2`, 4 byte). Alla 32 packade filer är byte för byte vad demots egen uppackare gör av dem: `decompress`
  ur den residenta delen i startprogrammet (`$9650`, som körs flyttad till `$043c`) körd på Sindris Cpu, med filen i
  minnet där den laddas och `getcmem` riktad mot den. I appen (Electron under Xvfb) listar fliken **Krill script** båda
  sidorna, en rad laddar in en fil uppackad (`file04_3100.prg`, `file02_6400.prg`), och **Save files…** sparar 28 och 6
  filer, packade och uppackade, med cc1541:s kommandorad.
- Sindris 1541 behöver DOS-ROM:en, som inte fanns i molnet där detta gjordes: GoatLight kördes inte med disken i
  Sindris station. Verifieringen är demots egen uppackare mot varje fil.

**Test:** `test/covert-disk.test.ts`, med diskar som `test/helpers/covert-disk.ts` skriver (makedisk och maked64
portade från deras C-källor, filer packade med Brokkrs Exomizer-strömmar och en egen enkel Pucrunch-skrivare, ingen kod
från loadern utom där ett test lägger dit byte av den): varje packare (Exomizer level bak- och framlänges, Exomizer 3,
raw, Pucrunch med escape, kopior och RLE), byte som inte är någon fil, version 2:s disk (makedisk, anrop med bokstäver
och med namn), version 3:s disk (maked64 med skrivordning och en fils egen interleave, koden, raw-filer dit anropet lägger
dem), filnamnen och PRG:erna, att skriptet skriver samma disk igen byte för byte (makedisk, maked64, maked64 med `dir`),
en disk som inget verktyg lagt, och andra loaders diskar. `fixtures/d64/covert-demo.d64` är en av diskarna:
ett BASIC-startprogram som laddar `"01"` med bokstäver, rasterdemot packat med `exomizer level`, en Pucrunch-fil, en
Exomizer 3-fil och en fil som den är, lagda av makedisk. `e2e/app.spec.ts` (*a mounted disk for the Covert Bitops
loader*) monterar den. `test/krill-disk.test.ts` har Doynax LZ (en egen skrivare i `test/helpers/krill-disk.ts`), och
`test/loaders.test.ts` version 2 och Krills version 146. `packages/cli/test/cli.test.ts` kör `mimir disks` på
fixture-diskarna.

### 13.5m IFFL-filer (en fil med alla delar ett spel laddar)

En IFFL-fil ("integrated file flexible loader") är en enda DOS-fil som håller alla delar ett crackat spel laddar, den ena
efter den andra: spelets loader ber om en del efter dess nummer, och driven går längs filens sektorkedja till den. Filen
är inget program: den har ingen laddadress (dess första byte är en tabell) och är ofta större än en C64:s minne, så den
går varken att köra eller packa upp som ett program. Den som öppnade den fick förut ett "program" på en adress som
tabellens två första byte råkade ge (The Last Ninja +10DI från Cryonix: `$3a9f-$248cd`), och Unpack svarade att inget
packades upp. `readIfflDisk()` (`packages/core/src/c64/iffl-disk.ts`) läser diskens IFFL-filer (`IfflDisk`,
`IfflFile`, `IfflPart`, `IfflPiece`).

- **Formatet** är det som de senaste årens IFFL-crackar har (Hokuto Force, Onslaught och Excess kallar filen
  `IFFLDATA`, Cryonix ger den spelets namn): filens första sektor, 254 byte, är tabellen med delarnas längder, först
  deras 127 låga byte och sedan deras 127 höga, oanvända poster 0. Delarna följer från byte 254 utan något mellan sig.
- **Regeln:** en fil räknas som IFFL när minst två längder är satta, ingen är satt efter en osatt, och längderna slutar
  precis där filen slutar. Summan är det som skiljer en sådan fil från alla andra.
- **En del** är det loadern läser i ett svep: oftast en kedja av bitar, var och en en `exomizer level`-fil som den är:
  var biten slutar i minnet (höga byten först) och sedan strömmen, som läses framåt medan driven skickar den och skrivs
  från slutet och bakåt. Strömmen är Exomizer 2:s (protokoll 0: Hokuto Force, Onslaught, Excess) eller Exomizer 3:s
  (protokoll 39: Cryonix), samma för filens alla delar: den som läser flest delar till deras slut. En del är uppackad när
  dess bitar följer på varandra till delens slut och ingen är längre än minnet under sitt slut; andra delar (en
  highscore-tabell, data i spelets eget format som hela Mickey's Space Adventure) behålls som de är lagrade.
  Strömmarna läses med Brokkrs Exomizer-läsare (`readStream`).
- **I appen:** Explorerns disk säger *IFFL: "namn" is no program but N parts in one file…* med knappen *IFFL parts*.
  Ett klick på filen i katalogen öppnar inte ett program utan fliken, med en toast som säger varför. Fliken **IFFL
  parts** har en rad per del i tabellens ordning (delens nummer är det loadern ber om): var i filen den börjar, vart
  dess bitar packas upp, byte före och efter, filnamn och hur den är packad. En rad öppnar delens bitar uppackade, en
  PRG per bit på dess adress (`iffl01_part04_0700.prg`), + lägger till dem i projektet. En del som inte är packad har
  ingen adress och kan bara sparas. *Save parts…* sparar varje del som den är lagrad (`.exo`, annars `.bin`) och
  bitarna uppackade. IFFL-filen läses bredvid det disken annars är (en loaders disk kan ha en också).
- **Mätt på referensarkivets spel** (138 235 diskar): 28 diskar har en sådan fil, av 9 släpp. I 7 av dem packas delarna
  upp (alla utom highscore-tabeller och liknande): The Last Ninja +10DI (Cryonix) 42 av 42 delar, 235 630 byte; Skate
  or Die 6 av 7 (21 bitar); Double Dragon 3 11 av 11; Hokuto Forces Last Ninja 11 av 11 (51 bitar) och Last Ninja II 13
  och 18; Planet X2 13 av 13; Charlie Chaplin 30 av 30; Platman Worlds 30 av 38; Yoomp64 34 av 38. Mickey's Space
  Adventure (3 sidor) har delar i eget format och listas som lagrade.
- **Kontrollen:** nivåerna i två crackar av The Last Ninja, packade med olika Exomizer och delade i olika bitar
  (Hokuto Force och Cryonix), packas upp till samma byte där bitarna överlappar: en nivås `$0700-$5400` så när som på
  5 byte av 19 712, dess `$9e00-$afff` och `$0800-$15xx` helt. Ingen del har jämförts med en körning där spelet
  laddar den: Sindris körningar stannar i crackarnas menyer.
- **Tester:** `packages/core/test/iffl-disk.test.ts` (en egen `exomizer level`-skrivare med Brokkrs cruncher: bitarna
  bakifrån med båda Exomizer, kedjor, det som avvisas; tabellen; `fixtures/d64/iffl-demo.d64` med raster-demot som en
  del, en del av två bitar och en opackad tabell) och ett e2e-test som klickar på filen, öppnar delar och sparar dem.

### 13.5n Diskar för DLoC:s loader (Six, Dark Lords of Chaos) – Halloween 2026

Halloween 2026 (Dark Lords of Chaos, 31 oktober 2026, CSDb 265406, nummer 7 på topplistan) är gruppens första demo med
flera delar på en disk. Six skrev koden, och enligt släppets produktionsanteckningar är allt gjort med gruppens egna
verktyg: egen assembler, egen packare och egen loader (med idéer från GIJOE och Bitfire). Mimir sa förut bara *A fast
loader (not one of the known ones)* om installern och ingenting om delarna. Källkoden är inte offentlig, så allt nedan
är läst ur demots egen disk: bootfilen uppackad, drivkoden ur C64-minnet där installern har den, och en körning i
Sindri med disken i driven som loggade varje anrop av loadern.

**Hur loadern fungerar.**
- Disken är en vanlig DOS-disk. C64:an ber om en fil med dess namn (A = längden, X/Y = var namnet ligger), drivkoden
  letar i katalogen efter den första stängda PRG-filen vars namn börjar med de byten och skickar sektorerna i den
  ordning DOS:en länkar dem. Varje block börjar med sin längd (`$fe` för en hel sektor, 0 slutar filen, `$ff`: hittades
  inte). Namnet går till driven en bit i taget på DATA med CLK som klocka; filen kommer 2 bitar i taget med ATN som
  klocka (C64:an skriver `$dd00`, driven väntar på bit 7 i `$1800`). Drivkoden läser själv GCR-byten och har DOS:ens
  jobbkö som reserv.
- Den residenta delen ligger på `$fc00` med en tabell av hopp: `$fc00` laddar en fil, packar upp den medan den laddas
  och startar den; `$fc03` öppnar en fil (carry 0: till dess laddadress, 1: till adressen i `$fb/$fc`); `$fc06` läser
  A byte till av den; `$fc09` packar upp en ZX0-ström i minnet (X/Y pekar på vart, sedan strömmen); `$fc0c` och `$fc0f`
  anropar programmet före och efter en laddning.
- En fil för `$fc00` är: vart den packas upp (2 byte), var den startar (2 byte), sedan en ZX0-ström i ZX0:s första
  format (bitarna från toppen av en byte; en ny offsets höga del + 1 som en interfolierad Elias-gamma med bitarna som de
  är, 256 slutar strömmen; den låga byten med 7 bitar och längdens första bit). En del slutar med att ladda nästa:
  `lda #längd / ldx #<namn / ldy #>namn / jmp $fc00`. Delarna packas upp till `$0801` med en BASIC-rad `2026 SYS …`, så
  varje del går också att köra för sig.
- Bootfilen (`HALLOWEEN`) är ett BASIC-program som LOAD och RUN laddar, packat med Sixs egen packare: en
  självuppackande fil vars första kod kopierar uppackningskoden till `$0100` och `$0180`, flyttar strömmen till
  `$df00-$ffff` och packar upp den till `$0801-$42a9` med samma ZX0-kod. Det uppackade mäter PAL/NTSC, laddar upp
  drivkoden med M-W till `$0300-$06ff` och `$0745-$07fd`, startar den med M-E `$0300`, kopierar den residenta delen till
  `$fc00` och laddar `INTRO`.
- Ordningen i Halloween 2026: `HALLOWEEN` → `INTRO` → `GHOST` → `LEAVES`; sista delen öppnar `CREDITS` och `MORPHS`
  (inte packade) genom en egen tabell (`$aca4`: namnens adresser och längder) och läser dem några byte i taget med
  `$fc06` medan den spelar, om och om igen.

**Det Mimir läser.** `readDlocDisk()` (`packages/core/src/c64/dloc-disk.ts`) läser katalogens filer (`DlocDisk`,
`DlocEntry`, `DlocFile`): en fil för `$fc00` packas upp (`unpackDlocFile`, med `unpackZx0`) när strömmen slutar precis
där filen slutar och startadressen ligger i det uppackade; bootfilen packas upp som Sixs packare gör det
(`unpackDlocBoot`: koden hittas efter sitt mönster, och dess pekare, sidor och slutets `jmp` läses ur den). Anropen av
loadern läses ur delarnas kod, bootens uppackade kod med (`DlocCall`): ett `jsr`/`jmp` till tabellens fyra rutiner, med
A, X och Y (och `clc`/`sec`) som sätts direkt före; ett namn i X/Y blir filen driven skulle hitta. En del som öppnar
filer med register som sätts någon annanstans får de av diskens filnamn som står i dess minne (`DlocName`; `LEAVES`:
`CREDITS` på `$acaa`, `MORPHS` på `$acb1`). Ordningen följs från bootfilen genom laddningarna, med filerna en del
öppnar efter den. Tabellens adress tas från loaderns egen kod när den finns (det första hoppet går till koden direkt
efter tabellen), annars `$fc00`.

**Regeln:** en disk räknas när loaderns kod finns i en fil (som den är, uppackad eller i det bootfilen packar upp sig
till: C64:ans mottagarloop eller drivens sändning) eller när minst två filer är packade för `$fc00` och minst dubbelt så
många som de filer som varken är packade, BASIC-program eller öppnas av en del. Den prövas efter de andra loadrarnas
läsare.

**I appen** säger toasten och Explorerns disk-del *DLoC's loader* med en sammanfattning (*3 files packed with ZX0, 3
load calls read from the code; HALLOWEEN → INTRO → GHOST → LEAVES (a part reads CREDITS, MORPHS)*), och fliken
**DLoC script** listar filerna i den ordning de laddas: var en fil laddas eller packas upp, start, storlek, filnamn
och vem som laddar den. En rad öppnar filen i Mimir uppackad (bootfilen: det packaren packar upp den till, med
`2026 SYS 2067`), + lägger till den. Under den står anropen och skriptet: varje fil i ordning med sina anrop, och
c1541:s kommandorad som skriver disken igen (`c1541 -format "halloween 2026,26" d64 … -write intro.zx0 "intro" …`;
disken är en vanlig DOS-disk, så den räcker). *Copy script* kopierar det, *Save files…* sparar varje fil som den är på
disken (`.zx0` för en packad del) och uppackad (`<namn>_0801.prg`) med skriptet (`<disk>-dloc.txt`). En del packas om
med `zx0 -c` (det första formatet) med adress och start framför. `mimir disks` räknar disken som `dloc`.

**Analysen** känner loadern (`dloc` i `analyze/loaders.ts`): mottagarloopen (ATN vänds för varje bitpar, `lda $dd00 /
and #$c0`), sändningen av namnet, tabellen av hopp med laddrutinen efter, drivkodens sändning av en byte som två nibblar
ur en tabell, och (svaga, de finns hos andra också) katalogsökningen och ZX0-uppackaren. Både bootens uppackade bild och
den residenta delen på `$fc00` får nu namnet. **Sindri** namnger bootens två lager *DLoC / Six's ZX0 packer (stage 1)*
och *(depacker)* (`packages/sindri/data/signatures.json`; närmast någon annan packare i listan är 12 %).

**Kontrollen:**
- Sindri körde demot med disken i driven i 25 C64-minuter: alla tre `$fc00`-laddningar (INTRO, GHOST, LEAVES) är byte
  för byte det `unpackDlocFile` gör av filerna (50 999, 50 670 och 51 135 byte), och `unpackDlocBoot` ger bootens
  `$0801-$42a9` så när som på de 7 byte installern själv skriver om när den kör (`$08d4-$08e9`, `$42a1-$42a5`).
- Referensarkivet, alla D64 och G64 (277 829 diskar, 16 minuter): läsaren tar 5, samma Halloween 2026-disk i fem
  mappar; ingen annan disk, och ingen av de andra loadrarnas läsare tar den.
- **Tester:** `packages/core/test/dloc-disk.test.ts` (en egen ZX0-skrivare i det första formatet och en boot lagd som
  Sixs packare lägger den, `test/helpers/dloc-disk.ts`; inget av Sixs kod), `fixtures/d64/dloc-demo.d64` (en boot som
  laddar `PART1`, raster-demot packat, `PART2` som öppnar `DATA` med namn och `MUSIC` genom en tabell), loader-testet i
  `loaders.test.ts` och ett e2e-test som monterar disken, öppnar delar och sparar dem.

Inte gjort: drivkodens felvägar (`$ff` för en fil som inte finns, återförsök med DOS:ens jobb) och PAL/NTSC-mätningen
är bara lästa, inte prövade. Six skriver på CSDb att loadern "kvävs" av fler enheter på bussen.

### 13.5o Para-Protect (Paranoids kopieringsskydd och laddare) – Bangkok Knights

`readParaProtectDisk` (`packages/core/src/c64/paraprotect.ts`) läser Para-Protect V2 på en monterad disk. Analysen av
bootet, drivkoden, laddaren och Bangkok Knights eget format finns i `docs/paraprotect.md`. Arkivet har åtta sådana
skivor (System 3, Elite, Electra, Digital Integration, Screen 7, DataByte), alla G64.

- **Bootet** känns igen på sin text (`PARA-PROTECT V2 1987` i katalogens första fil). Det laddas som KERNAL:ns seriella
  LOAD laddar det: en byte i taget genom pekaren på `$AE/$AF`. STOP-vektorn, som filen laddar över, anropas före varje
  byte efter den första, och koden den pekar på körs på Sindris 6510 (`Cpu`) tills den lämnar RAM. Bilden blir exakt den
  Sindri har vid `$0203`, alla åtta skivorna.
- **Tabellen:** laddarstubben (`SEI / LDA dest,X / STA $8F / LDA sidor,X / PHA / LDA spår,X / PHA / LDY sektor,X / … /
  JMP $00B2`) och slingan som kopierar den till sida 2 ger var tabellerna ligger. Deras avstånd ger antalet förfrågningar.
  Varje förfrågan har vart sidorna går, hur många, spår, sektor och om driven går tillbaka till DOS:en (bit 7). Drivkommandot
  (`M-E $0205`) läses också.
- **Laddarens filer:** sidorna läses som drivkoden läser dem. Huvudet hittas efter ett SYNC och datablocket efter nästa
  SYNC, vilken första byte det än har. Läsaren går *steg* sektorer vidare och tar nästa spår, sektor 0, när det slår runt
  till 0. Antal sektorer på ett spår tas ur laddarens egen tabell när dess kod ligger okrypterad på spår 18 (`JSR $F24B /
  LDA tabell,X / STA $C2 / CLC / LDA sektor / ADC #steg / CMP $C2`, alltså 17, 17, 19, 19 och 8, F-16 1), annars ur
  DOS:en med steg 8 (Bangkok Knights, vars steg är krypterade). En G64 läses spår för spår. En D64 läses i sina sektorer,
  och dess felbyte säger vilka DOS:en inte kunde läsa: Bangkok Knights datablock har sektorns nummer som första byte, och
  en D64 av den saknar dem. Namnet är påhittat av första sektorn och laddadressen (`t21s0_ba00.prg`).
- **Sidor efter spår 35** som ingen förfrågan nämner (40/14 på Bangkok Knights, som spelet själv ber om) listas med en
  laddadress tagen ur sidans egen kod: den höga byten som de flesta av dess `JSR`/`JMP` har, om minst tre har den.
  Annars laddas sidan på `$0000`.
- **Ett spels egen katalog** (Bangkok Knights: 11/0): sektorer vars datablock ligger direkt efter huvudet, utan SYNC,
  läses på varje spår. Huvudet hittas på varje byte från föregående SYNC, eftersom 11/0 inte har något eget SYNC. En
  katalogsektor som ingen annan länkar till är början. Dess poster läses som DOS:ens kedjor och behåller sina namn
  (`S.CHU.prg`).

Vid montering säger toasten och Explorer (*Disk*) vad som hittats, och fliken **Para-Protect** i bottenpanelen visar
bootet: hur det laddar, antalet STOP-anrop, drivkommandot och stubben. Den visar också hur driven stegar och de
filer katalogen inte listar, en rad per fil med sort, första sektorn, antal sektorer, var den laddar, storlek, namn och
anteckningar (förfrågan, fel kontrollsumma, sektorer som saknas). En rad öppnar filen som en PRG på laddadressen, och +
lägger till den. **Export files to project**, **Save files…** (med `files.txt`, `paraProtectFileList`) och **Copy
list** finns som i de andra laddarflikarna. `mimir disks` räknar disken som `paraprotect`. **Analysen** känner igen
laddaren (`paraprotect` i `analyze/loaders.ts`): stubben, mottagnings- och sändslingorna (en rad som inte ligger precis
före en badline), drivens steg med egen tabell eller med DOS:ens, bootets STOP-kod och, svagt, namnet `Para-Protect` i
PETSCII.

**Sindri** (13.5f, 8.11b) lagrar nu en diskfil som KERNAL:ns seriella LOAD gör: en byte i taget, med STOP-vektorn
anropad före varje byte efter den första när filen har laddat över den med en adress i RAM. Pekaren `$AE/$AF` står i RAM
efter varje byte, anropet kommer tillbaka till `$F4FC` (en fälla där) och ingen anropas efter sista byten
(`diskLoadOn`, som `tapeLoadOn` för band). Bangkok Knights laddar då till spelet i stället för att stanna på en `JAM`.
Gammal mot ny på 200 slumpvisa skivor ur arkivet: 199 lika, och Planet Golf Extras (Triad) kommer längre (bootet startar
sig självt från STOP-vektorn).

**Kontrollen:**
- Varje förfrågan Sindri gjorde på de sju skivor som laddar klart är byte för byte de sidor läsaren ger. Ett exempel:
  Bangkok Knights 3 584, 13 312 och 35 072 byte. Buggy Boys avbild har tre sektorer med fel kontrollsumma, och spelet
  hänger i VICE också. I Sindri får driven `$C0` sidor där C64:an ber om `$CE`. Det är en kapplöpning i bootet, inte i
  Sindri: tabellen för halvbytarna ligger delvis på KERNAL:s jiffy-klocka (`$A0`–`$A1`), och kommer avbrottet mellan
  kopian och `SEI` nollas den. VICE gör likadant med starten flyttad (`-keybuf-delay 12`); se `docs/paraprotect.md`.
- VICE: Bangkok Knights visar titelskärmen med `-drive8type 1541`, men inte med 1541-II, VICE:s standard. Drivkoden kör
  `$C029` ur DOS-ROM:en, och den byten skiljer mellan ROM:arna.
- **Tester:** `packages/core/test/paraprotect.test.ts` bygger egna skivor (`test/helpers/paraprotect-disk.ts`): ett boot
  med bara stubbens och tabellens bytemönster, spår med datablock märkta med sektorns nummer, spår i Bangkok Knights
  format med ett huvud utan SYNC, D64 med felbyte. Testet prövar också laddaren i ett program. Sindris
  `test/g64.test.ts` prövar STOP-vektorn under LOAD.

Inte gjort: kontrollen som läser 18/22 efter 40/14 är inte utredd, och inte heller vad Bangkok Knights 1/0 (`CBM` och
kod) är.

### 13.5p Disk-Speed (Morse Technologys kopieringsskydd och laddare) – Elite

`readDiskSpeedDisk` (`packages/core/src/c64/diskspeed.ts`) läser Disk-Speed på en monterad disk. Analysen av bootet,
drivkoden och filerna finns i `docs/diskspeed.md`. Arkivet har fyra sådana skivor: Elite (Firebird) och Fighter Pilot
(Digital Integration) som G64, och två tyska Elite som D64 med felbyte.

- **Bootet** är katalogens första PRG (`GAME` på 14/12, laddas på `$0308` över KERNAL:ns vektorer). Det avkodas som
  det avkodar sig självt: det körs på Sindris 6510 (`Cpu`) från BSOUT:s eller IGONE:s vektor tills det anropar
  KERNAL:n (`LISTEN`). I det avkodade letas drivkommandot (`B-E 2 0 14 0`) och anropet mellan filerna
  (`LDA $BE / CMP #n / BNE / JSR adress`: Elites `JSR $033C` när två filer återstår).
- **Steg 1** är sektorn B-E pekar på, eller, utan boot, en sektor med steg 1:s kod (`85 04 A5 04 30 FC 85 C1` och
  `JSR $F934`). Den följs instruktion för instruktion (hopp inom sidan följs, grenar inte): `LDA #$80 / STA $0n` är ett
  DOS-läsjobb med spår och sektor på `$06+2n` (14/3 och 14/14), ett `JSR` inom sidan är en egen läsning av spår och
  sektor på `$06/$07` till sidan i `$31` (36/11 → `$0300`, 36/1 → `$0400`), och `JMP` ut ur sidan är steg 2:s start.
- **Nyckeln** är statusen DOS-jobben får, AND:ad: avbildens felbyte (G64:ns avkodade sektorer, en D64:s felbyte) ger
  den, `$05` för en fel kontrollsumma. Blir steg 2 då inte ett `JMP` in i sig självt (en kopia utan felen, en D64
  utan felbyte) räknas nyckeln ut ur steg 2:s första byte (`$4C`), och fliken säger det.
- **Steg 2** följs på samma sätt från sin start: `JSR` till jobbrutinen (`STA $03,X / CLI / LDA $03,X / BMI`) med X = 1
  är tabellen (jobb 4, 14/4), med X = 0 första filens sektor (jobb 3, 14/15). Steget läses ur `LDA $0D / CLC / ADC #steg /
  CMP #antal / BCC / SBC #antal / BNE / DEC $0C (eller INC) / STA $0D`: 11 sektorer vidare på ett spår om 21, spåret
  nedanför när det slår runt till 0.
- **Tabellen:** antalet filer, för varje fil laddadress, byte i sista sektorn, hela sektorer och kontrollsumma, sedan
  startadressen minus 1 (hög först) och namnen från `$60`, 16 byte var. Varje fil läses som driven läser den (en sektor
  per hel sida, en till för resten), varje byte inverterad, och kontrollsumman prövas (EOR av alla byte och summan ska
  bli 0). Filen heter som i tabellen (`FILE1.prg`), annars `file1_4000.prg`. Anteckningarna säger vilka filer den laddar
  över, var programmet startar och vilken fil bootet anropar.

Vid montering säger toasten och Explorer (*Disk*) vad som hittats, och fliken **Disk-Speed** i bottenpanelen visar bootet
(blocken, drivkommandot, anropet mellan filerna), steg 1 (DOS-läsningarna med sin status och nyckeln), steg 2 (tabellen,
steget, inverteringen, starten) och BAM:ens text. Under det en rad per fil med nummer, namn, första sektorn, antal
sektorer, var den laddar, storlek, kontrollsumma (✓/✗) och anteckningar. En rad öppnar filen som en PRG på
laddadressen, så som C64:an tar emot den, och + lägger till den. **Export files to project**, **Save files…** (med
`files.txt`, `diskSpeedFileList`) och **Copy list** finns som i de andra laddarflikarna. `mimir disks` räknar disken som
`diskspeed`. **Analysen** känner igen laddaren (`diskspeed` i `analyze/loaders.ts`) på C64:ans mottagning av en byte
och av 128 byte, tabellens mottagning, öppningen av buffert 2 och, svagt, `B-E 2 0 14 0`.

**Sindri** (13.5f, 8.11b): 1541:an avkodar bara A15 och A10-A12, så RAM och VIA:er på `$0000-$1FFF` finns också på
`$2000`, `$4000` och `$6000`. Sindri gav öppen buss där, och Elites steg 2, som anropar sig självt på `$2303` och
`$234E`, hamnade i skräp. Nu speglar Sindris drive dem, och Elite laddar till spelet (`$886F`), Fighter Pilot till
`$0C00`. Gammal mot ny på 297 slumpvisa skivor ur `Games` och `Demos`: fyra rör `$2000-$7FFF` i driven, och alla fyra
ger samma lager och samma sparade byte som förut.

**Kontrollen:**
- Elites 52 254 byte som C64:ans laddare lagrade i Sindri är i ordning och på adressen läsarens. I VICE (x64sc,
  `-drive8type 1541`, brytpunkter via fjärrmonitorn) är PATCH, OVER och FILE1 läsarens vid `$0346` och 2NDBIT och
  3RDBIT vid `$CE27`. Fighter Pilots tre filer är Sindris RAM efter laddningen. Alla kontrollsummor stämmer på alla fyra
  skivorna.
- **Tester:** `packages/core/test/diskspeed.test.ts` bygger egna skivor (`test/helpers/diskspeed-disk.ts`) med ett boot
  och drivkod av egna instruktioner med bara de idiom läsaren följer, D64 med och utan felbyte, en kopia vars kontroller
  läses rätt, en fel kontrollsumma och en fil över ett spårbyte; testet prövar också laddaren i ett program och
  `fixtures/d64/diskspeed-demo.d64` som e2e-testet monterar. Sindris `test/drive.test.ts` prövar speglingen.

Filerna är som C64:an tar emot dem. Elite krypterar 2NDBIT och 3RDBIT själv (avkodaren på `$1D22`, som OVER hoppar
till), och FILE1 flyttar sig själv (`$7596`, som PATCH anropar: `$4000-$55FF` till `$0700`, `$5600-$75FF` till
`$D000`). **Unpack** på en fil ur fliken kör därför disken från `GAME` (13.5f, *En fil som en laddare på disken laddar*)
och ger det färdiga spelet, `$0308-$FFFF` med start `$886F` och `$01 = $3C`, som Unpack på `GAME` gör, med I/O-läget
spelet startade i (8.11b): Build & Run visar då titelbilden som när spelet laddas från disken. Inte gjort: spåren 37-40 på G64:orna (brus) är inte
utredda, och inte heller om spelet kontrollerar skivan igen senare.

### 13.6 Terminal

**Terminal** i titelraden (och kommandopaletten) öppnar ett terminalfönster i mappen du arbetar i: den senast
exporterade Kick Assembler-mappen, annars projektets `source` (projektets mapp före en export, 13.10), annars mappen
där en dialog senast valde något (PRG, disk, projekt), annars hemmappen. På Windows är det PowerShell, startat med `cmd /d /c start "Mimir Studio" /D
<mapp> powershell.exe -NoLogo -NoExit -Command …`: `start` ger PowerShell en egen konsol (Windows 11 visar den i
standardterminalen), medan ett program som appen startar direkt får appens tomma standardhandtag och avslutas.
VICE:s mapp ligger först i `PATH` (så `x64sc fil.prg` fungerar), och `kickass fil.asm` kör `KickAss.jar` med den
Java som är inställd (`KICKASS_JAR`, `MIMIR_JAVA`). macOS öppnar Terminal.app i mappen, Linux `x-terminal-emulator`.
`test/terminal.test.ts` kör samma PowerShell-skript utan `-NoExit` och kontrollerar mappen, `x64sc` och att
`kickass` bygger en `.prg`.

### 13.7 VICE-snapshots (.vsf)

En VICE-snapshot öppnas som en PRG: med *Open PRG…* (dialogen visar `.prg` och `.vsf`), genom att släppa den i
fönstret eller med Shift för att lägga till den i projektet. `openC64File` i core känner igen den på huvudet
`VICE Snapshot File`, oavsett filnamn, och läser den med `parseVsf` (`packages/core/src/c64/vsf.ts`):
- **Huvud:** format, maskin (`C64` eller `C64SC`; andra maskiner avvisas) och, från VICE 3, VICE-versionen.
- **Moduler:** namn, version och storlek, där storleken räknar in modulens 22 byte långa huvud.
- **C64MEM:** CPU-portens data och riktning, sedan alla 64 KB RAM, även RAM under ROM och I/O.
- **MAINCPU:** cykelräknaren (8 byte från format 2, annars 4), sedan A, X, Y, SP, PC och status.
- En snapshot som saknar C64MEM eller har en modul som går förbi filens slut avvisas med orsaken.

**Som fil** blir RAM från `$0200` (`SNAPSHOT_LOAD`) till `$ffff` filen `<namn>.prg`. Nollsidan och stacken är
maskinens tillstånd och tas som standard inte med, så nollsidevariablerna får sina namn som vanligt.

Inställningen *VICE snapshots: include the zero page and the stack* (fliken Analysis, `Settings.snapshotZeroPage`) öppnar
RAM från `$0002` (`SNAPSHOT_ZP_LOAD`; `$00`/`$01` är CPU-porten), för kod som ligger där. En PC eller avbrottsrutin i
nollsidan eller stacken spåras då. Nollsidevariablerna blir etiketter på laddade bytes, och round-trip gäller lika väl.
Inställningen följer projektet och gäller nästa snapshot som öppnas: `prg:open` får `zeroPage`, och dra-och-släpp
läser den direkt. Ingångspunkter:
- **PC**, när den ligger i RAM (med `$01` från snapshoten).
- **Avbrottsrutinerna** som vektorerna pekar på i RAM: `$0314`/`$0318` med KERNAL inkopplad, annars `$fffe`/`$fffa`.

Ligger BASIC-raden på `$0801` med en SYS in i RAM, blir SYS-adressen programstart (8.2) som analysen spårar från.
Analysen hittar BASIC-raden också i en fil som börjar före `$0801`, men bara när dess SYS går in i samma fil. Toasten
säger vad snapshoten är, varifrån analysen spårar och programstarten.

**Mimir följer VICE:s PC.** När snapshoten är analyserad står listningen och `.asm`-källan på raden där CPU:n var när
VICE sparade snapshoten (`snapshotPc` i `lib/overview.ts`), inte vid programstarten. Markören står där, raden är i
mitten av listningen, och i `.asm` står Monacos egen markör på raden, så piltangenterna går vidare därifrån. (Monacos
markör följer listningens markör överallt, utom när den redan står på en rad med den adressen.) Så blir det också
när en snapshot läggs till ett projekt med Shift, och när ett projekt som öppnades från en snapshot öppnas igen.
- **Explorer → Program start** har en rad till: *snapshot PC* med adressen och etiketten (eller den närmaste före,
  `irq_08b7+16`). Ett klick går dit, och tipset visar registren som VICE:s monitor visar dem efter `r`.
- **Översikten (14.1b)** har korten *Snapshot screen* (VIC-II:n, se nedan) och *Snapshot PC*.
- **En PC utanför de byte som öppnades** stannar på programstarten. Det gäller en PC i KERNAL- eller BASIC-ROM, i I/O, i
  teckensets-ROM (med snapshotens `$01`) och i nollsidan eller stacken utan inställningen. Explorer och översikten
  säger var PC:n ligger.

**VIC-II:n i snapshoten.** `parseVsf` läser också VIC-II-modulen (`Snapshot.vic`): de 64 registren som de senast
skrevs (färgerna i 4 bitar, `$d011` bit 7 och `$d012` är rasteravbrottets rad), färg-RAM (1 KB), rasterraden och
cykeln, avbrottsflaggorna och rasteravbrottets rad. Layouten är den VICE:s källa skriver (`viciisc/vicii-snapshot.c`):
x64sc:s modul (`VIC-II` 1.3 i VICE 3.10, `VIC-IISC` 1.4 efter det) har modellen, registren på +1, rasterraden på +73,
avbrottsflaggorna på +78, avbrottsraden på +79 och färg-RAM 753 byte in plus storleken på ljuspennans klocka (8 byte från
snapshotformat 2, alltså +761; 4 byte före, +757). x64:s modul (maskinen `C64`, `vicii/vicii-snapshot.c`) har ingen
modell, färg-RAM på +43, rastercykel och rad på +1116, registren på +1119 och avbrottsflaggorna på +1193 (läst ur källan,
inte prövad mot en riktig x64-snapshot). En modul som är för kort ger ingen VIC.
- **Vad VIC:en visade** (`vicState` / `snapshotVicState` i `c64/vicscreen.ts`): banken (CIA 2:s `$dd00`), läget (text,
  multicolor-text, ECM, hires- och multicolor-bitmapp, ogiltigt), skärmen på eller av, 40/38 kolumner, 25/24 rader,
  scroll, skärm-, teckenset- och bitmappsadress, om tecknen kommer ur teckens-ROM:en (`$1000–$1fff` i bank 0 och 2),
  färgerna och de åtta spritarna med pekare, adress, position, färg, multicolor, expansion och prioritet.
- **Skärmen** (`vicScreen`): bilden som VICE ritar den, 384 × 272 punkter (rasterrad 16–287, displayfönstret vid x
  32–351 och rad 51–250 i 40 × 25). Teckenraderna börjar på rad `$30` + YSCROLL, rader i fönstret utanför dem visar
  tomgångsbyten (`$3fff`, `$39ff` med ECM), XSCROLL fyller vänsterkanten med bakgrundsfärg 0, de ogiltiga lägena är
  svarta, med skärmen av syns bara ramen (spritarna också dolda), ramen täcker spritarna, och mellan spritar vinner det
  lägre numret innan dess prioritetsbit tittas på. Mimir har teckens-ROM:en från VICE (Settings → Toolchain), annars
  Mimirs egna bokstäver. Bilden är av registren i ett ögonblick: en rastersplit eller spritar som används igen längre ner
  syns inte.
- **Analysen** tar det VIC:en visade som VIC-evidens (8.7), när skärmen var på och läget giltigt.

**Packad data i snapshoten.** Sindri fortsätter från snapshotens maskin (RAM, CPU, VIC-II och CIA-kretsarna) och
packar upp det som ännu var packat, till exempel ett spel bakom sin trainermeny; notisen säger var den packade datan
låg, och *Unpack* ger programmet (8.11b, *Snapshots*).

**Build & Run startar om snapshoten som den var.** Snapshoten sparas med filen (`LoadedFile.vsf`, i projektfilen som
base64 under `files[].vsf`). Build & Run bygger och verifierar som vanligt. Sedan lägger det de byggda PRG-filerna i
snapshotens RAM (`patchSnapshot`: C64MEM-modulens 64 KB, i projektets ordning, ingenting efter `$ffff`) och skriver
`<namn>.vsf` i en byggmapp. VICE startas med `-autostart <namn>.vsf` (och etiketterna med `-moncommands`). VICE läser in
snapshoten och återställer allt som det var när den togs: CPU:ns register och stack, `$00/$01`, VIC (med färg-RAM), SID,
CIA-timrarna och avbrotten, nollsidan och diskenheterna. Sedan fortsätter programmet från snapshotens PC.

- Programstarten används inte för körningen, bara av analysen. Explorer säger det (*VICE restarts the snapshot as it was
  taken (PC $08c7, $01 = $37)*), och Build & Run-knappens tips likaså.
- Toasten och byggloggen säger var snapshoten fortsätter.
- Är programmet oförändrat (det byggda är byte-identiskt) får VICE exakt den snapshot som öppnades.
- Det gäller bara projekt med en snapshot. Andra program körs som förut (RUN, `sys` eller monitorn, 13.2).
- En fil som ser ut som en snapshot som öppnades innan snapshots sparades (från `$0200` eller `$0002` till `$ffff`, utan
  `vsf`) körs som förut, med en varning om att öppna `.vsf`-filen igen.
- Förut laddades RAM-et från monitorn och programmet startades vid programstarten. Det kraschade, eftersom CPU:n, `$01`
  och I/O-kretsarna inte återställdes och byten för `$d000–$dfff` hamnade i I/O-registren.

**Test:** `fixtures/vsf/raster-demo.vsf` är en snapshot från x64sc 3.10 av demon, stoppad i dess raster-IRQ
(`make-raster-demo.mon` beskriver hur den gjordes). `test/vsf.test.ts` läser den, och projektet från `$0200`
verifieras byte för byte (också med riktiga KickAss.jar). Testet täcker även äldre format, KERNAL urkopplad, andra
maskiner och trasiga filer. E2e-testet öppnar snapshoten via dialogen och verifierar med `F7`. Före det kontrollerar
det att listningens markör står på `$08c7`, att Monacos markör står på samma rad i `.asm` och att Explorers rad
*snapshot PC* går dit. `overview.test.ts` testar `snapshotPc` med en PC i RAM, i KERNAL-ROM och i stacken, och
stacken med inställningen på också.
`patchSnapshot` testas så: det byggda programmet ger samma snapshot, och ändrade byte hamnar bara i C64MEM:s RAM.
`vice.integration.test.ts` startar riktiga x64sc med snapshoten, där programmet vid PC `$08c7` har bytts mot kod som
gör ramen och bakgrunden röda. VICE:s skärmbild visar att det fortsätter där. Ett e2e-test kör Build & Run med ett
program som ersätter VICE och kontrollerar att snapshoten VICE får är den som öppnades.

VIC-II:n testas i `vicscreen.test.ts`: `fixtures/vsf/vic-sprites.vsf` (multicolor-text, eget teckenset, 38 × 24, scroll,
alla åtta spritarna) och `vic-bitmap.vsf` (multicolor-bitmapp i bank 1) ritas och ska vara lika VICE:s egna skärmbilder
från samma ögonblick (`vic-*.bmp`) punkt för punkt; modulens båda layouter, lägena och vad analysen tar testas också.
Sju scener till ur `make-vic.asm` (ECM med ROM-tecken, hires-bitmapp i bank 3, skärmen av, ogiltigt läge, bank 2 med
ROM-tecken, YSCROLL 7 och 0 med tomgångsbyten, en sprite vid x 500 och prioritetsfallet) stämde också på punkten när
det byggdes. Mätt 2026-11-20 på 37 snapshots som x64sc 3.10 tog efter 12 s (warp) av CSDB:s enfilsdemos och spel
(topp 200): 8 ritas exakt som VICE visade dem; i de andra ändrar programmet VIC:en under bilden (färgbyten per rad,
multiplexade spritar, öppna ramar, ett annat teckenset för en scrolltext) eller skärmen mellan bilden och snapshoten,
och det som skiljer är just det. Analysen fick fler grafikblock i 26 av 38 (152 → 197, 282 → 369 KB): skärmar på
`$0400`, bitmappar som koden räknar ut `$d018` för, teckenset och spritar som bara VIC:en visste var de låg.
`overview.test.ts` testar kortets texter och e2e-testet för översikten kortet med bilden och länken till teckensetet.

### 13.7b VICE:s quicksave-snapshot

I VICE 3.x sparar Snapshot → Quicksave snapshot (**Alt+F11**) maskinens tillstånd i `<maskin>.vsf` i VICE:s
inställningsmapp: `%APPDATA%\vice\C64SC.vsf` för x64sc (`C64.vsf` för x64), `$XDG_CONFIG_HOME/vice` eller
`~/.config/vice` på andra system. Inställningen *VICE quicksave snapshot* (13.1) pekar ut en annan fil. Tom betyder de två
filerna i VICE:s mapp, och den nyaste av dem gäller (`electron/main/quicksave.ts`).

- **Explorer** har en egen sektion, *VICE quicksave*. Den förklarar att Alt+F11 i VICE tar över den körande C64:an, och
  statusraden visar när den senaste sparades (`vice:quicksave-info`, utan att läsa filen) eller att det inte finns någon
  ännu. Där finns också knappen *Open the latest quicksave* (F9) och kryssrutan *Open new quicksaves automatically*.
- **Varje ny quicksave öppnas av sig själv.** Main-processen bevakar filerna genom att polla (`fs.watchFile`, 750 ms), så det
  fungerar även när mappen inte finns ännu. En ny ändringstid, när filen varit stilla en kvarts sekund, skickas som
  `vice:quicksaved` till fönstret. Där öppnas snapshoten när *Open each new one* (Explorer, `followQuicksave`, på som
  standard) är ikryssad, och statusraden uppdateras. Annars säger en toast att F9 öppnar den. En quicksave som finns när appen startar öppnas inte.
- **F9** (Explorer: *VICE quicksave*, kommandopaletten) öppnar den nyaste via `vice:quicksave`. Main läser filen från
  inställningen, aldrig från en sökväg som renderern skickar. Finns ingen säger toasten var VICE skriver den.
- **Öppningen är som Open PRG… på en .vsf (13.7):** RAM från `$0200` (eller `$0002`), ingångspunkterna och programstarten.
  Filen heter `quicksave.prg` och toasten säger när den sparades. Ett snapshot som VICE fortfarande skriver läses igen
  strax efter.
- **Ångringsbar:** det nya projektet är ett steg i historiken (`commitReplace`), så Ctrl+Z tar tillbaka projektet som var
  öppet innan och Ctrl+Y quicksaven igen. Andra filer man öppnar börjar fortfarande med en ny historik.
- **De 5 nyaste sparas** (`QuicksaveHistory`), eftersom VICE skriver varje quicksave över den förra.
  - **Var:** varje ny kopieras till appens egen mapp, `<userData>/quicksaves/<id>.vsf`, med `index.json` för namn,
    tid och storlek. Kopian görs innan fönstret får `vice:quicksaved`. Den quicksave som finns när appen startar
    kommer också med, liksom den i en fil som just valts i inställningarna.
  - **Vad som tas med:** samma sparning (samma ändringstid) tas bara med en gång. En fil som ännu inte är en hel
    snapshot läses igen strax efter och hoppas annars över.
  - **Den sjätte:** när en sjätte kommer tas den äldsta bort, med sin fil. Favoriterna räknas inte.
  - **Favoriter:** stjärnan på en rad gör den till favorit (`favourite` i `index.json`). En favorit tas aldrig bort när
    VICE sparar nya, och de 5 nyaste räknas bland de andra. Tar man bort stjärnan blir den en av de andra igen. Den finns
    kvar tills VICE sparar nästa quicksave, och tas då bort om den inte är bland de 5 nyaste. Toasten säger det.
  - **Namn:** en quicksave heter först `quicksave 2026-10-29 12:43:30`, alltså när VICE sparade den.
  - **I Explorer** listar *VICE quicksave* dem under knappen, den nyaste först, med namn och tid. Favoriterna står i en
    egen lista, *Favourites, always kept*, över de nyaste:
    - ett klick på namnet öppnar den som ett nytt projekt, som F9 (Ctrl+Z går tillbaka). Filen heter som namnet;
    - stjärnan gör den till favorit, eller tar bort den ur favoriterna (fylld och guld för en favorit);
    - pennan byter namnet (Enter behåller det nya, Esc inte);
    - pilen sparar en kopia i en mapp man väljer i en spara-dialog, som `<namn>.vsf`. Tecken som Windows inte tillåter
      i filnamn blir `-`, och dialogen öppnas i den mapp en quicksave sparades i senast.
  - Listan finns kvar när appen startas om.

**Test:** `apps/desktop/test/main.test.ts` täcker mapparna per system, den nyaste filen, en fil som saknas och en som inte
är en snapshot, bevakaren (en rapport per ny fil) och de sparade: fem kvar med den äldstas fil borttagen, samma sparning
en gång, namn som finns kvar efter omstart, en halvskriven fil som inte tas med, och id som inte går att använda som
sökväg. Favoriterna testas för sig: en favorit finns kvar efter sju nyare och efter omstart. Utan stjärna finns den kvar
tills nästa sparning och tas då bort, och en nyare utan stjärna stannar bland de 5. E2e-testet pekar inställningen på en fil i testets egen mapp (testmiljöns `settings.json` gör det redan, så
användarens VICE-mapp läses aldrig) och kopierar dit `fixtures/vsf/raster-demo.vsf` från x64sc 3.10. Den öppnas av sig
själv, Ctrl+Z och Ctrl+Y växlar projekt, och med *Open each new one* urkryssad meddelas en ny quicksave och F9 öppnar den.
Båda finns sedan i listan. Den nyaste döps till *intro* och sparas som `intro.vsf` med samma bytes, och den äldre öppnas
med ett klick. Stjärnan flyttar *intro* till favoritlistan, över de nyaste, där den öppnas. Tas stjärnan bort kommer den
tillbaka bland de nyaste.

### 13.8 Packa med Brokkr eller Exomizer

Vyn **Pack** i aktivitetsraden (ikonen med en låda, kommandopaletten *Show the Pack view*) packar PRG:n som Build & Run
bygger. Överst väljs packaren: **Brokkr**, Mimirs egen packare (`packages/brokkr`, standard), eller **Exomizer** 3
(verktygsinställningen, 13.1). Vyn ligger i sidopanelen, så listningen bredvid visar blocken som väljs. Inställningarna
sparas i projektet (`Project.pack`, `PackPrefs`), och varje ändring kan ångras. En projektfil från före Brokkr har ingen
packare; den packar med Brokkr (`packer`, `effort` och `format` får sina standardvärden i zod-schemat).

**Vyn** visar bara de inställningar som gäller för vald packare, format, sorts fil och start (`packOptions` i
`packages/core/src/pack.ts`). Efter packaren kommer korten *What to pack*; *Packed file* (sorten *Self-extracting* eller
*Crunched data*, för Brokkr *Format* med en rad om vad formatet ger och kostar och *Effort*, för Exomizer *Crunch faster
(-C)* och *More options*, sist *File name* och *Folder*); *Self-extracting* (*Start*, *Jump to*, *$01 after* och *Interrupts after* på en
rad, effekten) eller *Crunched data* (*Load address*, *Crunch forward*, *No literal sequences* och en rad om vilken
uppackare som läser datan); och *Command*. En dold inställning finns kvar i projektet men ändrar ingenting:
`packEffective` sätter den till sitt standardvärde innan kommandot skrivs och filen packas, och resultatkortet blir inte
*Out of date* av den.

| Inställning | Brokkr | Exomizer |
|---|---|---|
| *Format*, *Effort* | alltid | – |
| *Crunch faster (-C)*, *More options* | – | alltid |
| *Start*, *Interrupts after* | sfx | sfx |
| *Jump to* | sfx med hopp | sfx med hopp |
| *$01 after* | sfx utom RUN (som behöver `$37`) | sfx utom RUN |
| Effekt | sfx utom *Brokkr fast*: kryssrutan *Flash the border while decrunching* | sfx: listan *Decrunch effect* |
| *Load address* | mem | mem |
| *Crunch forward*, *No literal sequences* | mem i Exomizers format (`-f`, `-T 5`) | mem (`-f`, `-c`) |

*No literal sequences* gäller bara packad data, för äldre uppackare: en självuppackande fil har sin egen uppackare, som
läser literal sequences, och Brokkr prövar där strömmen både med och utan dem. Brokkrs egna format packas bara bakåt
och läses bara av Brokkrs uppackare, så där döljs båda kryssrutorna.

**Brokkr** skriver Exomizer 3:s strömformat (protokoll 39, som Exomizers egna uppackare läser) med egen kod: matchsökning
med ett binärträd, en optimal parsning som håller flera vägar till varje position (en per tillstånd och offset som kan
återanvändas), tabellerna optimerade mot parsningen tills strömmen slutar krympa, och en egen 6502-uppackare. På 163
uppackade demos, spel och intron blir strömmarna mindre än Exomizer 3.1.1:s på normal nivå, och packningen går flera
gånger fortare (siffrorna i Brokkrs README). Nivåer (`PackPrefs.effort`): *Fast*, *Normal* och *Max*, som söker vidare
från flera starter och prövar varje tabellfack en bit bredare och smalare, på alla kärnor utom en.

**Format** (`PackPrefs.format`, bara för Brokkr): *Exomizer 3* (standard), *Brokkr's own*, Brokkrs eget format för
största möjliga packning, eller *Brokkr fast*, dess snabba format för snabbast möjliga uppackning (nedan). Det kodar samma slags LZ-tokens med en binär aritmetisk kodare vars sannolikheter anpassar
sig efter varje bit, som LZMA: bokstäver i ett 8-bitars träd, längder med en sammanflätad gammakod, offset med längd i
bitar (i sammanhang av matchens längd) och därefter bitarna, och "samma offset igen" efter en literal. Den första
literalen efter en match kodas mot matchbyten (byten vid senaste offset, som den sällan är), som LZMA:s matched literal
men med 16 sannolikheter. Parsningen prissätter tokens efter vad kodaren tar block för block. På de 163 programmen
blir strömmarna 8,0 % mindre än Exomizer 3.1.1:s (mindre på 154), men som självuppackande fil tar uppackningen i median
9 gånger så lång tid som i Exomizers format (upp till 35 för data som knappt packas; varje bit kostar en
multiplikation), och uppackaren behöver mer minne: 512 byte sannolikheter, 1 KB kvadrattabeller när det finns plats (en
tredjedel snabbare; annars multiplicerar den med skift och addition) och en resident del på omkring 470 byte i stället
för 200. För små program är Exomizers format därför mindre som självuppackande fil (på 154 program blev filerna 5,6 %
mindre än Exomizer 3.1.1:s sammanlagt, mindre på 118); där programmet inte lämnar plats blir filen i Exomizers format,
med en notis.
`--format brokkr` står då i kommandot, *Crunched data* packas bara bakåt (*Crunch forward* och *No literal sequences*
döljs), och uppackaren för egen kod skrivs med `brokkr decruncher --format brokkr`.

*Brokkr fast* består bara av hela byte, så uppackaren läser inga bitar: en literalkörning på upp till 32 byte, en match
på 2–3 byte upp till 16 bakåt i en byte, en på 2–8 byte upp till 4096 bakåt i två, vilken match som helst i tre, och
"samma offset igen" i en; ett fullt längdfält tar en byte till, upp till 255. Uppackaren håller skrivpositionen i Y och
kopierar varje byte med `dey`, `lda`, `sta`, `dex` och `bne`; den är 215 byte (229 med RUN), utan tabeller, och ryms
i stackens sida. På de 163 programmen blir strömmarna 13,2 % större än Exomizer 3.1.1:s; som självuppackande filer (159
program) 12,5 % större än i Exomizers format, men uppackningen tar 0,56 av tiden sammanlagt (hälften på
medianprogrammet, 0,4 som bäst). Den blinkar inte med kanten (effekten döljs). `--format fast` står i kommandot, och
uppackaren för egen kod skrivs med `brokkr decruncher --format fast`. Ett första försök med bitar i ZX0:s stil blev bara
1,27 gånger så snabbt och lämnades.

*Auto — the smallest* (`PackFormat` `'auto'`, bara för *Self-extracting*) packar i alla tre formaten och behåller den
minsta filen; med *At most, seconds to decrunch* (`PackPrefs.maxSeconds`, uppackningstid på en PAL-C64; tomt: vilken
tid som helst) den minsta av dem som packas upp inom den tiden, och hinner inget det den snabbaste, med en notis. Kommandot
får `--format auto` och `--max-seconds`, och kortet räknar upp vad varje format gav (storlek och tid) och vilket som togs.
För *Crunched data* finns inte *Auto*: där packas det i Exomizers format, eftersom uppackaren hör till ett format. En fil
som tar mer än 10 s att packa upp får en notis. Uppmätt på korpusen (154 program, mest demos och spel på 20–60 KB)
packas Exomizers format upp på 3,3 s (median; högst 6,9 s), Brokkrs eget på 28 s (upp till två minuter) och det snabba
på 1,6 s; *Auto* utan tidsgräns blir 3,7 % mindre än Exomizers format, med 10 s ungefär lika stor.

- *Decruncher's memory* (Brokkr, *Self-extracting*; för *Crunched data*, se nedan): var uppackaren arbetar medan den packar upp. *Decruncher at*,
  *Tables at* och *Zero page at* (`PackPrefs.decruncherAt`, `tablesAt`, `zp`) är menyer: *Auto* (där Brokkr hittar
  plats), platser som passar (`MEMORY_PLACES`: stackens sida, bandbufferten, BASIC:s inmatningsbuffert, fritt RAM vid
  `$c000`, skärmen; `ZP_PLACES`: nollsidans platser Brokkr själv provar, med vad C64:an annars har där) och *An address
  of your own…*, som visar ett fält för adressen. Under varje står hur många byte delen tar med formatet och starten
  (`packNeeds`, från Brokkrs `decruncherNeeds`, utan att något packas: minst och mest) och var den då slutar, eller vad
  som är fel: att den inte ryms på den valda platsen, går förbi `$ffff` (`$ff`), eller att tabellerna ligger över
  uppackaren. *Keep free* säger hur många byte den håller fria. De blir
  `--at`, `--table` och `--zp`, och *Keep free* (`PackPrefs.keep`, intervall som `$c000-$cfff, $0334-$03ff`, ett
  felskrivet sägs under fältet) blir `--keep`: minne som uppackaren, dess tabeller, nollsidebytes och den packade datan
  håller sig borta från. Står något i vägen för en angiven plats säger Brokkr vad (`BRK-E155`). En projektfil från före
  dem har inga: Brokkr placerar allt.
- *Self-extracting*: Brokkr planerar var uppackarens två delar, dess tabell, nollsidebytes och den packade datan ska ligga
  (helst stackens sida `$0100-$01e7` och `$0334-$03ff`, så att inget syns på skärmen), så att uppackaren aldrig skriver över
  byte den inte läst, och väljer `$01` medan den packar upp så att allt den läser och skriver är RAM (`$34` när data
  ligger under I/O; då blinkar inte kanten). Strömmen ligger i filen där den packas upp ifrån, så när som på de första
  byten, som filen har efter den och startkoden kopierar ned över BASIC-raden; uppackaren kopieras till sin plats med
  nollsidan den börjar med före sig, och `$01` lämnas som BASIC har det när det ska vara `$37` hela tiden. Bara ett
  program som inte lämnar plats för det får strömmen flyttad. Filen körs sedan i Brokkrs emulerade C64 från SYS-raden
  tills programmet startar, från RAM fullt av brus som en C64:as, och minnet jämförs med det som packades; filen får
  inte heller ha skrivit något annat än programmet, strömmen, uppackaren, dess tabeller, dess nollsida och stackens
  topp (så hålls *Keep free* också). Kontrollen syns som *Decrunched in Brokkr's emulated C64: … has the same … bytes,
  and it starts at $….* (testerna kör också filerna i riktiga VICE). Fallerar en kontroll ligger programmet, filen
  Brokkr gjorde och den emulerade C64:ans minne i packmappen (`brokkr-check-file.prg`, `brokkr-check-memory.bin`), för
  en felrapport.
- *Crunched data*: Exomizers mem-format (`-T4` som standard, för `exodecrunch.s`), eller Brokkrs egna. Med *Write the
  decruncher too* (`PackPrefs.decruncher`, på som standard; inte med *Crunch forward*, för uppackaren läser bakåt)
  skrivs Brokkrs uppackare bredvid: `<namn>-decrunch.prg`, assemblerad vid *Decruncher at* (`$c000` på *Auto*), att
  ladda och anropa, och `<namn>-decrunch.asm`, samma uppackare som Kick Assembler-källa att #importa, med nollsidan,
  tabellerna och adressen som konstanter överst (utan `* =` på *Auto*: den hamnar där den importeras) och de packade
  filerna uppräknade med var de laddas. *Decruncher's memory* visar då *Decruncher at*, *Tables at* och *Zero page at*
  med uppackarens egna platser på *Auto* (tabellerna i Exomizers format vid `$0334`, i Brokkrs eget på sidan efter
  uppackaren; nollsidan sist, upp till `$ff`) och exakt hur många byte varje del tar, men inte *Keep free*. Varje packad
  fil körs genom PRG:n i Brokkrs emulerade C64 med `$01` satt så att allt är RAM (`checkDecruncher`), och kortet säger
  *Decrunched by <namn>-decrunch.prg in Brokkr's emulated C64: … has the same … bytes* (och vilket `$01` det kräver när
  det inte är `$37`); en fil som laddas eller packas upp över uppackaren, dess tabeller eller nollsida sägs i stället.
  Utan uppackaren packas strömmen upp igen och jämförs, och kortet säger var den laddas för uppackning på plats.
  *A file for each block* / *A file for each PRG* (`PackPrefs.split`, när det finns mer än en del: valda intervall
  eller byggda PRG:er) packar varje del i en egen fil, `<namn>-<startadress>.prg`, med en uppackare för alla; kommandot
  har då ett `brokkr mem` per fil och två `brokkr decruncher`. Kortet räknar upp varje fil, med var den laddas och vad
  `stream` ska sättas till, och var och en kan sparas för sig (*Save … as…*). Allt skrivs i packmappen och i mappen som
  *Folder* anger.
- Effekt: kantblink eller inget (`--no-effect`). Uppackaren skriver varje literal till `$d020`; i VICE syns det som
  ränder i kanten medan filen packas upp. Kanten blinkar inte när I/O är bortkopplat under uppackningen, och inte i det
  snabba formatet (där döljs kryssrutan). `$01` och avbrott efter uppackningen som för Exomizer; med RUN är `$01` alltid
  `$37`.
- *No literal sequences* (bara *Crunched data* i Exomizers format) blir `-T 5`: inga literal sequences, och fortfarande
  inga av de längder `exodecrunch.s` tar fel på.

Huvudprocessen kör Brokkr i en arbetstråd (`electron/main/brokkr-worker.ts`, en egen ingång i electron-vite som blir
`out/main/brokkr-worker.js`), så att fönstret svarar medan den packar; på nivån *Max* startar tråden fler trådar som kör
samma fil (`workerData.brokkr`). Resultatet har samma form som en Exomizer-körning (`ExomizerReport`: minneslayout,
`$01` och avbrott före, under och efter, kontrollen), så kortet visar båda på samma sätt. Pack-mappen får indatafilerna
och den packade filen. Kommandot vyn visar är den fristående Brokkrs (`brokkr sfx --start sys -o x-brokkr.prg x.prg`,
`brokkrArgs`), som gör samma fil i pack-mappen; standardnamnet är `<fil>-brokkr.prg`.

**Exomizer** packar som förut:

**Vad som packas:**
- *Whole build*: de byggda PRG:erna hela. Flera filer packas ihop till en. *Pack from* (`PackPrefs.from`, tomt: allt)
  lämnar bort byten före en adress, så att uppackaren får plats under programmet: en snapshots RAM från $0200 fyller
  minnet där den arbetar, och då finns ingen plats i något format. Fältet säger vad som lämnas bort (*Leaves out
  $0200–$07ff (1536 bytes)*: programmet hittar där vad uppackaren lämnade); ett bygge som börjar under $0400 får en
  notis med knappen *Pack from $0800* (därifrån finns oftast plats), och när Brokkr inte hittar plats för ett bygge som
  börjar under $0800 (BRK-E120, -E140, -E150) säger felet det och har samma knapp. Kommandot packar då en del av filen
  (`raster-demo.prg,$0800,1536,63488`), och vyn varnar när starten, SYS-raden eller BASIC-programmet för RUN lämnas
  bort. *Chosen blocks* packas som de är. Brokkr läser SYS-raden på $0801 också i ett program som börjar under den.
- *Chosen blocks*: adressintervall (`PackPrefs.ranges`, sorterade, utan överlapp). Vyn listar blocken med en kryssruta
  var: ikryssad när blocket är helt med, halvt när en del är med. *Selection* lägger till markeringen i listningen och
  *Block at the cursor* blocket där markören står. I listningens högerklicksmeny under *Program* finns *Pack block/selection with
  Exomizer* och *Leave block/selection out of the pack*. Intervallen visas som chips med ett × som tar bort dem.

**Den packade filen:**
- *Self-extracting* (`exomizer sfx`): ett program som packar upp sig själv och startar. Det startar genom SYS-raden i
  BASIC-raden (`sys`), med RUN (`basic`) eller med ett hopp till en adress (`$xxxx`, förvalt programstarten). Vyn varnar
  när de valda blocken lämnar ut BASIC-raden och starten är `sys`. Övriga val:
  - Effekt: Exomizers egen, ingen (`-n`) eller kantblink (`-x1`–`-x3`).
  - `$01` efter uppackningen: `-Di_ram_exit` (inte med RUN).
  - Avbrott efter uppackningen: `-Di_irq_exit`.
- *Crunched data* (`exomizer mem`): packad data som programmets egen kod packar upp med Exomizers `exodecrunch.s`.
  Laddadressen är för uppackning på plats (standard), en vald adress (`-l $xxxx`) eller ingen (`-l none`, en `.bin`).
  `-f` packar framlänges och `-c` (*No literal sequences*) utan literal sequences, för äldre uppackare.
- För båda: `-C` (snabbare packning), fler flaggor som text (*More options*, där också `-c` kan stå för en sfx) och
  filnamnet (standard `<fil>-exo.prg`).

Vyn visar exakt det kommando som körs (`packCommand` i `src/lib/pack.ts`, `packArgs` i `packages/core/src/pack.ts`,
med de inställningar som gäller).
En del av en PRG anges som Exomizer läser den, `fil.prg,$adress,offset,längd`. Offset räknas efter laddadressen.
Exomizer laddar delarna i tur och ordning (en senare vinner) och nollfyller luckor mellan dem.

**Pack** bygger och verifierar först som Build & Run (12; KickAss.jar när den finns, annars den inbyggda assemblern) och
skickar sedan de byggda PRG:erna till `toolchain:pack`. Main-processen skriver dem i en egen packmapp, kör Exomizer med en
argumentlista (aldrig genom ett skal), läser filen den skrev och tillåter mappen för sessionen. De fria flaggorna får
inte innehålla sökvägar, `-o` eller `--` (`extraProblem`, även i zod-schemat), eftersom filerna kommer från det som
valts.

**Medan den packar** visar vyn det tydligt (`PackingCard` i `Pack.tsx`, `packRun` i `App.tsx`): knappen blir *Packing…*
med en snurra och går inte att trycka, och i stället för resultatkortet står ett kort med en rörlig rand överst, rubriken
(*Building and verifying…*, sedan *Packing with Brokkr…* eller *…Exomizer…*), tiden sedan Pack trycktes (räknas varje
sekund) och stegen: *Build and verify the program*, sedan *Crunch and check with …* med format, nivå och kontroll
(Brokkrs emulerade C64, desfx, eller strömmen packas upp igen). Kortet rullas fram i sidopanelen när packningen börjar,
eftersom knappen ligger långt ner, och det nya resultatkortet rullas fram när den är klar. Pack-knappen i aktivitetsraden
får en snurra (`aria-busy`) så att det syns från andra vyer. Med *reduced motion* snurrar det långsammare.

Resultatkortet visar:
- storlek före och efter, med procent;
- Exomizers minneslayout (packad data, uppackad data, uppackningstabell, packaren och dess nollsidebytes);
- `$01` och avbrott efter uppackningen;
- *Out of date* när programmet eller inställningarna ändrats sedan.

Knapparna är *Run in VICE* (med byggets etiketter och den monterade disken), *Save as…* (`file:save`, en
spara-dialog) och *Output*. Byggutdata visar båda kommandona och deras utskrift.

**Mapp för den packade filen** (*Folder* under *File name*, `PackPrefs.dir`, sparas i projektet). Utan mapp ligger filen
bara i appens pack-mapp, och *Save as…* kopierar den. *Choose…* öppnar en mappdialog (`pack:folder` med `ask`), och
*Clear* tar bort mappen. Sökvägen visas hel och radbryts, så att slutet syns. Med en mapp skriver huvudprocessen den
packade filen också dit varje gång den packar (`keepPacked` i `electron/main/toolchain.ts`) och skriver över den som
fanns. Resultatets `path` pekar dit, så *Run in VICE* kör den filen, och kortet säger *Written to <mapp>*.
Pack-mappen behåller sin kopia och indatafilerna, så kommandot som visas fungerar där som förut.

Huvudprocessen skriver bara i mappar som valts i en dialog under sessionen (4.2). En mapp som kommer från en projektfil
öppnad i en ny session får därför väljas igen. När Pack trycks frågar appen först `pack:folder` utan `ask`, och dialogen
öppnas i den sparade mappen; avbryts den packas ingenting. Ligger mappen inne i en exporterad mapp som bevakas, rapporteras
den packade filen inte som ändrad utanför appen (`ExportWatcher.wrote`).

**Kontroll.** En sfx-fil packas upp med Exomizers `desfx`, som kör uppackaren i Exomizers egen 6502-emulator och
skriver det största området den skrev. `checkDecrunched` jämför det med minnet som packades och startadressen med den
Exomizer rapporterade. Resultatet är *same*, *differs* (första avvikande byte) eller *unchecked*. Det sista gäller när
desfx behåller ett annat område, vilket för så få bytes att packarens egen kopia vid `$00fd` är större. En mem-fil
kontrolleras inte, eftersom den packas upp av programmets egen kod.

**Exomizer** är en verktygsinställning (13.1). Installationen har med Exomizer 3.1.1 oförändrad i
`resources\exomizer\` med dess licenstext (`apps/desktop/vendor/exomizer`; licensen tillåter fri spridning för icke
kommersiellt bruk). I ett utvecklingsbygge används den som hittas i `C:\C64` (också `win32\` i en uppackad release),
`EXOMIZER` eller `PATH`. En inställning som pekar på en fil som inte längre finns ersätts med den medföljande, och en
tom inställning behålls.

**Test:**
- `packages/core/test/pack.test.ts`:
  - intervallen, kommandoraden, Exomizers utskrift och jämförelsen;
  - vilka inställningar som gäller för varje packare, format och sorts fil (`packOptions`), och att de andra får sina
    standardvärden (`packEffective`) och inte når kommandot;
  - riktiga Exomizer på demon (hela, intervall med hopp, mem, fel), där desfx ska ge samma bytes;
  - riktiga VICE (`-console`, egen konfigurationsfil): det packade programmet räknar en xor över sina 4 KB data
    efter uppackningen och avslutar VICE med den genom debug-cartridgen. Det körs via SYS-raden och med valda block
    plus hopp, `$01 = $35` och avbrott av.
- `apps/desktop/test/main.test.ts`: inställningen, schemat och en packning med den medföljande Exomizer.
- E2e-testet packar demon hel och med valda block (meny, markering och kryssrutor), sparar filen och ångrar.

**Test av Brokkr:**
- `packages/brokkr/test`: strömmen för alla protokoll, Exomizers `raw -d` packar upp Brokkrs strömmar och Exomizers
  `desfx` en Brokkr-sfx, Kick Assembler assemblerar uppackarens källa till samma byte som Brokkrs assembler, mem-filer
  packas upp av Brokkrs uppackare i den emulerade C64:an, VICE:s c1541 läser D64:or Brokkr skrivit, och trådpoolen ger
  samma resultat som en tråd.
- `packages/brokkr/test/fast.test.ts`: det snabba formatet packar upp till samma data (alla tokens, längder över 255,
  offset upp till 65535), dess 6502-uppackare packar upp mem-filer på färre än tre fjärdedelar av cyklerna Exomizers
  format tar, och självuppackande filer (SYS och RUN) har uppackaren i stackens sida och går fortare.
- `packages/brokkr/test/brk.test.ts`: Brokkrs eget format packar upp till samma data (alla längder och offset), mem-filer
  packas upp av dess 6502-uppackare (båda multiplikationerna) i den emulerade C64:an, självuppackande filer startar
  programmet och faller tillbaka till Exomizers format utan plats; Kick Assembler assemblerar dess källa till samma byte.
- `packages/core/test/brokkr.test.ts`: demon hel och med intervall och hopp, mem, felen, nivån *Max* på två trådar,
  Brokkrs eget format (mindre fil, samma fil som kommandot), det snabba formatet (uppackaren i stackens sida, samma fil
  som kommandot), att kommandot som visas gör samma fil med den fristående Brokkr (också mem med `-T 5`), och att dolda
  inställningar inte når kommandot eller filen (`-T` i en sfx, `$01` med RUN, effekten i det snabba formatet, framlänges i
  Brokkrs eget format).
- `apps/desktop/test/main.test.ts`: pack-mappen med indata och den packade filen, filen också i den valda mappen
  (`keepPacked`, inte när packningen misslyckas), och schemat (en gammal projektfil packar med Brokkr, i Exomizers
  format, utan mapp).
- E2e-testet packar demon med Brokkr (hel, *Max*, mem med `-T 5`, eget format, snabbt format) i den byggda appen, alltså
  med arbetstråden; medan den packar på nivån *Max* syns kortet *Packing* med stegen, knappen *Packing…* och snurran på
  aktivitetsknappen, och alla tre försvinner när den är klar. Testet kontrollerar också att vyn bara visar det som gäller: inget `$01` med RUN, kantblinket av och på, ingen
  start eller effekt för packad data, inga *Crunch forward* och *No literal sequences* i Brokkrs eget format och ingen
  effekt i det snabba. Sist väljs en mapp med en stubbad dialog, filen hamnar där (kortet säger *Written to*, toasten ger
  sökvägen) och *Clear* tar bort mappen igen.

### 13.8b Packa en fil utan projekt

**Pack a file…** på startskärmen (13.10) packar en fil med Brokkr eller Exomizer som den är, utan projekt och utan
analys. Till vänster väljs vad som packas: **PRG files…** (en eller flera, packade tillsammans till en fil; en senare
vinner där de överlappar) eller **Kick Assembler source…** (en `.asm`). En källa assembleras med KickAss.jar där den
ligger, som dess egen `build.bat` skulle göra (`out\<namn>.prg` i dess mapp), när den väljs och igen före varje
packning, så att en ändrad källa packas som den är nu; gick det inte står Kick Assemblers fel under filen. Filnamn med
mellanslag och bokstäver från alla språk går bra (`assertEntryName` tar inte ett namn som börjar med `-` eller `.`, eller
ett med en mapp i). **Whole file** packar filerna hela, **Address ranges** bara de intervall som skrivs
(`$0801-$1fff, $c000-$cfff`).

Till höger är Pack-vyns inställningar (`PackerChoice` och `PackSettings` i `Pack.tsx`, samma komponenter): packare,
självuppackande eller packad data, format, start, `$01` och avbrott efter, avpackarens minne, kommandot och resultatet
med **Run in VICE** och **Save as…**. Utan analys läses BASIC-raden med `parseBasic` direkt ur en PRG som laddar på
`$0801`: har den en SYS startar programmet där (**SYS in the BASIC line**), annars hoppar det till laddadressen. Den
packade filen hamnar bredvid det som packades, om inte **Choose…** väljer en annan mapp. Inställningarna sparas i
fönstret (`kr.quickPack`) till nästa gång; mapp, filnamn, intervall och start följer de filer som väljs. **Start** går
tillbaka till startskärmen. Smart attach (13.4b) öppnar samma vy över arbetet med en `.asm` redan vald och Brokkr som
packare; där går knappen tillbaka till arbetet.

**Test:** `e2e/quickpack.spec.ts`: en kopia av `raster-demo.prg` packas med Brokkr (*SYS 2064*, start *sys*, mappen
bredvid), filen `raster-demo-brokkr.prg` blir mindre och laddar på `$0801`; *Address ranges* föreslår filens intervall
och *Start* går tillbaka. Med KickAss.jar assembleras `my border.asm` (mellanslag i namnet) till `out\my border.prg` och
packas, och en källa med fel visar Kick Assemblers *Unknown symbol*. `test/main.test.ts` prövar filnamnen.

### 13.9 Cartridges (.crt)

En cartridge-avbild öppnas som en PRG: med *Open PRG…* (dialogen visar `.prg`, `.vsf` och `.crt`), genom att släppa den
i fönstret eller med `mimir analyse|verify|export <fil.crt>`. Den känns igen på huvudet (`isCrt`), oavsett filnamn, och
läses med `parseCrt` (`packages/core/src/c64/crt.ts`), VICE:s format:
- **Huvud:** signaturen `C64 CARTRIDGE   ` (andra maskiners, C128, VIC-20, Plus/4 och CBM-II, avvisas med namn),
  huvudets längd (under 64 läses som 64, som VICE gör), version, hårdvarutyp (namnen i `CRT_TYPES` är VICE 3.10:s,
  `cartconv --types`), EXROM och GAME, revision och namnet.
- **CHIP-paket:** typ (ROM, RAM, Flash, EEPROM), bank, laddadress och storlek. Ett paket vars data går förbi filens slut
  avvisas med orsaken, som VICE:s `cartconv` gör (*cut short: … says it holds 16384 bytes, but the file ends after 8192*).
  Byte mellan paketen och efter det sista behålls.

**Minneskarta.** EXROM och GAME ger läget (`CartMode`, `c64/memconfig.ts`): 8K (ROML på `$8000–$9fff` där BASIC skulle
synas, alltså med LORAM och HIRAM), 16K (dessutom ROMH på `$a000–$bfff` där HIRAM är satt) och Ultimax (ROML på `$8000`,
ROMH på `$e000` i stället för KERNAL, I/O på `$d000` oavsett `$01`). `areaAt`, `reaches`, `banked`, `ioVisible`,
`portText` och `describePorts` tar läget. Cartridgens ROM räknas som programmets egna byte: `jsr $a7ae` i en 16K-cartridge
är ett anrop till dess ROMH (`sub_a7ae`), inte BASIC:s NEXT, och en djupanalys följer det. Spårningen av `$01` (8.7b)
låter kod i ROML köra med `$33`/`$37`, i en 16K-cartridges ROMH med HIRAM och i Ultimax med vad som helst. Läget tas av
de öppnade chippen (`cartMode`): ett chip på `$e000` ger Ultimax, ett över `$a000–$bfff` (eller en cartridge som startar
i 16K) 16K, annars 8K. Inspector, högerklicksmenyn och statusraden visar `$01` med kartan (`ROML · ROMH · I/O · KERNAL`).

**Banker.** Alla chip blir projektets filer, bank för bank, `bank00_8000.prg`, `bank01_8000.prg` och så vidare, på
adresserna CPU:n ser dem på. En EasyFlash (Ultimax vid start) har sin ROMH på `$a000` i filen, men startbankens ROMH öppnas
på `$e000`, där återställningsvektorn är (`chipAddress`); de andra bankernas ROMH ligger på `$a000`. Varje fil minns sitt
CHIP-paket (`LoadedFile.chip`), och avbilden sparas med projektet (`Project.cart`, base64 under `cart` i projektfilen).
Bankerna har samma adresser, så varje bank är ett adressrum för sig (13.9b) och listningen visar dem alla, efter varandra.
Explorer får sektionen *Cartridge* under *Files*: namnet och typen, och en rad per bank med chippens adresser och storlek.
Startbanken är märkt *start*. Ett klick går till bankens start (dess vektor, annars dess första chip), **×** lämnar en bank
utanför projektet (exporten tar den då ur avbilden som den är, `banks/`) och **+** lägger till den igen. Med fler än fyra
chip visar *Files* dem på en rad. Sindri kör inte chippen.

**Start (5.3b, `analyze/cartridge.ts`).** I 8K och 16K letar KERNAL:s återställning efter `CBM80` (`$c3 $c2 $cd $38 $30`)
på `$8004` och hoppar genom kallstartvektorn på `$8000`; NMI-rutinen (RESTORE) går genom varmstartvektorn på `$8002`.
Analysen gör vektorerna till ett ordblock (`cart_vectors: .word start, warm_start`) och signaturen till text
(`cbm80: .text "CBM80"`, PETSCII med gemener), spårar kallstarten som programstart och varmstarten som NMI
(`warm_start`). I Ultimax är CPU:ns vektorer på `$fffa–$ffff` cartridgens (`cpu_vectors`): NMI, återställning och IRQ.
Utan `CBM80` säger loggen att KERNAL inte startar cartridgen själv (ett BASIC-tillägg, eller en som startas med SYS), och
den första byten blir ingångspunkt som för en PRG.

**Avbilden byggs om.** Exporten skriver `<namn>.crt.asm`, som skriver hela avbilden med `.file [name="<namn>.crt",
type="bin", segments="Cartridge"]` (ett segment från 0, eftersom avbilden kan vara större än 64 KB): huvudet och varje
paketets huvud som kommenterade `.byte`-rader (namnet som `.text` i ASCII), de öppnade chippen med
`.import binary "out/<chip>.prg", 2` (det de egna källorna bygger, utan laddadress) och de andra från
`banks/<chip>.bin`, som exporten också skriver. `.errorif` kontrollerar varje chips längd. `build.bat` och `build.sh`
assemblerar chippens källor först och sedan `<namn>.crt.asm`, och startar VICE med `-cartcrt out\<namn>.crt`.
`runKickAssembler` tar utdata från en `<namn>.crt.asm` som `out/<namn>.crt`. Exporten lägger också originalet i
`original/` och den verifierade avbilden i `out/`.

**Verifiering.** F7 verifierar chippens källor som vanligt och bygger sedan avbilden ur det de byggde (`builtCartridge`:
originalet med chippen utbytta, `rebuildCrt`) och jämför den byte för byte med den som öppnades (`compareCrt`, som
säger var en skillnad är: *CHIP 0 (bank 0) at $8010*). Med KickAss.jar assembleras också `<namn>.crt.asm` efter chippen,
och dess avbild jämförs likadant. Byggloggen och märket i byggpanelen säger resultatet (*Built-in cartridge OK:
mimir-demo.crt 16480 / 16480 bytes identical*). `mimir verify` gör samma sak, `--kickass` med den riktiga.

**Build & Run** bygger och verifierar, skriver avbilden (KickAss.jar:s, annars den inbyggda assemblerns) i en byggmapp och
startar VICE med `-cartcrt <namn>.crt` (och etiketterna med `-moncommands`, en monterad disk med `-8`): VICE kopplar in
cartridgen och återställer, och C64:an startar den från dess vektorer. Programstarten används inte. Knappens tips säger
det, byggpanelen visar kommandona och märket.

**Test:** `packages/core/test/crt.test.ts` gör cartridges ur källkod (`makeCrt`): huvud och paket, avvisade filer, en
EasyFlash vars ROMH öppnas på `$e000`, minneskartan, starten i 8K (`CBM80`, KERNAL-namnen), utan `CBM80`, en 16K
vars ROMH spåras i stället för BASIC och en Ultimax utan KERNAL, källan som bygger avbilden, en annan bank och exporten,
projektfilen. `fixtures/crt/mimir-demo.crt` är en av dem: en Magic Desk med två banker, där bank 0 kopierar en rutin
till `$c000` som kopplar in bank 1 (`$de00`) och visar dess text. `kickass.integration.test.ts` bygger den exporterade
cartridgen med riktiga KickAss.jar, från bank 0 och bank 1, till samma avbild. `vice.integration.test.ts` startar den
ombyggda avbilden i riktiga x64sc, som byter till bank 1 och avslutar med dess första skärmkod. Ett e2e-test öppnar den
via dialogen, verifierar, byter bank och ångrar, exporterar och kör Build & Run med ett program som ersätter VICE.
Mot användarens arkiv (309 cartridges: normala 8K och 16K, Ultimax, Ocean, Magic Desk, System 3, Dinamic, Fun Play,
Zaxxon och EasyFlash) verifierades 299 byte för byte; de 10 andra är avkortade filer som `cartconv` också kallar trasiga.
Ett urval av alla typerna, upp till en EasyFlash på 1 MB, byggdes om med KickAss.jar till identiska avbilder.

### 13.9b Bankerna som adressrum

En cartridges banker delar adresser: varje bank ligger på `$8000` (och `$a000`), men bara en är inkopplad åt gången. Som i
SourceGen (6502bench), där hela `.crt`-filen är en följd med huvudena som icke-adresserbara områden och varje bank ett
adressområde på `$8000`, ska alla banker synas på en gång så att koden blir komplett. `packages/core/src/spaces.ts`:

- **Bankadresser.** Varje bank är ett adressrum på 64 KB. En adress i rum *s* är *s* · `$10000` + adressen (en
  bankadress): bank 1:s `$8000` är `$18000`. Rum *s* är cartridgens *s*:e bank i ordning (`crtBanks`), så nycklarna står
  kvar när banker läggs till eller tas bort. Bank 0 är rum 0 och dess adresser är de vanliga: ett projekt med ett rum
  (varje projekt utan cartridge) analyseras precis som förut. Filer som inte är chip (PRG:er) hör till rum 0.
- **Analysen** (`analyze`) delar projektet per rum (`splitProject`): rummets filer, och användarens arbete i det
  (etiketter, kommentarer, overrides, ingångspunkter, programstarten, bokmärken, minneszoner, utelämnade och binära block),
  med nycklarna gjorda vanliga. En nyckel i rum 0 vars adress ingen fil där har (en nollsidevariabel) delas: alla rum får
  den. Varje rum analyseras av motorn som den är och resultaten slås ihop (`mergeAnalyses`) till ett där allt står på
  bankadresser: minnet, typkartan och de andra tabellerna är rummen efter varandra, block, etiketter, korsreferenser och
  loggen (*Bank 3: …*) likaså. `AnalysisResult.spaces` säger för varje rum dess bank, filer, minneskarta och start.
- **Närmaste banken.** En adress söks i banken referensen står i, annars i den första banken som har den. Adresser som
  ingen bank har (nollsidan, I/O, RAM) står kvar som de är, och deras namn delas av alla banker. Kod som en bank anropar
  i en annan (`jsr`/`jmp` till en adress banken själv saknar) spåras där som subrutin (`ProjectInput.calls`), i omgångar
  tills inget nytt kommer (högst 4).
- **Starten.** En bank som inte är startbanken gissar ingen start på sin första byte (`ProjectInput.bank`): den spåras från
  sina egna vektorer (en Action Replay har `CBM80` i varje bank), från det andra banker anropar i den och från koden man
  märker (C). Loggen säger det.
- **Cache.** Analysarbetaren behåller varje rums analys (`SpaceCache`): ett rum vars filer och arbete är desamma
  analyseras inte igen, så en ändring i en bank av en stor cartridge analyserar den banken. En EasyFlash på 1 MB (64
  banker) öppnas på knappt 2 s, och en ändring i en bank tar ungefär 1 s med sammanslagningen.

**Källan** (`render`): varje rum renderas som det är, med sitt prefix på binärfilerna (`gfx/bank03_…`, `music/bank03_…`,
`data/bank03_…`), och raderna, etiketterna och länkarna görs till bankadresser. En operand till en annan bank får den
bankens etikett (`ProjectInput.foreign`), med ett eget namn om banken redan har ett likadant, och filens huvud definierar
den: `// labels in other banks of the cartridge` och `.label sub_8100 = $8100`. Filraden över varje bank säger dess
nummer (*bank01_8000.asm · bank 1*). `verify` verifierar rum för rum, med resultaten i projektets filordning, och
exporten skriver varje banks källa: avbilden byggs av dem alla, ingen bank tas ur `banks/`.

**Fönstret.** Listningen, Inspector, statusraden och panelerna arbetar med bankadresser. Statusraden säger banken
(*bank 3 · $8000 · start*), och Blocks, Symbols och Memory map visar `3:$8000`. Vyerna på 64 KB (Graphics, Memory,
värmekartan i Inspector och Explorer, grafikförhandsvisningen) visar banken där markören är (`spaceView`,
`spaceRender`): deras adresser är de vanliga i den banken, och det de väljer eller markerar görs till bankadresser igen.
Bank 0:s namn på sina egna byte hör till bank 0 och syns inte i en annan banks vy; namnen på det ingen bank har delas.
I Graphics och Memory väljs banken i lägesraden (*Bank*, bredvid *Go*): listan har cartridgens alla banker med
adresserna (*3 · $8000 · start*), och pilarna bredvid eller mushjulet över den stegar från bank till bank. Markören följer
med, till samma adress när banken har den (annars dit banken startar), och markeringen med den när banken har alla dess
byte. Bilden och raderna står kvar där de är, så samma adresser kan jämföras bank för bank. Banker som inte är med i
projektet står i listan men går inte att välja förrän + i Explorer lägger till dem. I Memory står bankens nummer först på
varje rad, före `>C:` (`1 >C:8000  …`), i alla tre lägena och med All banks radens egen bank. Numret är lika brett som
det högsta banknumret, så att raderna står i linje. Det syns bara på skärmen: *Copy* skriver raderna som VICE gör.

**All banks**, först i listan (när mer än en bank är med i projektet), visar alla banker på en gång, som listningen: Memory
med varje banks rader efter varandra under en rad med bankens nummer (*bank 1 · $8000–$bfff*), Graphics med bankernas
laddade minne efter varandra (från 8 KB till 8 KB, så att cellerna står där VIC har dem) och bankens första rad markerad.
Adresserna skrivs med banken (`1:$8000`), kommandot i Memory och *Go* i Graphics tar `3:8000`, och en adress utan bank
gäller markörens bank. En markering i Graphics stannar i en bank. Valet är detsamma som *All banks in one .asm* i
Explorer: att välja All banks sätter på den, att välja en bank stänger av den (en toast säger det, Ctrl+Z ångrar), och
rutan i Explorer byter vyerna mellan alla banker och en. Pilarna och mushjulet stegar bara mellan banker, så exporten byts
aldrig av misstag. Font per row visar en bank även med All banks (markörens). Graphics ritar bara raderna på skärmen och en
skärm över och under (`drawMemory` med ett radintervall), så en EasyFlash på 1 MB (64 banker) går också: All banks i
Screens är 422 000 pixlar högt men ritas på en duk lika stor som fönstret.

Inspector säger *Memory map · bank 3*, och `$01` visas med bankens minneskarta. *Go to* (G) tar banken före adressen
(`3:8000`, `3:$8000-3:$80ff`); utan den gäller markörens bank när den har adressen, annars den första som har den.
Programstarten och användarens arbete sparas på bankadresser (projektfilens schema tar dem). Patchar kan skrivas i
bank 0 och hamnar alltid i bank 0:s chip, inte i en annan bank på samma adress; i andra banker säger dialogen att det
inte går ännu. Instruktionsavkodningen (`decode`), cykelräkningen och *Merge range* håller sig i bankadressens bank.

**Test:** `crt.test.ts` (*every bank at once*): båda demobankerna i listningen på bankadresser, en etikett, en kommentar och
en override i bank 1 som stannar där, en vy av en bank, en 16K-cartridge där bank 1 (bara ROMH) anropar en rutin i bank
0:s ROML som spåras där och heter `sub_8100` i bank 1:s källa, cachen (bara banken som ändrades analyseras igen) och en
patch i bank 0 som inte hamnar i bank 1. `goto.test.ts` läser `3:8000`. E2e-testet öppnar demon med båda bankerna,
går till bank 1, skriver `0:8009` i Go to, namnger `$8000` i bank 1, lämnar bank 1 utanför och lägger till den igen
(namnet står kvar), verifierar, exporterar båda bankernas källor och kör Build & Run. Mot arkivet: Chase HQ 2 (32
banker), Myth (64) och OneLoad64 (EasyFlash, 64 banker, 127 chip) verifieras bank för bank och byggs om till identiska
avbilder; användarens Action Replay 5 (Bacchus, 4 banker med var sin `CBM80`) likaså, också med KickAss.jar.

### 13.9c Alla banker i en källa

*All banks in one .asm* i Explorers *Cartridge*-sektion (inställningen `Settings.cartOneSource`, sparad i projektet,
ångringsbar) gör hela cartridgen till en enda Kick Assembler-källa, `<namn>.crt.asm`, som SourceGens enda utfil: den
skriver hela avbilden själv, och listningen och fliken med källan visar den som en fil. Av: en källa per chip och en för
avbilden (13.9).

**Källan** (`oneSource`, `packages/core/src/spaces.ts`) byggs av renderingen per chip:
- Överst `.file [name="<namn>.crt", type="bin", segments="Cartridge"]`, `.segmentdef Cartridge [start=0]` och ett
  segment per chip (`.segmentdef Bank03_8000 [min=$8000, max=$9fff, fill]`). Sedan det som varje chips källa definierade
  för sig, en gång: `#import "include/c64-hardware.asm"` (eller hårdvarunamnen), och nollsidevariablerna med sina
  anteckningar (*zero page (every bank)*). Renderingen märker huvudets rader (`Line.head`) för det.
- Sedan varje bank i ett eget namnrum, `.namespace bank03 { … }`, så att samma namn kan finnas i flera banker (`start`
  i varje Action Replay-bank; `bank03.start` utifrån). Bankens chip står var och ett i sitt segment (`.segment
  Bank03_8000`), med det deras källor hade utom huvudet: inläsarnas och de utelämnade blockens rader, andra bankers
  namn (`.label sub_8100 = $8100`) och musiken stannar i banken.
- Sist avbilden i segmentet `Cartridge`: huvudet och varje CHIP-paket som förut (`cartImageLines`, delad med 13.9), med
  chipets byte ur dess segment (`.segmentout [segments="Bank03_8000"]`); ett chip som inte är med i projektet från
  `banks/`. `.errorif` kontrollerar varje chips längd.
- Listningen visar samma rader under en filrad (*bacchus.crt.asm · every bank*), med en markering där varje bank börjar;
  man redigerar som vanligt. Filer som inte är chip (PRG:er) behåller sina egna källor. Det gäller också en cartridge
  med en bank.

**Bygget:** `build.bat` och `build.sh` assemblerar bara `<namn>.crt.asm` och ger VICE dess etiketter
(`-moncommands out\<namn>.crt.vs`, där Kick Assembler skriver namnen i namnrummen); README beskriver filen. Den inbyggda
verifieringen kontrollerar chippen som förut (renderingen per chip finns kvar under, `RenderResult.parts`) och avbilden
de bygger; med KickAss.jar assembleras den enda källan och dess avbild jämförs med originalet. Byggpanelen visar bara
den källans kommando, och fliken med källan heter som den (`RenderResult.main`).

**Test:** `crt.test.ts` (*every bank in one source*): segmenten, namnrummen, en `#import`, `.segmentout`, att
listningens rader är filens text, verifieringen, exporten (bara den källan, `build.bat`, README) och en cartridge med en
bank där ett chip utanför projektet tas ur `banks/`. `kickass.integration.test.ts` assemblerar den ensam till samma
avbild, med VICE-etiketterna. Ett e2e-test bockar i rutan, ser en filrad och namnrummen, namnger `$8000` i bank 1,
öppnar källfliken, verifierar, exporterar och bockar ur igen. Användarens Action Replay (4 banker, ungefär 9 900 rader),
EasyFlash-skivan OneLoad64 (64 banker, 127 chip) och Pitfall (en bank) blir identiska avbilder med KickAss.jar.

### 13.10 Projekt och startskärmen

Ett **projekt** är en egen mapp, döpt efter projektet, med projektfilen `<namn>.mimir.json` i och det Mimir skriver
för det i mappar där:

```
<namn>\
  <namn>.mimir.json   projektet (filerna, etiketter, kommentarer, bokmärken, patchar …), sparat medan du arbetar
  source\             Kick Assembler-exporten (Ctrl+E skriver hit utan dialog)
  build\              KickAss.jar:s bygge vid varje verifiering (F7, F5), samma mapp varje gång
  packed\             den packade filen, när ingen annan mapp är vald i Pack-vyn (13.8)
```

Mapparna skapas när något skrivs i dem. Spara-dialogerna (grafik, patchar, den packade filen, quicksaves, en kopia av
projektfilen) öppnas i projektets mapp. Varje ändring sparas i projektfilen en halv sekund efter den (och innan
projektet lämnas eller fönstret stängs); **Save** (Ctrl+S) sparar direkt. Ett projekt skrivs aldrig över av ett annat
program: en PRG, en snapshot, en cartridge eller en fil från en disk som öppnas i ett projekt som har filer blir arbete
utan projekt, och projektet ligger kvar som det sparades (titelraden säger *No project*, Save gör ett projekt av det).
Ett nytt, tomt projekt tar emot det som öppnas, som ett steg Ctrl+Z ångrar. Filer som läggs till (Add PRG file…, Shift när
filer släpps, en bank till) och en fil som packas upp stannar i projektet. Showcase-demon och en projektfil som
släpps på fönstret lämnar projektet (som är sparat) och blir arbete utan projekt. En projektfil öppnad med **Open
project** gör sin mapp till projektets, också för filer sparade före projekten.

**Startskärmen** visas när appen startar: **Continue** med det du arbetade med sist (projektet, med dess mapp, eller
arbetet utan projekt; knappen har fokus så Enter fortsätter), **New project…** (namn och mappen det läggs i: först
`Dokument\Mimir`, sedan där det senaste lades; `Change…` väljer en annan i en mappdialog), **Open project…**,
**Without a project**, **Pack a file…** (13.8b) och de senast öppnade projekten (högst 10; ett som inte finns kvar är överstruket, × stryker det
ur listan). Namnet prövas som Windows prövar ett mappnamn (inga `<>:"/\|?*`, inte en enhet som `CON`, inte slut på
punkt); finns redan ett projekt med namnet i mappen skapas inget. Ett nytt projekt är tomt: listningen visar **Open
PRG…**, **Mount D64…** och **VICE quicksave**. Laddas fönstret om fortsätter det med det som valts i körningen, utan
startskärmen. Rutan **Show this window when Mimir starts** (ibockad från början) stänger av startskärmen: appen
fortsätter då direkt med det du arbetade med sist, projektet eller arbetet utan projekt, och visar startskärmen bara när
det projektet inte finns kvar. **Settings → General** (*Show the start screen when Mimir starts*) slår på den igen;
valet sparas av fönstret (`localStorage`, `kr.startScreen`), inte i projektet. Projektknappen i titelraden (projektets namn, eller *No project*) har **Show the project folder**,
**Save a copy of the project file…**, **Open project…** och **Close the project** (tillbaka till startskärmen).

**Utan projekt** arbetar du som förut: fönstret sparar arbetet (`localStorage`) till nästa start, exporten frågar
efter en mapp och bygget hamnar i temp. **Save** (Ctrl+S) skapar då ett projekt av arbetet (*Create a project from
this work*): mappen skapas, projektet sparas där, den senaste exporten av de filer du har kopieras till `source`
(mappen du valde lämnas som den är), det senaste bygget flyttas till `build` och den packade filen till `packed` (ur
appens egna mappar i temp, som tas bort), och arbetet fortsätter i projektet. Fönstret sparar då inget arbete utan
projekt längre. Ett projekt som öppnas medan det finns arbete utan projekt lämnar det kvar: startskärmen erbjuder
båda.

**Ändringar som inte är sparade.** Fönstret håller bara ett arbete utan projekt, så Mimir varnar innan det ersätts
medan det har ändringar som inte finns i något projekt (etiketter, kommentarer, block, bokmärken, patchar … sedan filen
öppnades; inställningarna räknas inte, det som öppnas i stället tar dem med sig). Titelradens *No project* har då en
prick (*No project, changes not saved*). En PRG, en snapshot, en cartridge, en fil från en disk, en quicksave (också en
som öppnas av sig själv), showcase-demon eller en projektfil som släpps på fönstret frågar först, i **The work is not
saved**: **Save as a project…** gör ett projekt av arbetet (samma dialog som Save, med *Create project, then open …*)
och öppnar sedan filen, som arbete utan projekt bredvid det nya projektet; **Do not save** öppnar filen i arbetets
ställe; **Cancel** (Esc) lämnar allt som det var. I ett projekt frågar en fil som lämnar projektet på samma sätt för
arbetet utan projekt som fönstret håller (**The work without a project is not saved**: Save gör ett projekt av det,
projektet som är öppet ligger kvar som det sparades). Ett projekt har inga osparade ändringar: det sparas medan du
arbetar. Ett arbete utan projekt som bara är en öppnad fil, eller vars ändringar är ångrade, frågar inget. Om arbetet har
ändringar sparas med arbetet (`localStorage`, `kr.projectChanged`), så pricken och frågan finns kvar efter en omstart;
arbete som sparades innan Mimir höll reda på det räknas inte som ändrat (det är oftast raster-demon, kvar sedan
tiden före projekten, och frågan gällde då något du inte arbetar med). Historiken vet det (`ownChanges`,
`store/history.ts`): ett steg sedan arbetet senast ersattes i sin helhet är en ändring, och Ctrl+Z tillbaka över en
öppnad fil ger arbetet före den med sina ändringar.

**När Mimir stängs** (fönstrets kryss, Alt+F4, File → Exit) frågar huvudprocessen sidan först (`window:closing`,
`electron/main/closing.ts`). Sidan sparar projektets senaste ändring direkt, utan att vänta på den automatiska
sparningen, och stänger sedan. Ett arbete utan projekt med ändringar som inte finns i något projekt frågar först, i
**Save the work before Mimir closes?**: **Save as a project…** gör ett projekt av arbetet (samma dialog som Save, med
*Create project, then close Mimir*) och stänger sedan; **Close without saving** stänger, och Mimir håller arbetet till
nästa start som förut (men inte i någon mapp som är användarens), utan ändringar att fråga om: frågan är besvarad, så
nästa start frågar inte om dem igen (Quick work, en fil som öppnas i arbetets ställe, att stänga igen; ingen prick i
titelraden), medan en ändring gjord efter starten frågas om som förut (`keepDeclinedWork`); **Cancel** (Esc) lämnar
Mimir öppet. Ett projekt
som inte gick att spara (projektfilen skrivskyddad, disken full …) frågar i **The project is not saved**: **Try again**
sparar igen och stänger, **Close without saving** stänger och ändringarna sedan den senaste sparningen går förlorade.
En ändring som inte gick att spara väntar på att sparas igen, med nästa ändring eller när fönstret stängs. Frågan
väntar så länge det tar; en sida som inte svarar alls (den har hängt sig eller laddades aldrig) får sitt fönster
stängt efter 2,5 s, och en sida som kraschat stängs direkt. Startskärmen har inget att fråga om. Filbevakningen och
quicksave-bevakningen stängs i `will-quit`, inte i `before-quit`: den kommer innan fönstren stängs, och ett fönster som
frågar kan bli kvar.

Huvudprocessen håller reda på det (`projects.json` i appens datamapp): det som valdes sist, de senaste projekten och
mappen nya projekt läggs i. Ett projekt i listan öppnas utan dialog (sökvägen kommer från listan, inte från
renderaren); mappen nya projekt läggs i är den huvudprocessen föreslår eller en vald i sessionen, och projektets mapp
får skrivas i när projektet öppnats eller skapats.

**Test:** `test/main.test.ts` (*projects*): namnen, listan och det som valdes sist över en omstart, mapparna, att ett
projekt inte skapas två gånger, och att exporten kopieras medan bygget och den packade filen flyttas.
`e2e/projects.spec.ts`: startskärmen vid första starten, ett nytt projekt (mappen, en PRG öppnad i det, ändringar
sparade i projektfilen, Ctrl+E till `source`), nästa start (Continue med Enter, omladdning utan startskärm, tillbaka
till startskärmen), arbete utan projekt bredvid ett projekt, ett projekt skapat av arbetet med exporten flyttad
dit, frågan innan arbete med ändringar ersätts (Cancel, Save as a project…, Do not save, pricken efter en
omladdning), och frågan när Mimir stängs (Cancel, frågan väntar längre än huvudprocessen väntar på en sida som inte
svarar, Save as a project…, Close without saving med arbetet kvar till nästa start, där Quick work inte frågar igen men
en ny ändring gör det, projektets sista ändring sparad
när fönstret stängs, och ett skrivskyddat projekt: Cancel, Try again). `test/main.test.ts` (*closing a window*):
sidan tillfrågas, väntar så länge den frågar, fönstret stängs ändå när sidan inte svarar och direkt när den kraschat.
`test/history.test.ts`: vilka steg som är ändringar, efter Ctrl+Z, med inställningar och när historiken
blir för lång.

### 13.10b Git

Ett projekts mapp kan vara ett **git-förråd**. Formuläret **New project** (startskärmen, och *Create a project from
this work*) har rutan **Create a git repository (.git) in the folder**; valet sparas av fönstret
(`localStorage`, `kr.newProjectGit`, avbockad från början) och gäller nästa projekt också. Med den ibockad kör
huvudprocessen `git init` i den nya mappen när projektet sparats och arbetet flyttats dit, på grenen `main` (om inte
användarens git säger något annat med `init.defaultBranch`), och skriver där det inte redan finns:

```
.gitignore       build/          KickAss.jar:s bygge, som görs om vid varje verifiering
.gitattributes   *.prg binary …  .prg .bin .d64 .g64 .crt .tap .t64 .vsf .sid .kla .art .64c .png
```

`.gitattributes` behövs: git för Windows (`core.autocrlf`) tar en fil utan nollbyte för text, och en `.prg` som råkar
sakna nollbyte skulle få `$0d` framför varje `$0a` när den checkas ut. Projektet skapas vad som än händer med förrådet;
notisen säger *as a git repository*, eller varför det inte gick. Ligger mappen redan i ett förråd blir det nya ett eget
inuti det (notisen säger vilket). Utan git (ingen `git.exe` på PATH eller i `Program Files\Git\cmd`) är rutan
avstängd och säger det.

**Fliken Git** (bredvid *Scripts*; kommandopaletten *Git: stage, commit and push the project*) visar projektets förråd
— projektets mapp eller förrådet den ligger i:

- **Huvudet**: grenen, uppströmsgrenen (`→ origin/main`), `↑n` commitar som inte är pushade och `↓n` på
  uppströmsgrenen som inte finns här (enligt den senaste fetchen), **Push** och **Refresh**. Push finns när förrådet har
  en remote: med en uppströmsgren pushar den dit (`git push`), annars till `origin` (eller den enda remoten) som en gren
  med samma namn, som blir uppströmsgren (`git push -u origin HEAD`). Den är avstängd när det inte finns något att
  pusha.
- **Commit-rutan**: meddelandet (Ctrl+Enter committar; ett utkast per förråd ligger kvar medan en annan flik visas)
  och **Commit n**, som kräver något stagat. Meddelandet går till git på stdin (`git commit --file=- --cleanup=whitespace`):
  vilken text som helst, rader som börjar med `#` också.
- **Staged**, **Changes** (och **Conflicts** när det finns): filerna med gits bokstav (M ändrad, A ny, D borttagen, R
  omdöpt, U ospårad, ! i konflikt), namnet och mappen. Knappen på raden eller ett dubbelklick stagar eller avstagar
  filen; **Stage all** och **Unstage all** tar alla. Före den första commiten tas en fil ur indexet
  (`git rm --cached`), efter den återställs indexet från HEAD (`git reset`).
- **Remote**: remotarna med sina URL:er; utan någon ett fält för origins URL (https, ssh, git, file eller
  `user@host:path`), och pennan byter origins URL. Git för Windows inloggning (Git Credential Manager) frågar själv
  första gången det pushas; en terminal frågar aldrig (`GIT_TERMINAL_PROMPT=0`), och en push som inte är klar efter
  5 minuter avbryts.
- **Commits**: de 20 senaste, med kort hash, rubrik och när (**Show 20 more** listar äldre, högst 2 000). Ett klick
  på en commit visar den till höger: rubriken, vem och när, meddelandets resten, **Compared with** och filerna som inte
  är lika med sin bokstav och sina rader `+n −n` (eller *binary*); ett klick på en fil visar dess ändringar (den
  första från början). *Compared with* är från början **commiten före den** (`<förälder> → <commit>`: vad den
  ändrade; den första commiten jämförs med ingenting, allt i den är nytt), eller **mappen som den är nu**
  (`<commit> → the folder now`, med filer git inte spårar än som nya) eller **en annan commit** i listan; Ctrl+klick
  på en annan commit väljer den direkt (raden får en accentkant och *compared*). Två commitar jämförs alltid från den
  äldre till den nyare. Med mappen som ena sidan tittar jämförelsen om när mappen ändras.
- **Utdata**: vad git skrev vid det senaste steget, med kommandoraden (öppen när det misslyckades; notisen säger
  gits felrad).
- Till höger **den valda filens ändringar** (`git diff`, stagade eller inte; en ospårad fil visas hel, en binär fil
  sägs vara binär), högst 512 KB, eller den valda commiten. En fil som stagas följer med till den stagade sidan; en
  fil som inte längre har några ändringar (committad, eller ändrad tillbaka) stängs. Utan något valt säger rutan vad
  som går att klicka på: med ändringar en fil under *Changes* eller *Staged*, eller en commit; i en mapp som är som
  den senaste commiten lämnade den (inga filer att staga, filerna i Explorern öppnas i listningen) en commit, med
  knappen **Show the last commit**.

Projektfilen sparas (som inför att fönstret stängs) innan något stagas eller committas, så det som går in är arbetet
som det är. Fliken tittar på förrådet igen när den visas, när fönstret får fokus, efter varje steg och var fjärde
sekund medan den visas. Utan projekt säger den att git arbetar i ett projekts mapp och erbjuder *Create a project from
this work…*; i en mapp som inte är ett förråd erbjuder den **Create a git repository** (samma `git init`, `.gitignore`
och `.gitattributes`). Pull, grenar och resten görs i terminalen (knappen *Terminal* i flikens fot). Flikraden
(14.1) har fått Git: dess text göms som Scripts när editorn är högst 1245 px bred och fliken inte är vald, och
gränserna för radens steg ligger nu vid 1650, 1540, 1245, 820 och 536 px (standardfönstret, 1480 px, har kvar
verktygen i raden).

**Säkerhet.** Huvudprocessen (`electron/main/git.ts`, `GitService`) kör den git den hittar med argumentlistor, aldrig
genom ett skal, och alltid i förrådet för det projekt som är öppet: renderaren namnger filer i det, aldrig en mapp, ett
program, en remote att pusha till eller en gren. Sökvägarna prövas (relativa, inget `..`) och går till git som de är
(`--literal-pathspecs`, `--pathspec-from-file` med NUL mellan, så varken jokertecken eller kommandoradens längd spelar
in); en URL som börjar med `-` eller inte är en URL tas inte emot. En commit namnges bara med sin hash (7-64
hexsiffror, aldrig en gren, en tagg eller en revision som `HEAD~1`) och prövas med `git rev-parse --verify` att vara en
commit; ingenting före den första commiten är det tomma trädet (`git hash-object -t tree --stdin`). Ett kommando i taget (två samtidigt skulle mötas vid
gits `index.lock`), och `git status` tar inga lås (`--no-optional-locks`). Gits utdata läses i `shared/git.ts`
(`git status --porcelain=v2 --branch -z`, `git remote -v`, `git log`).

**Test:** `test/git.test.ts`: statusraderna (alla slags poster, sökvägar med mellanslag, ett förråd utan commitar, en
lös HEAD), remotarna och loggen, vilka sökvägar och URL:er som tas emot, att git hittas, och `GitService` mot den
riktiga git i temp-mappar med en egen git-konfiguration: förrådet på `main` med `.gitignore` och `.gitattributes`
(`build` utelämnad), en sökväg läst som den är (`a*` är inget jokertecken), stage och unstage före och efter den
första commiten, ett meddelande med `#`-rader, ändringarna stagade och inte, en ospårad och en binär fil, origin
tillagd och bytt, push som sätter uppströmsgrenen och push dit sedan (till ett nakent förråd via `file://`), och ett
förråd inuti ett annat med användarens `.gitignore` kvar; en commits filer från sin förälder (ändrad, omdöpt, binär, rader
+/−), den första från ingenting, en commit mot mappen (en ändring som inte är stagad, en som är det och en ospårad
fil), att bara hashar tas emot, och `log`/`more`. `e2e/git.spec.ts`: ett nytt projekt med rutan ibockad blir ett
förråd, en PRG öppnas, fliken listar filerna och visar en fils ändringar, en fil och sedan alla stagas, Ctrl+Enter
committar, origin läggs till och Push pushar och sätter uppströmsgrenen, och en ändring som sparas i projektfilen syns
som ändrad och blir en commit att pusha, rutan i en ren mapp säger att man klickar på en commit, *Show the last commit*
visar dess fil och ändringar, den första commiten jämförs med ingenting, Ctrl+klick jämför två commitar och *Compared
with* jämför med mappen; utan projekt säger fliken att det behövs ett och visar formuläret med rutan.

## 14. UI/UX-specifikation

### 14.1 Layout (ett fönster)

| Region | Innehåll |
|---|---|
| Titelrad | File-menyn (Smart attach, 13.4b; öppna PRG-filer, en cartridge eller en VICE-snapshot, montera en D64; spara), Ångra/Gör om, kommandosök, Analysis overview (14.1b), Verify, Export, Terminal (13.6), **Build & Run**, tema, inställningar |
| Aktivitetsrad | Explorer, Blocks, Symbols, Bookmarks (med antal), Scripts (med antal skript, 10.3), Pack (med antal intervall), specifikation, kommandopalett. Knappen för vyn som visas fäller ihop sidopanelen; är den ihopfälld är ingen knapp vald, och en vys knapp visar panelen igen med den vyn |
| Sidopanel | **Explorer**: filer, monterad disk (13.5) direkt under dem, VICE-quicksave, patchar (10.2, när det finns några), skräp (11.7, när det finns), loaders, programstart och minneskarta (64 KB-remsa och segmentlista), var och en ett kort vars rubrik öppnar och fäller ihop det (alla kort är stängda när appen startar; det användaren öppnar står öppet resten av körningen men sparas inte, `sideOpen`) med vad det rymmer bredvid rubriken (*1 file*, *none found*, quicksavens tid, startadressen, antal block). *Demo* och *+* (lägg till PRG-filer) står i Files rubrik och **Add PRG file…** under filerna: båda lägger PRG-filer till projektet (ett tomt projekt öppnar dem), medan File-menyn öppnar ett nytt program eller monterar en D64; hjälptexterna är en rad, resten står i knapparnas tips. Pack-vyns sektioner är likadana kort. **Blocks**: filtrerbar lista, en mapp per blocktyp. Ett klick på ett block går till det i listningen; Shift+klick visar det markerat i typens egen vy (`blockView`): sprites, charset, bitmapp och skärmmatris i Graphics ritade som sin typ (multicolor som blocket, en bitmapp så hög som den är, rutnätet flyttat så att en cell börjar vid blocket), text i Memory som `i` (PETSCII) eller `ii` (skärmkoder) med raderna från dess första byte, övriga data (bytes, ord, tabeller, musik, fill) i Memory som `m`, och kod, BASIC och flyttad kod markerad i listningen. Varje rads tips säger vart Shift+klick går. **Symbols**: etiketter (med antal referenser) och använda hårdvaruregister. **Bookmarks**: anteckningarna efter adress (10). **Scripts**: projektets skript, att köra, öppna och ta bort (10.3). **Pack**: packning med Brokkr eller Exomizer (13.8). Vyns rubrik står kvar överst när vyn rullas, och knappen längst till höger på den fäller ihop panelen (se nedan) |
| Editor | Flikar: **Listing** (interaktiv, virtualiserad; vänsterkolumnen visar adress eller radnummer, och längst till vänster, som i SourceGen, var byten står i filen den öppnades från: `+000050`. En PRG:s byte står efter dess laddadress (`$0801` är `+000002`), ett cartridge-chips i dess CHIP-paket i `.crt`-filen (bank 0:s `$8000` i en vanlig cartridge är `+000050`, efter huvudet och paketets huvud) och en snapshots RAM i dess C64MEM-modul i `.vsf`-filen; tipset säger offseten decimalt och filen. Knappen *Offset* i verktygsraden (och menyn) slår av och på kolumnen, som är på från början och sparas med de andra valen; `fileOffsetBases`, `packages/core/src/offsets.ts`), **Graphics** (allt minne som tecken, sprites eller bitmappar, 14.5), **Memory** (minnet som VICE-monitorns `m`, `i` och `ii`, 14.6), **main.asm** (Monaco), **SPEC.md** |
| Inspektor | **Memory map** (256 × 256 heatmap, lägen Type/Bytes/Refs, zoom till laddade sidor, zoom med mushjulet, se nedan), **Block** (intervall, evidens, konfidens, typ, etikett, kommentar), **Preview** (sprite/chars/bitmap, multicolor, text, musik- och rutininfo). Rubriken *Inspector* står kvar överst när den rullas, med knappen som fäller in den eller håller den öppen (se nedan) |
| Bottenpanel | Analysis log, Messages (det toasterna sagt under körningen, se nedan), Problems (med kryssrutan *Deep analysis*, 8.11e), Cross-references, Raster IRQs (8.11d), Spindle script (Pefchain-drivers, 8.11f, och en Spindle 3-disks laddskript, 13.5b, när de finns), Bitfire script (en Bitfire-disks filer och d64writes kommandorad, 13.5c, när en sådan disk är monterad), Booze script (en BoozeLoader-disks filer och skriptet i programmets kod, 13.5d, när de finns), Sparkle script (en Sparkle-disks bundlar och laddskriptet, 13.5i, när en sådan disk är monterad), Krill script (filerna på en disk för Krills loader, anropen i filerna, cc1541:s kommandorad och skriptet i programmets kod, 13.5k, när de finns), IFFL parts (delarna i en disks IFFL-fil, 13.5m), Covert script (filerna på en disk för Covert Bitops-loadern, anropen i koden och makedisks eller maked64:s kommandofil, 13.5l), Pirate Slayer (13.5h), Para-Protect (13.5o), Disk-Speed (13.5p), Tape (13.5e), Statistics, Build output. I flikarna med en loaders filer (Spindle, Bitfire, Booze, Sparkle, Krill, IFFL, Covert, Pirate Slayer, Para-Protect, Disk-Speed och Tape) är raderna för filerna som öppnats eller lagts till därifrån och finns i projektet markerade som Explorerns diskfiler (en linje till vänster, `aria-current`, *it is in the project* i tipset), så det syns vilken fil som är laddad; i skripten och anropen raderna som laddar dem. En flik som den monterade diskens eget laddskript eller egna filer fyller (Spindle, Bitfire, Booze, Sparkle, Krill, IFFL, Covert, DLoC, Pirate Slayer, Para-Protect och Disk-Speed, inte en som bara analysens fynd i programmet fyller) står i accentfärgen med sin siffra i accenten, så användaren ser att disken har ett skript utan att öppna fliken: den pulserar några gånger när disken monteras (inte med *reducerad rörelse*), rullas fram i flikraden om den står utanför, och tipset säger *Read from the mounted disk …* |
| Statusrad | CPU, filer, markörens adress/etikett/blocktyp, markering, antal meddelanden, analystid, verifieringsstatus. Det som går att göra något med är knappar (se nedan) |

Paneler storleksändras med drag och mins per användare. Under 900 px bredd blir sidopanel och inspektor utdragbara lådor.
Titelraden ryms i fönstret ner till dess minsta bredd (760 px), även med ett långt projektnamn: projektknappen krymper
(namnet kortas med …, minst 96 px) tillsammans med kommandosöket; under 1240 px faller *Studio* bort och kommandosöket
får bli 140 px smalt, under 1100 px visar *Export*, *Terminal* och *Editor* bara sina ikoner (sökfältet 100 px), och
under 900 px alla knapparna till höger (File, Ångra/Gör om och kommandosöket göms). Innan dess sköts *Build & Run*,
tema och inställningar ut ur fönstret mellan 900 och 1175 px.

**Explorer efter en laddning:** när en fil har laddats, hur den än öppnades eller lades till (File-menyn, Ctrl+O, Smart
attach, ett drag in i fönstret, Disk, Tape, ett laddskript, Pirate Slayer, en VICE-quicksave), fälls *Files* ihop direkt.
När analysen av den har kommit öppnas *Loaders* om den har en loader och *Program start* om starten är känd: satt (av
användaren eller som en snapshots BASIC `SYS`), en BASIC-stubs `SYS` eller en cartridges vektorer, inte laddadressen som
tas när ingen start finns. En fil som läggs till i ett projekt räknas för sig: bara en loader med en del i den, och bara
en start i den, öppnar sektionerna. De andra sektionerna står som de stod, och Explorer visas bara där laddningen visar
den (File-menyns val, Smart attach). En cartridge visar alltid Explorer med *Cartridge* öppen, hur den än öppnades
(`afterLoad` i `App.tsx`). Uppackningen räknas som en laddning (8.11b).

**Meddelanden:** en toast i hörnet går efter 4,2 s, en lång efter upp till 9 s (40 ms per tecken), så att den hinner
läsas. Ett fel stannar tills det stängs med sitt kryss (*Dismiss the message*) eller fyra nyare trycker undan det.
Toasterna tar inga andra klick: det under dem går att klicka på. Allt som toasterna sagt under körningen (de senaste 200)
finns i bottenpanelens flik **Messages**, det nyaste först med tiden, och *Clear* tömmer den. Statusraden visar hur
många meddelanden det är (fetstilt med en felikon när ett fel finns bland dem), och ett klick öppnar fliken.

**Statusraden gör det den visar:** antalet filer visar *Files* i Explorer, markörens adress öppnar *Go to*, antalet
meddelanden fliken Messages, analystiden fliken Analysis log, verifieringsstatusen kör Verify (som F7) och *Kick
Assembler 5.x* öppnar Settings. Processorn, `$01` och markeringen är bara text. Knapparna ser ut som resten av raden och
lyser upp under pekaren (`StatusBar.tsx`).

**Fälla ihop panelerna:** sidopanelen fälls ihop och visas igen med `Ctrl+Shift+B` (`Ctrl+B` visar bokmärkena), knappen
till höger på vyns rubrik (*Collapse side panel*), knappen för vyn som visas i aktivitetsraden och *Toggle side panel*
i kommandopaletten. Ihopfälld försvinner panelen och dess dragkant, och editorn med listningen får deras bredd (276 px
med standardbredden). Aktivitetsraden står kvar, och en vys knapp visar panelen igen med den vyn, liksom `Ctrl+B`, *Demo*,
en monterad disk och Pack-kommandona. Bottenpanelen fälls ihop med `Ctrl+J` och pilen till höger på dess flikrad, och
dras mellan 120 och 520 px i kanten ovanför; en vy som behöver sin plats (Scripts-fliken, 10.3) får den, och panelen ger
vika ner till sin flikrad i stället för att täcka vyn. Båda
valen sparas per användare med de andra (`sidePanel`, `panelOpen` i `apps/desktop/src/store/ui.ts`), så de står kvar
efter en omstart. I ett smalt fönster (under 900 px) öppnar och stänger `Ctrl+Shift+B` sidopanelens låda.

**Inspektorn infälld:** Settings → General → *Inspector (the panel on the right)* väljer *Always open* (standard) eller
*Folded in*. Infälld är inspektorn en list längst till höger (28 px, *Inspector* på högkant), och editorn med listningen
får resten av bredden (288 px med standardbredden). Ett klick på listen fäller ut inspektorn över editorns högra del, i
sin vanliga bredd, så listningen behåller sin bredd. Ett klick på ett blocks start, dess rubrikrad i listningen, fäller
också ut den, med blocket i *Block*; ett klick på en annan rubrik låter den vara utfälld och visar det blocket. Ett klick
utanför den fäller in den igen och gör samtidigt det det gör där: ett klick på en rad i listningen flyttar markören dit. Klick i menyer och dialoger räknas inte. `Esc` fäller
också in den, och bara det: listningen går inte tillbaka. Klick inne i inspektorn (heatmap, typ, talformat) låter den
vara utfälld. Knappen i inspektorns rubrik byter läge direkt: *Fold in the inspector* när den alltid är öppen och
nålen *Keep the inspector open* när den är utfälld. Kommandopaletten har *Show the inspector* (infälld) och kommandot
som byter läge. Valet sparas per användare (`inspector` i `apps/desktop/src/store/ui.ts`). I ett smalt fönster är
inspektorn som förut en låda som titelradens knapp öppnar, i båda lägena.

**Zooma minneskartan:** mushjulet över inspektorns *Memory map* zoomar in och ut kring pekaren, så att byten under den
står kvar under den, från hela kartan till åtta byte i bredd (×32); inspektorn rullar inte under tiden. Ett drag med
höger musknapp flyttar den inzoomade kartan, och den följer pekaren. Varje rad är en sida även inzoomad, så raden visar
färre byte, och de visar mer ju större de blir: linjer mellan byten och en mörkare där ett block börjar, sedan värdet i
hex, och närmast etiketternas namn och en rad till under värdet: mnemonic där en instruktion börjar (Type), bitarna som
pixlar (Bytes) och, under antalet referenser, värdet (Refs). Adresserna längs kanten blir en per rad när raderna är
höga nog och säger adressen vid kartans vänsterkant. Vänsterknappen hoppar med ett klick och markerar med ett drag som
förut, och ett högerklick utan drag hoppar dit som ett klick. *Zoom to the loaded pages* av eller på behåller zoomen och
det som var i mitten, kartan följer markören när den flyttas utanför det som syns, och *Whole map* i kartans hörn, eller
hjulet tillbaka, visar hela kartan igen. Geometrin står i `apps/desktop/src/lib/heatview.ts`.

**Ett tecken förstorat:** ett klick på ett tecken i inspektorns *Preview* som Chars (ett charset-block, eller andra byte
med *Chars* valt) visar det förstorat under förhandsvisningen, och tecknet ramas in i den. Rutan visar tecknets 8 × 8
pixlar, 14 px var med en linje mellan dem, i förhandsvisningens färger (multicolor 4 × 8, varje pixel dubbelt bred), och
bredvid raderna de ritar dess 8 byte: adressen, värdet i hex och bitarna (i par i multicolor). Rubriken säger tecknets
nummer i dess 2 KB, som Graphics-fliken (*Char $41*; *8 bytes* när byten inte börjar på ett tecken, en markering som
inte börjar på 8), och dess adresser, som går dit i listningen; tecknet står kvar förstorat. Rutan får tangenterna vid
klicket: `←` `→` tecknet före och efter, `↑` `↓` en rad i förhandsvisningen bort (16 tecken, 128 byte), `Home` och `End`
blockets första och sista, och `Esc` stänger den, liksom krysset; listningens markör flyttas inte av dem. Pilknapparna
i rubriken stegar också. Tecknen stegar genom minnet, 8 byte åt gången, inte bara bland förhandsvisningens: förbi
blockets (eller markeringens) början och slut, till `$0000` och `$fff8` (i samma fas som blocket när det inte börjar
på 8). Så kan man bläddra igenom en hel font från ett enda tecken, eller från en font som analysen delat i flera block,
utan att markera flera tecken i listningen. Ett tecken utanför förhandsvisningens ramas inte in, och en rad under
rubriken säger vems byte det är, som för en sprite nedan (*Before this block: Fill at $2040*); ett klick på dess adress
går dit i listningen, och det blocket visas då som Chars med samma tecken förstorat. Ett annat block, en annan
markering eller ett annat läge än Chars stänger den. Under en förhandsvisning som Chars utan förstorat tecken står
*Click a character to see it enlarged.* (`GfxZoom` i `GfxPreview.tsx`, `charStep` i `apps/desktop/src/lib/charzoom.ts`.)

**En sprite förstorad:** på samma sätt visar ett klick på en sprite i *Preview* som Sprite (ett sprite-block, eller andra
byte med *Sprite* valt) den förstorad under förhandsvisningen, inramad i den. Rutan visar spritens 24 × 21 pixlar
(multicolor 12 × 21, varje pixel dubbelt bred) så breda som inspektorn ger plats för, med en linje mellan dem (10 px var
i inspektorns standardbredd 312 px, upp till 14 px), och under dem dess 21 rader om 3 byte: adressen, värdena i hex och
bitarna (i par i multicolor), och sist den 64:e byten, som VIC inte ritar (*not drawn*). Pekaren över en rad pixlar
markerar dess byte, och över en rad byte dess pixlar. En rad med bitar är 244 px bred (multicolor 262) i JetBrains Mono
10 px; i en smalare inspektor (under 290 px, multicolor under 308) visas bara adressen och värdena (container query).
Rubriken säger spritens pekare, talet som skrivs till `$07f8`-`$07ff` för att visa den (*Sprite $80* för `$2000`: dess
64 byte räknade i dess 16 KB VIC-bank, som Graphics-fliken; verktygstipset säger banken; *64 bytes* när byten inte
börjar på 64), och dess adresser, som går dit i listningen.

En sprite stegar också genom minnet, inte bara bland förhandsvisningens: ofta följer flera sprites efter varandra (en
animations bilder) fast blocket bara har den första, som pekaren visar. `←` `→` och pilknapparna visar de 64 byte före
och efter, förbi blockets början och slut (till `$0000` och `$ffc0`, i samma fas som blocket när det inte börjar på 64),
`↑` `↓` en rad i förhandsvisningen bort (4 sprites, färre när blocket har färre), och `Home` och `End` går tillbaka
till blockets första och sista. Listningens markör flyttas inte. En sprite utanför förhandsvisningens ramas inte in, och
en rad under rubriken säger vems byte det är: *After this block: Fill at $2040*, *Before this block: music_1000
(Music)*, *…: not loaded* (*this selection* för en markering). Ett klick på dess adress går dit i listningen, och det
blocket visas då som Sprite med samma sprite förstorad (i samma färger), så att man kan stega vidare där. Ett annat
läge än Sprite stänger den. Under en förhandsvisning som Sprite utan förstorad sprite står *Click a sprite to see it
enlarged.* (`spriteStep` i `charzoom.ts`; `carry` i `Inspector.tsx` för adressen, för tecken och sprites.)

**En sprites färger:** sprites ritas i inspektorn (förhandsvisningen som Sprite och den förstorade spriten) i samma
färger som listningens bilder: sprite-blockets egna, annars Graphics-flikens. I den förstorade spriten i ett
sprite-block (visat som det är, *Auto*) står en rad med en ruta för varje färg som VIC ger sprites: **BG** (bakgrunden,
`$d021`: pixlar 0, i multicolor 00), **Sprite** (spritens egen färg, `$d027`-`$d02e`: pixlar 1, i multicolor 10), och i
multicolor **MC1** (`$d025`: 01) och **MC2** (`$d026`: 11), som i SpritePad. Ett klick på en ruta öppnar C64:ans 16
färger under raden (8 i bredd, den valda inringad); ett klick på en färg ger blocket den, och paletten står kvar så att
man kan pröva flera. Färgerna sparas med blocket (`OverrideProps.colors`, som *Multicolor*), så listningen ritar
blockets sprites i dem; byte blocket växer eller slås ihop med (`overrideLike`) behåller dem, och de står kvar när
blocket växlar mellan hires och multicolor (spritens egen färg är 10 i multicolor). Varje val är ett steg som `Ctrl+Z`
tar tillbaka, och spriten visar valet direkt, innan analysen har det. **as the Graphics tab** tar bort blockets färger,
så att det ritas i Graphics-flikens igen. I raden flyttar pilarna mellan rutorna och färgerna (inte till en annan
sprite), och `Esc` stänger paletten först. Graphics-flikens färger är bitparens (00, 01, 10, 11), så ett block utan egna
färger får dem omräknade till spritens (`spriteColorsOf`, `spritePairColors` i `apps/desktop/src/lib/gfxlines.ts`) och
ser ut som förut. *Add to library* tar med blockets färger. Utanför ett sprite-block (andra byte som Sprite, en
markering) visas ingen färgrad och Graphics-flikens färger används.

Editorns flikrad anpassar sig efter editorns egen bredd (CSS container queries på `.main`), inte fönstrets, eftersom
sidopanelen och inspektorn tar sin del:
- **Under 1650 px:** verktygens tangenttips (`G`, `Ctrl+F`) försvinner; de står kvar i verktygstipsen.
- **Under 1540 px:** listningens verktyg (bakåt, framåt, föregående och nästa block, *Go to*, *Find*, *Data as code*,
  *Offset*, *Cycles*, vänsterkolumnen *Adr*/*Line*) visar bara sina ikoner. Namnen finns kvar för skärmläsare och i
  verktygstipsen.
- **Under 1245 px:** flikarna blir smalare (5 px på var sida om innehållet, flikarna med bara en ikon 4 px), och
  knapparna för föregående och nästa block lämnar raden (`Ctrl+↑` / `Ctrl+↓` och kommandopaletten finns kvar). SPEC.md
  visar bara sin ikon (aktivitetsfältet öppnar den också), Scripts och Git likaså när de inte är valda, och källfliken
  början av sitt namn.
- **Under 820 px:** verktygen flyttar in i menyn **⋯** (*Listing tools*). Där är *Data as code*, *Cycles* och
  vänsterkolumnens val bockade när de är på, och samma knapp stänger menyn.

Gränserna är mätta med demons flikar och lite marginal för ett längre filnamn. När fliken *Drive code* (8.11i) kom till
flyttades de tre översta upp med dess bredd och de smala flikarna gav plats åt den: raden har minst 24 px över i varje
editorbredd från 440 till 1420 px. Standardfönstret (1480 px, editorn 824–840 px) har verktygen i raden, och raden får
plats utan att något kapas i varje fönsterbredd (ett e2e-test går igenom 2000–1100 px). Fliken *Scripts* (10.3) flyttade
gränserna igen (1505, 1395 och 1090 px blev 1585, 1475 och 1180 px); 820 px står kvar, eftersom standardfönstret ska ha
verktygen i raden, och Scripts visar i stället bara sin ikon i det smala läget när den inte är vald. Fliken *Git*
(13.10b) flyttade de tre översta gränserna med sin bredd (65 px: 1585, 1475 och 1180 px blev 1650, 1540 och 1245 px),
visar bara sin ikon i det smala läget när den inte är vald, och de smala flikarna fick 5 px utfyllnad i stället för 6
(ikonflikarna 4 px), så att standardfönstret har kvar verktygen i raden (editorn är där 824 px: fönstret är 1480 px med
sin ram); den lägsta gränsen flyttades från 520 till 536 px. Raden har minst 16 px över i varje editorbredd från 380
till 2000 px (16 px vid 822 px, 18 px i standardfönstret, 23 px vid 537 px).
- **Under 536 px:** de andra flikarna än den valda visar bara sin ikon, med namnet som verktygstips.

Källflikens filnamn kortas med "…" (högst 12 em, 8 em på smal rad). Verktygen syns därmed också i smala fönster, där
de tidigare var dolda.

### 14.1b Översikten av analysen

När en fil har laddats, hur den än öppnades (File-menyn, Ctrl+O, Smart attach, ett drag in i fönstret, Disk, Tape, ett
laddskript, en VICE-quicksave) eller lades till, öppnas ett fönster mitt i appen, **Analysis overview**, som säger vad
analysen hittade. Det kommer när analysen av de laddade filerna är klar (den djupa när den är på, 5.17), inte innan. Med
*Unpack packed files when they are opened* på väntar det på uppackningen och visar det uppackade programmet; den packade
filen får ingen översikt (som längst 30 s, sedan visas den som den är). Uppackningen räknas som en laddning (8.11b):
*Unpack* i översikten stänger den, och översikten kommer igen för det uppackade programmet. Ett projekt som öppnas,
demon och ett omladdat fönster ger ingen översikt, och den kommer inte över en annan dialog.

Överst står filerna (namn, intervall, storlek, *VICE snapshot*; en cartridge med antal chips och banker) och hur lång tid
analysen tog, och under dem en **blockkarta**: blocken i adressordning som en stapel, där block av samma typgrupp
bredvid varandra blir ett stycke i gruppens färg (14.2) och ett mellanrum står där de laddade byten tar slut. Ett klick
på ett stycke går dit i listningen. Raden **Open** har snabblänkar till flikarna: *Listing*, `.asm`-källan, *Graphics*
(vid det första grafikblocket när det finns ett), *Memory* och *Drive code* när programmet laddar upp kod till 1541:an.

Sedan kommer analysens delar, ett kort var:
- **Packed** (bara när en fil är packad eller kan vara det, över hela bredden): vad packningsanalysen säger och knappen
  *Unpack* (eller *Unpack with …*), och en länk till dekrunchern.
- **Looking for packing** (över hela bredden, medan Sindri ännu kör en fil som inget har kallat packad): en snurra,
  filens namn, *Sindri is running it to see whether it unpacks itself…* och sekunderna sedan körningen började. Sindri
  kör varje fil som öppnas i en egen worker, en i taget (8.11b), och en fil kan ta upp till en halv minut (ett program
  som väntar på tid, en lång dekrunchning); översikten väntar inte på det utan säger att den letar. När ett lager kommer
  av blir kortet *Packed* med *Unpack*. Kör Sindri klart utan att något packar upp sig blir det **Not packed** (*… is not
  packed: Sindri ran it and nothing unpacked itself (4 s).*), och en körning som misslyckas ger *Packing not checked*.
  Ett *Packed*-kort (heuristiken såg packningen först) har samma rad med snurran medan Sindri kör. Med unp64 som extern
  uppackare säger kortet att unp64 namnger packaren (`unp64 -i`). Svaret visas bara för en körning som översikten såg
  pågå: öppnad igen senare säger den inget om filer som inte är packade. (`checks` och `lookingFor` i `App.tsx`,
  `PackLook` i `Overview.tsx`.)
- **Snapshot screen** (bara för en VICE-snapshot med en VIC-II-modul, över hela bredden, 13.7): skärmen som snapshotens
  VIC-II visade när VICE sparade den, ritad som VICE ritar den (384 × 272, PAL, vanliga ramar), och bredvid den läget
  (*Multicolour text, 38 × 24, scroll x 3 y 3*; *The screen is off: the border colour only*), VIC-banken och VIC-II-modellen,
  var VIC:en läser skärmen, teckensetet (eller teckens-ROM:en, versaler eller gemener) eller bitmappen och varje påslagen
  sprite (adress, position, multicolor, bred, hög, bakom), färgerna läget använder (ram, bakgrund, multicolor 1–2,
  bakgrund 1–3 med ECM, spritarnas multicolor) och rasterraden med rasteravbrottets rad. Adresserna är länkar: till
  Graphics vid blocket när det är grafik, annars till listningen. Ett klick på bilden visar skärmen i Graphics. Kortet
  säger att det är registren i ett ögonblick: ett program som ändrar dem under bilden (en rastersplit) visade mer.
- **Snapshot PC** (bara för en VICE-snapshot, 13.7): var CPU:n var när VICE sparade den. Kortet visar adressen och
  etiketten som en länk till listningen, som redan står där, och registren som VICE:s monitor visar dem
  (`A $41  X $00  Y $0a  SP $ed  $01 $37  NV-BDIZC 00100100`). En PC i ROM, I/O eller utanför RAM-et som öppnades
  visas utan länk, med var den ligger.
- **Program start**: startadressen och dess etikett (en länk till listningen), hur analysen vet den (satt av dig,
  snapshotens BASIC SYS, där uppackaren lämnade programmet, SYS i BASIC-raden, cartridgens startvektor eller
  laddadressen när ingen SYS finns), BASIC-raden med SYS och länken *Program start in the Explorer*.
- **Loaders**: varje loader (högst tre) med namn, om den hittades på sin egen kod eller sina drag, hur den fungerar och
  upp till fyra av dess delar som länkar; *Loaders in the Explorer* öppnar sektionen vid den första delen, och flikarna
  för ett laddskript eller bandet (Spindle, Bitfire, Booze, Sparkle, Pirate Slayer, Tape) har var sin länk.
- **Problems**: fel, varningar och tips (länkar till fliken Problems), vad den djupa analysen gjorde (eller att den är
  av) och *Analysis log*.
- **Blocks** (över hela bredden): varje blocktyp med antal block, byte och andel av de laddade byten. Ett klick visar
  Blocks-vyn med typens mapp öppen och går till dess första block.
- **Code**: instruktioner, kodbyte, rutiner, etiketter, korsreferenser, odokumenterade opkoder (en länk till den
  första), självmodifierande skrivningar, avbrottsrutiner och tidskod, och länkar till Raster IRQs, Relocated, Drive code
  och Statistics när de har något.
- **Graphics**: sprites, teckenset, bitmappar och skärmar med antal och den första adressen. Ett klick öppnar Graphics
  vid typens första block, markerat och ritat som den typen (sprites, chars, bitmap, screens); därunder VIC-banken,
  bitmappsläge, multicolor och spritepekare.
- **Music**: musikblocken (högst tre) med intervall, init och play (länkar till listningen) och vad körningen av dem
  spelade (5.8). Varje block har en knapp **Play** som spelar det där Settings → Toolchain säger, i VICE eller DeepSID,
  som Blocks-vyns spelknapp (samma titel, samma `playMusic` i `App.tsx`); ett musikintervall vars byte du har märkt som
  något annat får ingen knapp.

Varje länk stänger fönstret och går sedan dit den säger; *Play* gör det inte (spelaren öppnar ett eget fönster, och
meddelandet om vad som spelas syns ovanpå översikten). Ett klick utanför fönstret, `Esc`, krysset och *Close* stänger
det också. Har programmet rutiner som är kända från andra projekt (10.5) och som användaren inte namngett visar kortet
*Known routines* dem med adress, namn och projektet namnet kom från; *Name it* / *Name all N* ger dem namnen och
lämnar fönstret öppet. Settings → General → *Show an overview of the analysis when a file is opened* (på från början, sparas per
användare som `overview` i `apps/desktop/src/store/ui.ts`) slår av och på det, liksom rutan *Show this overview when a
file is opened* i fönstrets fot. Knappen **Analysis overview** i titelraden (en ikon med fyra rutor, först bland
knapparna till höger, före *Verify*) öppnar fönstret igen när det har stängts, när som helst och även när det är
avslaget, med vad analysen av filerna nu säger; utan filer (ingen fil öppnad, ingen cartridge) är den grå.
Kommandopaletten har samma sak som *Show the analysis overview*. Vad korten säger räknas fram i
`apps/desktop/src/lib/overview.ts` och läggs ut i
`components/Overview.tsx`. E2E-testerna börjar med översikten av (fixturen sätter valet och laddar om fönstret), så att
den inte täcker fönstret när de öppnar filer; dess eget test slår på den.

### 14.2 Visuellt språk

Mörkt, grafitgrått tema med en accent hämtad från C64:ans ljusblå (`#8b80f9` i mörkt läge). Blocktyper har fasta färger i alla vyer (gutter i listningen, heatmap, chips, legender): kod blå, grafik orange, musik turkos, tabeller gul, text magenta, BASIC violett, data och fyllnad neutrala. Typsnitt: IBM Plex Sans för gränssnittet, JetBrains Mono för kod, Silkscreen för logotypen.

```js
// tailwind.config.js — tokens från styles/tokens.css
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      bg: 'var(--bg)', panel: 'var(--panel)', editor: 'var(--editor)', line: 'var(--line)',
      fg: { DEFAULT: 'var(--fg)', 2: 'var(--fg-2)', 3: 'var(--fg-3)' }, accent: 'var(--accent)',
      kind: { code: 'var(--g-code)', gfx: 'var(--g-gfx)', music: 'var(--g-music)', table: 'var(--g-table)',
              text: 'var(--g-text)', basic: 'var(--g-basic)', data: 'var(--g-data)', fill: 'var(--g-fill)' },
    },
    fontFamily: { ui: ['IBM Plex Sans', 'system-ui'], code: ['JetBrains Mono', 'monospace'] },
  } },
};
```

### 14.3 Monaco-integration

- Språket `tass64` (Monarch) för ett projekt skrivet för 64tass (11.8): `;`-kommentarer och `.comment`, 64tass direktiv och funktioner, etiketter i början av raden, `@w`/`@b`, mnemonics med 64tass namn. Hover och gå till definition gäller båda språken (i 64tass också `namn = värde` och `namn .namespace`); ett skript i 64tass har också förslagen och glödlampan (*Also write into a scratchpad*) i sitt språk.
- Språket `kickass` (Monarch): kommentarer, `#import`, direktiv (`.pc`, `.byte`, `.word`, `.text`, `.fill`, `.label`, `.var`, `.encoding`, `.macro` …), makron (`BasicUpstart2`, `LoadSid`), etikettdefinitioner, dokumenterade och odokumenterade mnemonics (olika färger), hårdvarusymboler, tal (`$`, `%`, decimal), strängar, `#<`/`#>`.
- **Hover:** hårdvaruregister visar adress och beskrivning; etiketter visar adress, blocktyp och antal referenser.
- **Gå till definition** (Ctrl+klick, F12) på etiketter.
- **Synk:** markören i listningen markerar motsvarande rad i Monaco och tvärtom — möjligt eftersom båda bygger på samma `Line[]`.
- Källkoden är skrivskyddad i v1; redigering sker i listningen så att projektet förblir sanningskällan. **Planerat:** "detach"-läge där exporterad källkod redigeras fritt och fil-watchern bygger om.

### 14.4 Tillgänglighet

Synlig fokusmarkering, tangentbordsnavigering överallt, `aria`-etiketter på ikonknappar, färg är aldrig enda bäraren av information (blocktyp står också i text och tooltip), `prefers-reduced-motion` respekteras, kontrast ≥ 4,5:1 för text i båda teman.

### 14.5 Grafikvyn (Graphics)

Fliken **Graphics** (även kommandopaletten) ritar hela minnet, oavsett vilka block analysen eller användaren satt, för
att man ska hitta grafik med ögonen, som i ICU64. Geometri och ritning ligger i `src/lib/gfxview.ts` och testas i
`test/gfxview.test.ts`. **Lägesraden** överst (`ViewModes`, gemensam med Memory) har en knapp per läge med ikon och cellens storlek (*8×8*,
*24×21*, *320×200*, *40×25*). Det valda läget är ifyllt med accentfärgen, och bredvid står lägets namn med vad vyn
visar (*Sprites · 64 bytes each · 8 a row · hires · 2×*). Där står också *Go*-fältet. Under den ligger inställningarna i
grupper med rubrik: *Fonts* (Font per row), *Layout* (per rad eller höjd, zoom, förskjutning), *Characters* (Screens) och
*Colours*. I en smal editor döljs först storlekarna och sedan knapparnas namn (ikonerna och raden bredvid står kvar).

**Samma adresser i alla lägen:** adressen överst i bilden, dit man scrollat eller gått med *Go*, står kvar överst när
man byter läge, antal per rad eller zoom. Raden med den adressen hamnar överst, och i Bitmaps är det den 8 KB-ruta den
ligger i. Adressen följer bara ens egen scrollning, så Characters → Bitmaps → Characters hittar samma teckenrad igen.
Font per row har fonter i stället för adresser och lämnar den orörd. När fliken öppnas börjar den där listningen eller
Memory stod (14.6b), eller vid markören (eller markeringen) när ett hopp är nyare. En fil som just öppnats eller lagts
till från en laddares skript eller bandet (Spindle, Bitfire, Booze, Sparkle, Pirate Slayer, Tape) går före båda: dess
första byte står i översta raden, genast om fliken är öppen och annars när den öppnas, så att man kan bläddra genom
lägena och se vad filen är. Ett läge där raden börjar före filen (40 tecken à 320 byte) har filens första byte i raden,
inte radens början: Characters → Screens med en fil på `$3000` ger skärmen på `$3000`, inte den på `$2c00`.

Det finns fem lägen:
- **Characters:** 8 byte per tecken, 16, 32, 40 (standard, en skärms bredd) eller 64 per rad. Med *Other…* skrivs
  vilket antal som helst från 1 till 128 in. `Enter` eller att lämna fältet tar det, och piltangenterna stegar det. Ett
  sparat 32, den tidigare standarden, blir 40 en gång (`GfxPrefs.v` 2). Ett annat valt antal behålls.
- **Sprites:** 64 byte per sprite, 24 × 21 pixlar, 4, 8 eller 16 per rad.
- **Bitmaps:** en ram på 320 × 200 (8000 byte) per 8 KB. *Rows* och *Columns* (första och sista teckenrad 0–24 och
  kolumn 0–39, räknade som VIC räknar dem, standard hela bitmappen) ritar bara den delen av varje bitmapp, för en bild
  som är mindre än skärmen: en logga, eller en liten del mitt i skärmen där resten av bitmappens minne används till
  annat (en rastersplit, kod i kolumnerna bredvid). Fälten skrivs in (`Enter` eller att lämna fältet tar dem),
  piltangenterna och mushjulet stegar dem, en första rad efter den sista tar den sista med sig (och tvärtom), och ett tal
  utanför gränserna blir rött och tas inte. *All* bredvid ritar hela bitmappen igen. En teckenrad är 8 pixelrader och
  320 byte, en kolumn 8 pixlar och 8 byte, så rad 8–15 och kolumn 10–29 ger ramar på 160 × 64. Delens byte ligger kvar
  där de är i bitmappen: pixeln överst till vänster är rad 8, kolumn 10. Ramarna ligger kvar en per 8 KB, och det som
  ligger utanför delen ritas inte. Ett klick väljer då delens byte från dess första till dess sista (`$4a50-$53af`), och
  `Shift`+klick eller dragning väljer från den första ramens del till slutet av den sista ramens. Lägesknappen visar
  cellens storlek (*160×64*), raden bredvid hur många byte som ritas och delens storlek (*1280 bytes each · 8 rows × 20
  columns*), och under vyn står teckenrad och kolumn i bitmappen (`row 8, column 10 of the bitmap at $4000`), så att man
  ser var bilden börjar och slutar. Adressen överst står kvar när delen byts. En PNG blir delens storlek per ram, och en
  Koala- eller Art Studio-bild och *Add to library* tar bitmappens 8000 byte med bara delens byte i (resten 0), så att
  bilden visar det som ritas. Delen sparas med de andra valen (`GfxPrefs.bitmapTop`, `bitmapRows`, `bitmapLeft`,
  `bitmapCols`, `lib/gfxview` `BitmapWindow`), och ett sparat värde som inte får plats blir det som får plats: en första
  rad eller kolumn utanför bitmappen blir 0, för många rader eller kolumner blir resten från där (`bitmapWindowOf`). Ett
  äldre sparat `bitmapRows` utan de andra är de raderna från toppen, hela bredden. `Shift`+klick på ett bitmappsblock i
  Blocks ritar det från blockets början med hela bredden, så högt som det är. Är delen smalare än bitmappen markerar
  *Mark as* (Bitmap, Charset, Sprite data) bara de byte som ritas: en sträcka per teckenrad, var och en ett eget block,
  i ett enda ångra-steg, så att byten mellan dem (kod bredvid en logga) behåller sina typer (`windowPieces`, App
  `markPieces`). Knappens tooltip säger hur många sträckor det blir. Lika bred som bitmappen är raderna en enda sträcka,
  markeringen. Test: `apps/desktop/test/gfxview.test.ts` (*a part of each bitmap*) och e2e-testet *a part in the middle
  of a bitmap*. *Mark as Bitmap* på färre rader ger ett block av just de
  raderna, även där VIC visar en hel bitmapp. Resten av den blir ett eget bitmappsblock (`$4c80-$5f3f`), som
  VIC-evidensen säger. Förut gick användarens markering vidare över de byte efter den som VIC-evidensen gett samma typ,
  så 10 rader blev 8000 byte igen. Det gäller all grafik användaren markerar (sprites, teckenuppsättningar, bitmappar,
  skärmar): blocket slutar där markeringen slutar (`classify`, referensens avvikelselista). Test:
  `packages/core/test/bitmap-labels.test.ts` och e2e-testet *a bitmap of fewer rows marked where the VIC shows a whole one*.
- **Screens:** en skärmmatris per 1 KB, som VIC placerar dem: 40 × 25 skärmkoder (1000 byte), 1, 2 eller 3 per rad. Varje
  skärmkod ritas med en teckenuppsättning som väljs i *Charset*:
  - **C64 ROM, upper case / lower case:** VICE:s tecken-ROM (4 KB). Den läses från den VICE som står i inställningarna
    (`vice:chargen`: mappen `C64` bredvid `bin`, eller bredvid programmet, `chargen-901225-01.bin` eller `chargen`).
    ROM:en följer aldrig med appen. Saknas den ritas de inbyggda tecknen, och valet säger *(not found)* och var den letades.
  - **Built-in letters and digits:** demons font på sina skärmkoder (@, A–Z, mellanslag till ?), med kod 128–255 inverterade.
    Grafiktecknen är tomma.
  - **Charsets found:** teckenuppsättningar som analysen eller användaren har satt.
  - **2 KB of memory at:** vilken 2 KB-gräns som helst i minnet.

  En skärm kan ligga var som helst i ett program (en titelbild som kopieras till `$0400`, till exempel). Därför flyttar *Go* i
  det här läget rutnätet så att en skärm börjar där man går till (*Offset* visar hur mycket). Under vyn står rad och
  kolumn i skärmen och, för en skärm på en 1 KB-gräns, `$d018`-värdets höga nibble och VIC-banken
  (`$d018 = $1x in VIC bank 0`).

  **`Ctrl` över en skärm** visar den ensam över hela fönstret, så stor den får plats i 320:200, tills `Ctrl` släpps
  (`CellFocus` i `MemoryGfx.tsx`, `cellLayout`). Det är skärmen under pekaren när `Ctrl` trycks ner, efter 150 ms som
  listningens titt så att `Ctrl+Z` och liknande inte blinkar fram den, eller den pekaren kommer in på med `Ctrl` nere.
  Den ritas som vyn ritar den, med byte som inte är laddade mörka, men i sina egna färger utan den orange tonen för
  markerad grafik. Under den står adresserna, `$d018`-värdet och blocket. Mushjulet stegar till skärmen före eller efter
  (i läsordning, med alla banker över en banks slut, `stepCell`) och zoomar inte fönstret. Ett klick väljer skärmen som
  visas, och `Esc` stänger den utan att markeringen går. En annan tangent med `Ctrl` (`Ctrl+C`) är tangentens: skärmen
  går och kommer inte tillbaka förrän `Ctrl` släppts. Pekaren går igenom den till vyn under, och ett annat läge eller
  rutnät stänger den. Test: `test/gfxview.test.ts` (en skärm för sig, stegen) och e2e-testet *Ctrl over a screen in
  Graphics shows it alone over the whole window*.
- **Font per row:** en bild där varje teckenrad har sin egen font (256 tecken, 2 KB), som när programmet byter
  teckenuppsättning (`$d018`) på varje teckenrad. Alla rader visar samma 40 skärmkoder, skärmens första rad, så det är
  fonterna som avgör vad som syns. Raderna tar en font var 2 KB från *First font* (`fontRowStarts`, `fontRowsLayout`):
  - *Screen codes:* adressen till de 40 koderna (hex eller etikett), eller ett block ur rullmenyn bredvid. Menyn listar
    analysens block efter typ, de typer koderna oftast finns i först (skärmmatris, text, data, tabeller …) och kod sist,
    med etikett och storlek (`$0985 txt_0985 · 48 bytes`), och `$0400` (C64:ans skärm) när inget block börjar där. En
    adress som inte är ett blocks start visar *Blocks…*. Pilarna bredvid menyn (*Previous block* / *Next block*), mushjulet
    över den och `↑`/`↓` när den har fokus stegar ett block i taget i menyns ordning. Från en adress utanför listan går
    nedåt till det första blocket och uppåt till det sista. Är koderna inte laddade, till exempel för att skärmen fylls när
    programmet körs, används koderna 0–39 och vyn säger *not loaded: 0–39*.
  - *First font:* fonten för den första raden (hex eller etikett, vilken adress som helst).
  - *Rows:* 1–25. Rader som skulle börja efter `$ffff` tas inte med.
  - *Skip where no font can be* (på som standard): 2 KB där ingen font kan ligga hoppas över, och raden tar nästa 2 KB
    (`NO_FONT`). Det gäller 2 KB som rör:
    - `$0000–$07ff`: nollsidan, stacken och skärmen;
    - `$1000–$1fff` och `$9000–$9fff`: VIC ser tecken-ROM:en där (i bank 0 och 2), inte RAM;
    - `$d000–$dfff`: I/O och färg-RAM.

    RAM under BASIC- och Kernal-ROM:en (`$a000–$bfff`, `$e000–$ffff`) hoppas inte över, för VIC läser alltid RAM där.
    Vyn säger vilka som hoppades över (*skipped $1000, $1800*). Ligger *First font* där ingen font kan vara börjar bilden på
    nästa möjliga. Från `$3000` får 22 rader plats före `$ffff`, eftersom `$9000`, `$9800`, `$d000` och `$d800` hoppas över.

  En cell är en rad, alltså dess font. Ett klick väljer radens font (2 KB), och *All N rows* väljer alla fonterna (från den
  första till den sista, med det som hoppades över emellan). Under
  vyn står rad, kolumn, tecknet och fonten (`row 0, column 0: char $08 of the font at $3000`) och adressen till
  teckenraden under pekaren. *Mark as Charset* sätter blocktypen för fonterna. Vänsterkanten visar varje rads font.

**Visning:** zoom 1–4×, hires eller multicolor (bitpar: BG, MC1, MC2, FG). Färgerna väljs ur C64-paletten. Slås
*Multicolor* på eller av med en markering i sprites, en charset eller en bitmapp av den typ vyn ritar (Sprites: Sprite
data, Chars och Font per row: Charset, Bitmaps: Bitmap; inte Screens), sparas det för de blocken, som inspektorns
*Multicolor*, och listningens bilder ritar dem likadant (`gfxMcChanges` i `apps/desktop/src/lib/gfxlines.ts`; en
inställning bara där VIC-registren säger annat, annars tas den bort så att blocket följer dem igen). Toasten säger det
(*Charset $3000–$37ff drawn multicolour in the listing too*), och `Ctrl+Z` tar tillbaka det. Utan markering, eller med
en markering utanför sådana block, är det bara vyns val. *Offset*
flyttar rutnätet byte för byte, för data som inte börjar på en cellgräns. Byte som inte är laddade ritas i en egen
blågrå ton. Byte i ett block som redan är grafik (Charset, Sprite data, Bitmap eller Screen matrix, satt av analysen
eller användaren) ritas tonade mot grafikens orange (`MARKED_TINT`, `--g-gfx`: varje färg 45 % av vägen dit, så svart
blir mörkt orange och vitt ljust), så att det som är kvar att hitta skiljer sig från det som redan är känt. Ett block
som markeras i vyn byter färg direkt, och `Ctrl+Z` tar tillbaka den. Rutan *Marked graphics* under *Colours* (på från
början, `GfxPrefs.marked`) slår av och på det. Sparade filer (PNG med flera) har alltid vyns egna färger (`drawMemory`
tar en `Shade` per byte: inte laddad, laddad eller grafik). Vänsterkanten visar adressen för varje rad och, med
blockgruppens färg, vad som redan är klassat där.

**Snapshotens färger.** Ett projekt som öppnades från en VICE-snapshot med en VIC-II-modul (13.7) ritas i de färger dess
VIC hade när VICE sparade den, så länge rutan **Snapshot's VIC** under *Colours* är ikryssad (bara med en snapshot; på
från början, `GfxPrefs.vicColors`). Varje vy får de färger VIC:en ritar den sortens grafik med (`vicGfxColors` i
`apps/desktop/src/lib/vicgfx.ts`):
- **Characters, Font per row och Screens:** BG `$d021`, MC1 `$d022`, MC2 `$d023` och FG den färg flest celler på
  VIC:ens skärm har i färg-RAM (multicolor: bit 0–2 hos cellerna som ritas multicolor).
- **Sprites:** BG `$d021`, spritens färg den som flest av de påslagna spritarna har (av dem som ritas som vyn, multicolor
  eller inte), och spritarnas multicolor `$d025`/`$d026`, i bitparen som `spritePairColors` lägger dem.
- **Bitmaps:** BG `$d021` och de färger flest celler på skärmen och i färg-RAM ger (multicolor: hög nibble, låg nibble,
  färg-RAM; hires: låg och hög nibble).
- **Skärmen och bitmappen VIC:en visade** ritas cell för cell i sina egna färger, som på C64:an (`vicCellColors`, som
  `drawMemory` och `gfxImage` tar som `CellColors`): bitmappen (i ett bitmappsläge) med varje cells skärmbyte och färg-RAM,
  multicolor eller hires som VIC:en ritade den, skärmen (i ett textläge) med varje cells färg-RAM över bakgrunden (med
  ECM den bakgrund koden väljer; i multicolor-text multicolor där färg-RAM har bit 3). Fönstret med en cell (Ctrl) och
  PNG:n som *Save…* skriver ritas likadant.

Väljs en färg i *Colours* ritas vyn i dina färger igen (rutan går ur, med den valda färgen och resten som VIC:ens). Bitmappen
VIC:en visade ritas med cellernas färger exakt som `vicScreen` ritar skärmen (`vicgfx.test.ts` jämför dem punkt för punkt).
Listningens bilder och inspektorn ritar som förut i flikens egna färger.
Under vyn står byten under pekaren, med teckennummer i sitt 2 KB-teckensnitt, spritepekare och VIC-bank, eller
rad och kolumn i bitmappen, samt blocket den ligger i. Valen sparas per användare.

**Markering:**
- Ett klick väljer en cell, och `Shift`+klick eller dragning väljer flera.
- *Go* tar en adress, en etikett eller ett intervall.
- Markeringen är listningens markering, så inspektorn och statusraden följer med.
- *Whole charset (2 KB)* utvidgar markeringen till VIC:s 2 KB. *Whole bitmap (8000 bytes)* tar de 8000 byte från början
  av rutnätets ram där markeringen börjar (med *Offset* följer den rutnätet). Har bitmapparna färre rader ritas de hela
  igen (*Height* blir 25) med den bitmappen överst, så att markeringen syns. *With the sprite pointers (1 KB)* tar med de
  24 byte efter en skärm (16 oanvända och de 8 spritepekarna), och *All N rows* alla fonterna i Font per row.
- Knapparna visas bara när de ändrar något. Ett klick på en hel bitmapp väljer redan alla 8000 byte, så då finns ingen
  *Whole bitmap*.
- *Mark as Charset / Sprite data / Bitmap / Screen matrix* sätter blocktypen (en override som `C`/`D`/…, ångras med `Ctrl+Z`). Vyns egen
  typ ligger först. Charset, Sprite data och Bitmap tar med vyns *Multicolor* (utom i Screens, där byten är skärmkoder):
  blocket ritas i listningen som det såg ut här (`markMc`; en inställning bara där VIC-registren säger annat, och den
  går före inställningen hos ett block som *Auto merge* tar med). Toasten säger *(multicolour)*.
- *Unmark* (i alla lägen) gör grafiken i markeringen till data igen (Bytes, `.byte`), till exempel en charset som analysen
  hittade där det inte finns någon (`gfxToData`). Bara grafikblocken (Charset, Sprite data, Bitmap, Screen matrix) och
  bara deras byte i markeringen blir data; delen av ett block utanför markeringen behåller sin typ (`keepCutTypes`), och
  det som inte är grafik (kod, fill, text …) lämnas som det är. Grafikblock som ligger kant i kant i samma fil blir ett
  datablock. *Auto merge* tar med datablocken före och efter, som *Mark as Bytes*. Det är en data-override, inte en
  borttagen override, så analysen hittar inte grafiken igen; `Ctrl+Z` tar tillbaka den. Knappen är grå när inget i
  markeringen är grafik, och dess title räknar upp blocken. Toasten säger vad som blev data (`$3000–$37ff is data now
  (was Charset)`, eller `2 stretches of graphics in $2000–$3f3f are data now (were Sprite data, Charset)`).
- *Show in listing* och dubbelklick går till platsen i listningen. `Esc` tar bort markeringen.

**Spara (*Save…*):** markeringen sparas med en spara-dialog (`file:save`) i ett av dessa format:
- **Raw bytes (.bin):** bytena som de är.
- **With its load address (.prg):** laddadressen först, så att `LOAD"…",8,1` lägger tillbaka den. För tecken heter det
  *Charset with its load address (.64c)*.
- **Koala Painter (.kla) och Art Studio (.art)**, bara för bitmappar (vyns läge först):
  - Koala: `$6000`, bitmappen, skärmmatrisen (`%01` hög och `%10` låg nibble), färg-RAM (`%11`) och bakgrunden, 10003 byte.
  - Art Studio: `$2000`, bitmappen, skärmmatrisen (satta bitar hög nibble), ramfärgen och 6 byte utfyllnad, 9009 byte.
  - Färgerna är vyns: en uppsättning för hela bilden. En kortare markering fylls ut med nollor.
- **Image as shown here (.png):** markeringen ritad som i vyn men utan mellanrum (`gfxImage`). Tecken ligger 16 per rad och
  sprites 8 per rad, en bitmapp blir 320 × 200 (eller vyns *Height*, en ram per 8 KB under varandra), en skärm också (ritad med vyns teckenuppsättning, en per 1 KB, under
  varandra), de valda raderna av en font-per-rad-bild som 320 × 8 per rad, och multicolour-pixlar är två breda. Celler efter markeringens slut är
  genomskinliga.
- **Kick Assembler source (.asm):** en kommentar, en etikett och `.byte`-rader formade efter grafiken (`gfxSource`):
  - tecken som en binär byte per rad, åtta rader per tecken, så att formen syns;
  - sprites som tre binära byte per rad, med 21 rader, utfyllnadsbyten och spritepekaren i kommentaren;
  - bitmappar i hex, åtta per rad (en cell);
  - skärmar i hex, en skärmrad med 40 koder per rad, och de 24 byte efter de 1000 på en egen rad (*then 16 unused bytes and
    the 8 sprite pointers*);
  - fonterna i en font-per-rad-bild som tecken.

En skärm sparas som rå bytes, med laddadress (.prg), som bild eller som källkod. Den har inget eget bildformat som Koala.
Filen får blockets etikett när markeringen börjar ett block, annars `charset_`/`sprites_`/`bitmap_`/`screen_`/`fonts_` och
adressen.
`packages/core/src/c64/gfxfiles.ts` har formaten. `test/gfxfiles.test.ts` kontrollerar bilderna och assemblerar
källkoden till samma bytes, med den inbyggda assemblern och med riktiga KickAss.jar (showcasens sprites och
teckenuppsättning). E2e-testet sparar en teckenuppsättning (.bin, .64c, .asm), en sprite (.png, 24 × 21) och en bitmapp
(.kla med vyns färger). Ett annat e2e-test går till texten vid `$0985` i läget Screens och sparar den som .bin, .prg,
.png (320 × 200) och .asm (25 rader). Ett tredje ritar *Font per row* med koderna i `txt_0985` och fonterna från `$3000`,
väljer en rad och alla rader och sparar en rad som .png (320 × 8). Ett fjärde visar Bitmaps med *Height* 10: utan
*Whole bitmap* för en hel bitmapp, ramar på 320 × 80 och klick som väljer 3200 byte, rad och kolumn under pekaren och
ingen byte under raderna, en .png på 320 × 80 och höjden sparad, och *Whole bitmap* som väljer 8000 byte och ritar 25
rader igen med den bitmappen överst. `test/gfxview.test.ts` prövar höjdens geometri, ritning och bild.

### 14.6 Minnesvyn (Memory)

Fliken **Memory** (även kommandopaletten) visar det laddade minnet som VICE-monitorn skriver ut det
(`packages/core/src/c64/monitor.ts`, `src/components/MemoryDump.tsx`). Lägesraden är densamma som i Graphics: *Hex and
text*, *PETSCII* och *Screen codes*, var och en med monitorns kommando som en tangent (`m`, `i`, `ii`), och bredvid vad vyn
visar (*Hex and text · 16 bytes a row · upper case*), kommandofältet och *Copy*. Under den grupperna *Layout*, *Text* och
*Find*:
- **`m`**: en rad är `>C:0801  0b 08 0a 00  9e 32 30 36  34 00 00 00  00 00 00 20   .....2064...... `, alltså adressen,
  bytena i hex i grupper om fyra och samma byte som PETSCII-text. En kort sista rad fylls ut så att textkolumnen står kvar.
- **`i`**: samma rad som `m`, med texten som PETSCII.
- **`ii`**: samma rad som `m`, med `*C:` först och texten som skärmkoder. `$80-$ff` visas inverterade:
  `*C:0985  08 05 0c 0c  0f 20 06 12  0f 0d 20 14  08 05 20 0d   HELLO FROM THE M`.

Alla tre lägena ser alltså likadana ut, och bara textkolumnen skiljer (VICE:s egna `i` och `ii` visar bara texten, 40
byte per rad). *Per row* under *Layout* väljer hur många byte en rad har, i alla lägen: 8 (som i en 40-kolumnsmonitor),
16 (VICE:s `m`, förvalt), 32, 40 (VICE:s `i` och `ii`) eller 64 (`MONITOR_PER_ROW`). Valet sparas, och en byte står kvar på
samma rad när man byter läge. En rad som är bredare än vyn scrollas i sidled.

VICE skriver textkolumnen som bytena själva och låter monitorns C64-typsnitt rita dem. Här blir en byte det tecken C64:an
visar (`monitorChar`), i teckenuppsättningen med versaler och grafik eller, med *Lower case*, den med gemener. `£ ↑ ← π`
finns med. Styrkoder och grafiktecken skrivs som `.`. Raderna börjar där varje laddat område börjar. Mellan områdena står en
rad om minnet som inte är laddat.

**Kommandon:** fältet tar VICE:s egna kommandon: `m 0801 08ff`, `i 0801`, `ii 0400 07e7`, en adress eller en etikett (med
eller utan `.`), och `0801-08ff`. Slutet räknas med, som i VICE. Kommandot byter läge, börjar raderna på sin adress som VICE
gör (raden före blir kortare) och markerar intervallet eller sätter markören.

**Sök** (verktygsradens andra rad, `Ctrl+F` i dumpen) letar i det laddade minnet (`findInMemory`):
- **Text** jämförs med tecknen som dumpen visar, i den valda teckenuppsättningen, utan hänsyn till skiftläge och
  inverterade tecken. Den hittas både som PETSCII och som skärmkoder. Siffror och tecken som är lika i båda räknas som en
  träff (*PETSCII and screen codes*).
- **Bytes** är hexpar: `a9 00 8d`, `$a9,$00` eller `a9008d`, med `??` för vilken byte som helst. Det som inte är en byte ger
  ett fel i rött.

Varje träff färgas i både hex- och textkolumnen. En träff går aldrig över slutet av ett laddat område, och sökningen
stannar efter 5000 träffar. `Enter` (eller ↓, och `F3` i dumpen) går till nästa träff efter markören och `Shift+Enter`
(↑, `Shift+F3`) till den före. Träffen markeras, så den kan markeras som text, skärmkoder, data eller kod direkt.
Statusen säger vilken träff det är och hur den matchade (*1 of 2 matches · PETSCII*). `Esc` tömmer fältet.

**Markör och markering** delas med listningen:
- Ett klick på en byte, i hexkolumnen eller textkolumnen, sätter markören där.
- `Shift`+klick eller att dra markerar, och piltangenterna flyttar (med `Shift` växer markeringen).
- Ett dubbelklick visar byten i listningen.
- `0` (eller knappen *Select to the next 0*) markerar från markören till 0-byten som avslutar texten, och 0:an räknas med,
  som i analysens textblock. Med en markering går den från markeringens början, och 0:an söks efter markeringens slut,
  så att ett `0` till tar med nästa text också (en tabell med nollavslutade texter, en i taget). Sökningen stannar där det
  laddade området slutar, och finns ingen 0 före det säger en rad i rött det (*No 0 byte from $37fe on before the loaded
  bytes end.*) och markeringen står kvar (`nextZero` i `monitor.ts`).
- En markering kan markeras som text, text i skärmkoder, bytes eller kod härifrån. Med *Lower case* blir texten blandad
  (`petscii_mixed`, `screencode_mixed`), som dumpen visar den.
- `Enter` markerar markeringen som den text vyn visar: skärmkoder i `ii`, annars PETSCII (knappen som är framhävd).
  Texten, med Enter eller med en av textknapparna, får sitt första ord som etikett (`textLabel` i `monitor.ts`): de första
  bokstäverna och siffrorna som dumpen visar dem, med gemener och högst 16 tecken (*PRESS FIRE* → `press`). Ett ord som
  Kick Assembler inte tar som etikett, för att det börjar med en siffra, är en mnemonic eller ett av `true`, `false`,
  `null`, `var` och `const` (uppmätt med KickAss.jar), får `txt_` först (`txt_1985`, `txt_and`). Har en annan adress eller
  en nollsidevariabel redan namnet får det `_2`, `_3` … sist, inom de 16 tecknen. En etikett som du själv har gett
  adressen står kvar, och en text utan bokstäver och siffror behåller `txt_<adress>`. Markeringen och etiketten är ett
  ångrasteg.

**Kopiera:** *Copy selection* / *Copy all* lägger raderna på urklipp som vyn visar dem (`monitorText` med `hex`), med lika
många byte per rad och raderna från markeringens början; i `m` med 16 per rad är det exakt det VICE skriver. Raden under vyn beskriver byten under musen eller vid markören: värdet i hex, decimalt och binärt,
tecknet som PETSCII och som skärmkod, och blocket. *Block colours* färgar byten efter blockets typ som i minneskartan.

**Test:** `packages/core/test/monitor.test.ts` kör riktiga x64sc 3.10 (`-console`, egen konfigurationsfil, `logname`/`log on`
i monitorn), som laddar demon och skriver `m 0801 08ff`, `i` och `ii`. Radadresserna och hexkolumnen ska vara exakt de VICE
skriver, och textkolumnen bytena själva. Ett eget test skriver `i` och `ii` med hexkolumnen och 8, 16, 40 och 64 byte per
rad. E2e-testet går igenom `m`, `i` och `ii` (`ii` med hex och skärmkoder, 64 per rad), markören, piltangenterna, ett kommando,
*Copy selection*, *Mark as Bytes*, `Enter` som markerar en text med sitt första ord som etikett och dubbelklicket till
listningen.

### 14.6b Flikarna följer varandra i minnet

Listningen, Graphics och Memory visar samma minne på tre sätt, och den flik man byter till börjar där man var i den förra
(`ViewAt` i `src/lib/types.ts`). Varje flik säger när den scrollas vilken adress som står överst och vilken som står
nederst. Listningen tar sin översta rad (och sin exakta scrollposition), Graphics sin översta bildrad och Memory sin
översta monitorrad. Fliken som öppnas sedan ställer den adressen överst: listningen med adressens rad och dess etiketter och
kommentarer, Graphics med raden som har adressen, Memory med monitorraden. En adress som inte är laddad (en mörk rad i
Graphics, en rad om minne som inte är laddat) ger listningen närmaste laddade adress i samma bank, först efter den. Stod
markören på skärmen i den förra fliken kommer den med på skärmen i den nya.

- **Tillbaka utan att ha scrollat:** fliken man kom från säger ingenting när den bara öppnas, så listningen → Memory →
  listningen står exakt där den stod, så länge listningens rader är desamma (samma analys och veckningar). Det gäller
  också vägen över källan och SPEC.md.
- **Ett hopp är nyare:** har markören flyttats med ett hopp (*Go to*, en länk, Explorer, Bookmarks, ett klick i Memory,
  *Show in listing*) efter att fliken scrollades, börjar nästa flik vid markören som förut.
- **En fil från en laddare:** en fil som öppnas eller läggs till från Spindle-, Bitfire-, Booze- eller Sparkle-skriptet,
  Pirate Slayer eller Tape ställs överst i Graphics (14.5), genast om fliken är öppen och annars nästa gång den öppnas,
  före det listningen eller ett hopp säger. När Graphics har visat den säger fliken var den står, som när den scrollas,
  så listningen och Memory öppnas sedan där.
- **Banker:** med en cartridge (13.9b) visar Graphics och Memory banken där listningen står: markörens bank när markören
  är på skärmen, annars den översta radens. Är listningen scrollad in i bank 1 med markören kvar i bank 0 öppnar Memory
  alltså bank 1 där, och markören står kvar. Ett hopp och bankväljaren tar vyerna till sin bank. Med All banks står
  vyerna på samma bankadress som listningen, bland alla banker, och den bank de säger sig vara i är markörens när
  markören är på skärmen.

**Test:** e2e-testet på `fixtures/vsf/raster-demo.vsf` (allt RAM från `$0200` laddat) scrollar Graphics till `$7d00` och
öppnar listningen där, scrollar listningen vidare och öppnar Memory och Graphics där, går tillbaka från en flik som inte
scrollats till exakt samma scrollposition och låter ett klick i Memory vinna. Cartridge-testet scrollar listningen in i
bank 1 och öppnar Memory i bank 1.

### 14.7 Showcase-demon (Demo)

**Demo** i Explorer (och *Load the showcase demo* i kommandopaletten) öppnar `showcaseProject()`
(`packages/core/src/showcase.ts`). Programmet byggs från källkod med verifierarens assembler, liksom `makeDemo()`, och blir
`mimir-showcase.prg` ($0801–$613F). I VICE är det ett litet intro:
- en multicolor-bitmapslogga (MIMIR) i VIC-bank 1 ovanför en textskärm i bank 0, med rasterstreck i övre och nedre ramen;
- åtta multicolor-sprites, en skuggad boll i fyra bilder, som rör sig på tre sätt (SPACE byter, och efter 256 bilder byts det
  av sig självt);
- en färgvåg, en mjuk scroller och trestämmig musik (Am F C G). RESTORE stänger av och sätter på musiken.

Det har ett block av varje typ som analysen hittar: BASIC, kod, text (PETSCII via `$ab1e`/`$ffd2` och skärmkoder), bytes,
`.word`, färg- och kurvtabeller, lo/hi-tabeller, sprites, teckenuppsättning, bitmapp, skärmmatris, musik och fyllnad. Det har
också det analysen letar efter:
- tre rasteravbrott och en NMI;
- en `.word`-hopptabell (8.5) och självmodifierande kod;
- BIT-tricket och odokumenterade opkoder (LAX, DCP);
- en nollsidepekare, KERNAL-anrop och VIC-bankväxling.

Delningen mellan bitmapp och text kräver bankspårning (8.7), så Demo slår på den.

**Turen:** projektet har 15 bokmärken i adressordning. F2 går till nästa, Ctrl+B listar dem, och Demo öppnar bokmärkesvyn.
De förklarar vad koden gör och vad man kan prova i appen: F5 och F7, Cycles, Graphics, Memory (`ii`) och Pack. Huvud-
rutinerna har namn (`irq_top`, `move_sprites` och så vidare, som *set by you*). Det finns också några kommentarer och
kommentarrader, nollsidevariabeln `row_ptr` med kommentarer (10) och två blockkommentarer. Inget av det ändrar en byte.

Den första starten med en ny profil visar fortfarande raster-demon (`demoProject()`), som testerna bygger på.

**Test:** `test/showcase.test.ts`:
- varje blocktyp på sin plats, de spårade avbrotten och hopptabellen;
- round-trip, och turens bokmärken, namn och kommentarer i källkoden;
- att charset och bitmapp skiljs åt bara med bankspårning.

`test/kickass.integration.test.ts` bygger turprojektet med riktiga KickAss.jar, också med råa adresser. E2e-testet laddar
Demo, går igenom turen med F2, hittar alla blocktyper i Blocks-vyn och verifierar.

## 15. Prestanda

| Område | Budget | Teknik |
|---|---|---|
| Analys 64 KB | < 50 ms | Typade arrayer, O(n)-pass, worker |
| Render (linjemodell + text) | < 30 ms | Ett pass per block, strängar byggs en gång |
| Omdöpning | < 16 ms upplevd | Endast `render()` körs om |
| Listning | 60 fps | Virtualisering (20 px rader, ~60 synliga), memoiserade rader |
| Heatmap | < 5 ms | En `ImageData` 256 × 256, overlay-canvas för markering |
| Verifiering | < 200 ms (prototyp), < 2 s (KickAss.jar) | |

## 16. Teststrategi

| Nivå | Innehåll |
|---|---|
| Enhet | Alla 256 opkoder (längd, läge, flöde, kodning); BASIC-parsning; PSID-skrivning/läsning; symbolupplösning |
| Heuristik | Små syntetiska program per regel (IRQ-uppsättning, lo/hi-tabeller, BIT-skip, SMC, musik, `$D018`-varianter) med förväntade block och etiketter |
| Golden files | Korpus av riktiga PRG → förväntad `.asm`; diff vid ändring kräver granskning |
| Round-trip | Hela korpusen och fuzzning (fast-check): slumpade PRG, overrides och inställningar ska alltid ge byte-identisk utdata |
| Integration | Riktig KickAss.jar i CI (Java i containern); VICE headless (`-console -limitcycles`) för täckningsmätning |
| UI | Playwright for Electron: ladda PRG, döp om, markera, exportera, bygg |
| Prestanda | Benchmark per commit för analys/render på 64 KB-fall |

## 17. Roadmap

| Milstolpe | Innehåll |
|---|---|
| **M1 Kärna** | Opkoder, spårning, evidens, symboler, Kick-generator, verifierare, CLI, testkorpus |
| **M2 Desktop-MVP** | Electron-skal, listning, Monaco, inspektor, overrides, undo, export, KickAss-bygg, VICE-start |
| **M3 VICE live** | Binary monitor: brytpunkter, minnes-/registervy, dynamisk täckning, hot reload |
| **M4 Strukturer** | Användardefinierade structs, makroigenkänning (upprepade kodmönster → `.macro`), lokala etiketter (`!loop:`), scopes per rutin |
| **M5 Format** | `.d64`-import, `.sid`-import (PSID/RSID), `.crt`, Koala/Art Studio-export av bitmappar |
| **M6 Fler mål** | Export till 64tass med skript och patchar i 64tass (klart, 11.8), ACME, ca65; plugin-API för egna heuristiker |

## 18. Risker och öppna frågor

| Risk / fråga | Åtgärd |
|---|---|
| Komprimerade/krypterade program ger lite att analysera | Entropidetektering och tydligt råd; M3-dynamisk analys kan dumpa uppackat minne från VICE |
| Kod som bara nås via beräknade hopp (RTS-trick, tabeller i ZP) | Diagnostik + "Mark as code"; dynamisk täckning i M3 |
| Skillnader mellan Kick Assembler-versioner | Generatorsyntax konfigurerbar; round-trip med användarens egen KickAss.jar avgör |
| Falska positiva i grafikheuristiken | Konfidensnivåer, förklaringar och förhandsvisning; overrides är billiga |
| Stora projekt med många filer | Analys per fil i worker-pool, delad symboltabell |
| Licens för symbolbeskrivningar och exempel | Egna formuleringar; inga ROM-dumpar distribueras |

## 19. Prototypen i den här filen

Den här HTML-filen är en körbar arkitekturprototyp av renderern och kärnan:

- **Fungerar på riktigt:** 6502/6510-disassemblering med alla odokumenterade opkoder, rekursiv spårning, konstantpropagering, IRQ-vektorer, hopptabeller, BIT-skip, SMC, musik- och grafikdetektering, dataklassificering, symboler, interaktiv omdöpning, kommentarer, mark-as, ångra/gör om, heatmap, grafikförhandsvisning, korsreferenser, statistik, Monaco med Kick Assembler-språk, round-trip-verifiering, ZIP-export med byggskript, projektfiler.
- **Simulerat:** att starta KickAss.jar och VICE kräver desktop-appens huvudprocess. Här visas exakta kommandon och den inbyggda verifieraren ersätter KickAss.jar.
- **Prova:** demoprogrammet laddas automatiskt, och *Demo* i Explorer öppnar showcasen med en guidad tur (14.7). Öppna egna `.prg` med *Open* eller dra in dem. Tryck `N` på en etikett, `C`/`D`/`T` för att ändra typ, `F7` för att verifiera och *Export* för ett komplett Kick Assembler-projekt.
