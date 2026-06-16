// scripts/lib/skipdirs.mjs — canonical directory-skip list, shared by the walk
// (analyze.mjs) and template detection (templates.mjs). Port of skipdirs.py.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_SKIP_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'vendor',
  'third_party', 'third-party', 'Pods', 'Carthage', 'bower_components', '.cxx',
  'build', 'dist', 'out', 'target', '.gradle',
  '.idea', '.vscode',
  '__pycache__', '.venv', 'venv', '.env', '.pytest_cache', '.mypy_cache',
  'test', 'tests', 'testsuites', 'androidTest', '__tests__',
  // Kotlin Multiplatform / Gradle test source-sets (laid out as src/<sourceSet>/);
  // these are not named plain "test", so without them KMP projects leak test code
  // into the map (okhttp leaked ~31% of decls). Names are reserved source-set ids,
  // never production package dirs, so bare-name pruning is safe here.
  'commonTest', 'jvmTest', 'jsTest', 'nativeTest', 'jvmAndroidTest', 'desktopTest',
  'androidHostTest', 'androidUnitTest', 'androidInstrumentedTest', 'androidDeviceTest',
  'appleTest', 'iosTest', 'macosTest', 'tvosTest', 'watchosTest',
  'linuxTest', 'mingwTest', 'wasmJsTest', 'wasmWasiTest',
  // Test/Mock/Sample/Demo trees are never part of the architecture map (the
  // viewer shows the core layers only), so they are pruned at the walk — they
  // must not flood layers, importance, or core selection. A leading "-" line
  // in .code-map/skip-dirs.txt un-skips any of these for a project that truly
  // ships them as first-party code.
  'mock', 'mocks', 'sample', 'samples', 'demo', 'demos', 'example', 'examples',
  'fixtures', 'testdata', 'testFixtures',
  // Android/Flutter/iOS bundle raw resources under assets/ — any source file
  // there is a scaffold/template/sample, never compiled code (e.g. vibeapp's
  // assets/templates/.../$packagename/MainActivity.java). Bare-name skip; a
  // "-assets" line in .code-map/skip-dirs.txt un-skips it for the rare project
  // that ships first-party code there.
  'assets',
  '.code-map',
]);

// Skipped only when they are real build output (beside a build manifest), so a
// source package literally named build/out/dist/target is not pruned.
export const OUTPUT_SKIP_DIRS = new Set(['build', 'out', 'dist', 'target']);

const BUILD_MANIFESTS = new Set([
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'pom.xml', 'build.xml', 'ivy.xml', 'Cargo.toml', 'package.json', 'build.sbt',
  'setup.py', 'pyproject.toml', 'setup.cfg', 'Makefile', 'makefile',
  'CMakeLists.txt', 'meson.build', 'BUILD', 'BUILD.bazel',
]);

/** Subset of `dirnames` to descend into. An OUTPUT_SKIP_DIRS name is dropped
 *  only when parentFilenames includes a build manifest. */
export function pruneDirnames(dirnames, skipDirs, parentFilenames = []) {
  const isBuildRoot = parentFilenames.some((m) => BUILD_MANIFESTS.has(m));
  const kept = [];
  for (const d of dirnames) {
    if (!skipDirs.has(d)) kept.push(d);
    else if (OUTPUT_SKIP_DIRS.has(d) && !isBuildRoot) kept.push(d);
  }
  return kept;
}

/** defaults + CLI extras + project file (.code-map/skip-dirs.txt). */
export function loadSkipDirs(projectRoot = null, extra = null) {
  const dirs = new Set(DEFAULT_SKIP_DIRS);
  if (extra) for (const s of extra) if (s) dirs.add(s);
  if (projectRoot != null) {
    const cfg = join(projectRoot, '.code-map', 'skip-dirs.txt');
    try {
      const text = readFileSync(cfg, 'utf8');
      for (let line of text.split('\n')) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        // strip a trailing inline comment: whitespace followed by '#'.
        // (a bare '#' with no preceding space stays part of the name, e.g. "c#proj")
        const c = line.search(/\s#/);
        if (c >= 0) line = line.slice(0, c).trim();
        if (!line) continue;
        if (line.startsWith('-')) dirs.delete(line.slice(1).trim());
        else dirs.add(line);
      }
    } catch { /* no file — ignore */ }
  }
  return dirs;
}
