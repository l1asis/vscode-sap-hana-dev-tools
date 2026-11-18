/**
 * Shared access to the repository `samples/` tree.
 *
 * `samples/broken/` holds intentionally invalid artifacts (#34). Every other sample is valid and
 * must stay free of syntax diagnostics, so the clean-sample sweeps walk with `includeBroken: false`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const REPO_ROOT = fs.existsSync(path.join(__dirname, '..', '..', 'package.json'))
  ? path.join(__dirname, '..', '..')
  : path.join(__dirname, '..', '..', '..');

export const SAMPLES_DIR = path.join(REPO_ROOT, 'samples');
export const BROKEN_SAMPLES_DIR = path.join(SAMPLES_DIR, 'broken');

/** Every file under `samples/`, sorted. `samples/broken/` is skipped unless `includeBroken`. */
export function walkSamples(opts: { includeBroken: boolean }, dir: string = SAMPLES_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!opts.includeBroken && path.resolve(full) === path.resolve(BROKEN_SAMPLES_DIR)) continue;
      out.push(...walkSamples(opts, full));
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

/** The VS Code language ID of a sample file, or `undefined` for docs and data files. */
export function sampleLanguageId(file: string): string | undefined {
  const base = path.basename(file);
  const ext = path.extname(base).toLowerCase() || (base.startsWith('.') ? base.toLowerCase() : '');
  if (!ext || ext === '.md' || ext === '.csv') return undefined;
  if (ext === '.sql') return 'hanasql';
  return ext.slice(1);
}

/** Repository-relative path with forward slashes (stable in messages on every OS). */
export function relativeToRepo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}
