# 64tass (bundled)

64tass 1.57.2900 (2022-11-05) by Zsolt Kajtar, the Turbo Assembler compatible cross assembler for the 65xx series.
`64tass.exe` is the unchanged Windows build of the release (`64tass-1.57.2900.zip` on SourceForge,
https://sourceforge.net/projects/tass64/). `64tass --version` prints `64tass Turbo Assembler Macro V1.57.2900`.

The installer puts this folder at `resources\64tass\` in the install folder. The app points Settings → Toolchain →
64tass at it (see `electron/main/settings.ts` and spec 11.8): Verify, Build & Run and Pack build a project written for
64tass with it.

64tass is free software under the GNU General Public License version 2 (`LICENSE-GPL-2.0`); parts of it are under the
LGPL 2.0 and 2.1 and my_getopt's license, which come along too. Its source code, the same release, is at
https://sourceforge.net/projects/tass64/files/source/ and in its SVN repository, https://svn.code.sf.net/p/tass64/code/trunk
(revision 2900).
