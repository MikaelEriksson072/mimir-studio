/* Projects: a project is a folder of its own, named after it, with its project file `<name>.mimir.json` and what Mimir
 * writes for it in folders there. The main process and the renderer check a project's name the same way. */

/** the folders of a project for what Mimir writes: the Kick Assembler export, KickAss.jar's output, the packed file */
export const PROJECT_FOLDERS = { source: 'source', build: 'build', packed: 'packed' } as const;
export type ProjectFolder = keyof typeof PROJECT_FOLDERS;

/** the project file of a project called `name` */
export const projectFileName = (name: string): string => `${name}.mimir.json`;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** What is wrong with `name` as a project's (and its folder's) name, or null when it will do. */
export function projectNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the project a name';
  if (n.length > 80) return 'The name is longer than 80 characters';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) return 'A folder name cannot have < > : " / \\ | ? or *'; // eslint-disable-line no-control-regex
  if (/[. ]$/.test(n) || n === '..') return 'A folder name cannot end with a dot or a space';
  if (RESERVED.test(n.replace(/\..*$/, ''))) return `Windows keeps ${n} for a device`;
  return null;
}

/** a project's name, from the path of its project file */
export const projectNameOf = (file: string): string => (file.split(/[\\/]/).pop() ?? file).replace(/\.mimir\.json$/i, '').replace(/\.json$/i, '');
