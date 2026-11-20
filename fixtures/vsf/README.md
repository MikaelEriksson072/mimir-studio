# VICE snapshot fixtures

`raster-demo.vsf` is a snapshot of `fixtures/prg/raster-demo.prg` running in x64sc 3.10. VICE stopped at a breakpoint
in its raster IRQ (`$08c7`). At that point the PC is `$08c7`, the IRQ vector `$0314` points to `$08b7`, and `$01` is
`$37`. It was made from the repository root with:

```bash
x64sc -config <a new, empty vice.ini> -default -console -sounddev dummy +confirmonexit -moncommands fixtures/vsf/make-raster-demo.mon -initbreak ready
```

It holds RAM and device state only, no ROM images. `-config` keeps VICE away from your own settings.

`packed-menu.vsf` is a snapshot of `fixtures/prg/packed-menu.prg` (the demo packed by `fakePack`, behind a wait for a key
at `$07f8` packed by `fakePack` again) in x64sc 3.10, stopped at a breakpoint at `$07f8`, where the program waits for a
key with the demo still packed at `$090e-$390c`. Sindri goes on from it, presses a key and unpacks the demo. It was made
from the repository root with `-moncommands fixtures/vsf/make-packed-menu.mon` and otherwise the same command line.

`vic-sprites.vsf` and `vic-bitmap.vsf` hold a VIC-II set up by `make-vic.asm` (scenes 1 and 2), saved by x64sc 3.10
with the screenshot VICE took at the same moment (`vic-*.bmp`, 384 x 272, a 4-bit BMP whose colours are the C64's in
order). `vicscreen.test.ts` reads their VIC-II modules and draws their screens; the pictures must equal VICE's, pixel
for pixel. They were made from the repository root with:

```bash
java -jar KickAss.jar fixtures/vsf/make-vic.asm :scene=1 -o vic-sprites.prg
x64sc -config <a new, empty vice.ini> -default -console -sounddev dummy +confirmonexit -remotemonitor -autostart vic-sprites.prg
```

and, a few seconds later, the commands `dump "fixtures/vsf/vic-sprites.vsf"`, `screenshot "fixtures/vsf/vic-sprites.bmp" 0`
and `quit` sent to the remote monitor (port 6510). The same with `:scene=2` gives `vic-bitmap`.
