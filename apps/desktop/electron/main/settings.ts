/* Toolchain settings (spec 13.1), stored as JSON in the user data folder. Only the main process
 * decides which executables run: the renderer can change them through settings:set, but the paths
 * are validated here and builds always read them from this store. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, TOOLCHAIN_KEYS, type ToolchainSettings } from '@mimir/core';
import { find64tass, findExomizer, findKickAssJar, findVice } from '@mimir/core/node';
import { toolchainSettingsSchema } from './schemas';

/** the Exomizer the installer puts in resources\exomizer (vendor/exomizer), or null */
export function bundledExomizer(resources: string | undefined = process.resourcesPath): string | null {
  if (!resources) return null;
  const exe = join(resources, 'exomizer', process.platform === 'win32' ? 'exomizer.exe' : 'exomizer');
  return existsSync(exe) ? exe : null;
}

/** the 64tass the installer puts in resources\64tass (vendor/64tass), or null */
export function bundled64tass(resources: string | undefined = process.resourcesPath): string | null {
  if (!resources) return null;
  const exe = join(resources, '64tass', process.platform === 'win32' ? '64tass.exe' : '64tass');
  return existsSync(exe) ? exe : null;
}

export function defaultToolchainSettings(bundledExo: string | null = bundledExomizer(), bundledTass: string | null = bundled64tass()): ToolchainSettings {
  const base = Object.fromEntries(TOOLCHAIN_KEYS.map(k => [k, DEFAULT_SETTINGS[k]])) as ToolchainSettings;
  if (!existsSync(base.kickJar)) base.kickJar = findKickAssJar() ?? base.kickJar;
  if (!existsSync(base.vicePath)) base.vicePath = findVice() ?? base.vicePath;
  // the unpacker stays empty, which is Sindri, the built-in one; an external one (unp64) can be set in Settings
  if (!base.exomizerPath) base.exomizerPath = bundledExo ?? findExomizer() ?? '';
  if (!base.tassPath) base.tassPath = bundledTass ?? find64tass() ?? '';
  return base;
}

export class SettingsStore {
  private readonly file: string;
  private value: ToolchainSettings;

  constructor(dir: string, defaults: () => ToolchainSettings = defaultToolchainSettings, bundledExo: string | null = bundledExomizer(), bundledTass: string | null = bundled64tass()) {
    this.file = join(dir, 'settings.json');
    let stored: Partial<ToolchainSettings> = {}, raw: Record<string, unknown> = {};
    try {
      if (existsSync(this.file)) { raw = JSON.parse(readFileSync(this.file, 'utf8')); stored = toolchainSettingsSchema.partial().parse(raw); }
    } catch {
      stored = {}; raw = {}; // unreadable settings fall back to the defaults
    }
    this.value = { ...defaults(), ...stored };
    // Earlier installers came with unp64 and pointed the unpacker at it, once (`bundledUnpacker` in settings.json).
    // unp64 no longer comes with the app: when the setting is still that copy, Sindri takes over. An
    // unpacker the user picked is kept.
    if (typeof raw.bundledUnpacker === 'string') {
      if (this.value.unpackerPath === raw.bundledUnpacker) Object.assign(this.value, { unpackerPath: '', unpackerArgs: DEFAULT_SETTINGS.unpackerArgs });
      this.write();
    }
    // Exomizer: settings from before it was a setting get the default (the bundled one); one that is gone (an
    // uninstalled or moved copy) gives way to the bundled one. A path the user cleared stays empty.
    if (bundledExo && this.value.exomizerPath && !existsSync(this.value.exomizerPath)) this.value.exomizerPath = bundledExo;
    // 64tass the same way (settings from before 64tass have none: the defaults give the bundled one)
    if (bundledTass && this.value.tassPath && !existsSync(this.value.tassPath)) this.value.tassPath = bundledTass;
  }

  get(): ToolchainSettings {
    return { ...this.value };
  }

  set(patch: Partial<ToolchainSettings>): ToolchainSettings {
    const next = toolchainSettingsSchema.parse({ ...this.value, ...patch });
    this.value = next;
    this.write();
    return this.get();
  }

  private write(): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.value, null, 2));
  }
}
