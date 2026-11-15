/** A name for the files Mimir writes from a file's or a project's name (`<name>.asm`, `<name>.prg`, a project's folder):
 *  letters, digits, _ and -, every other run of characters one _. It never starts with a -: on the assembler's command
 *  line (build.bat, build.sh, the app's build) a source named -x.asm is an option (64tass refuses it, and the app's
 *  build refuses such a name), so a leading - goes, with the _ that stood for the spaces after it: Booze Design's
 *  "- THE DEMO -" is THE_DEMO_-. Nothing left: `fallback`. */
export const safeStem = (s: string, fallback: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^-[-_]*/, '') || fallback;

/** The name of file `i`'s source, without .asm: its name without the extension, as `safeStem` writes it (file0, file1 …
 *  without one). */
export const sourceStem = (fileName: string, i: number): string => safeStem((fileName || '').replace(/\.[^.]*$/, ''), `file${i}`);
