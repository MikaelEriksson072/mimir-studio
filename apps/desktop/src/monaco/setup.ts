/* Lazily imported by SourceView, DriveView and ScriptsView: Monaco is bundled locally (no CDN, spec 4.2) with only
 * the editor core, the languages the source view needs, and its editor worker. */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/bat/bat.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { registerKickAssembler } from './kickass-language';
import { registerProviders } from './providers';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/* Monaco stops its own pending work by rejecting it with a CancellationError (name and message 'Canceled'), and
 * Monaco itself ignores those. Some are promises nobody waits on, though: the word highlighter's 50 ms Delayer is
 * cancelled when its editor is disposed (the Scripts or Drive code tab closed) or given another model (Source showing
 * another file) right after a click or a cursor move, and the rejection would be reported as uncaught. They are
 * ignored here too, as VS Code does; an unhandled rejection the page cancels never reaches the console. */
window.addEventListener('unhandledrejection', e => {
  const reason: unknown = e.reason;
  if (reason instanceof Error && reason.name === 'Canceled' && reason.message === 'Canceled') e.preventDefault();
});

registerKickAssembler(monaco);
registerProviders(monaco);

export { monaco };
