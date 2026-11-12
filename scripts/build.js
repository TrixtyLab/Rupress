import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/**
 * Build pipeline for the server package.
 *
 * The Rust addon and the JavaScript layer are two halves of the same artifact, so
 * both are (re)generated on every build:
 *
 *   1. `cargo build` compiles the native module (debug or release profile).
 *   2. The compiled library is copied into `dist/index.node`.
 *   3. The JavaScript sources living in `src/js` are copied into `dist`.
 *
 * Because of step 3, `dist` is always a complete and reproducible package: running
 * `pnpm build:release` on a clean checkout produces exactly the same output as the
 * development build, and nothing that lives in `src` can be lost.
 *
 * Usage:
 *   node ./scripts/build.js [--release] [--target <triple>]
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const distDir = path.join(projectRoot, 'dist');
const jsSourceDir = path.join(projectRoot, 'src', 'js');

const isRelease = process.argv.includes('--release');
const profile = isRelease ? 'release' : 'debug';

/**
 * The name of the library produced by cargo on every platform.
 */
const LIBRARY_NAMES = {
  win32: 'server.dll',
  linux: 'libserver.so',
  darwin: 'libserver.dylib'
};

/**
 * The target triple requested for the compilation, when it is not the host one.
 */
function requestedTarget() {
  const flag = process.argv.find((argument) => argument.startsWith('--target='));

  if (flag) {
    return flag.slice('--target='.length);
  }

  const index = process.argv.indexOf('--target');
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return process.env.CARGO_BUILD_TARGET || null;
}

/**
 * The platform a target triple belongs to.
 */
function platformOf(target) {
  if (!target) {
    return process.platform;
  }

  if (target.startsWith('windows')) return 'win32';
  if (target.startsWith('linux')) return 'linux';
  if (target.startsWith('darwin')) return 'darwin';

  return process.platform;
}

/**
 * The name of the library for a platform.
 */
function libraryName(platform) {
  if (LIBRARY_NAMES[platform]) {
    return LIBRARY_NAMES[platform];
  }

  return platform === 'win32' ? 'server.dll' : 'libserver.so';
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * Compiles the Rust native module.
 */
function compileNativeModule(target) {
  const manifestPath = path.join(projectRoot, 'src', 'server', 'Cargo.toml');
  const targetFlag = target ? ` --target ${target}` : '';

  log(`Compiling Rust native module (${profile}${target ? `, target ${target}` : ''})...`);

  execSync(`cargo build --manifest-path "${manifestPath}"${targetFlag}${isRelease ? ' --release' : ''}`, {
    stdio: 'inherit',
    cwd: projectRoot
  });
}

/**
 * Locates the compiled library produced by cargo.
 */
function findNativeBinary(target, platform) {
  const name = libraryName(platform);
  const directories = target
    ? [
        path.join(projectRoot, 'target', target, profile),
        path.join(projectRoot, 'target', profile)
      ]
    : [
        path.join(projectRoot, 'target', profile),
        path.join(projectRoot, 'target', `x86_64-pc-windows-msvc`, profile),
        path.join(projectRoot, 'target', 'x86_64-apple-darwin', profile),
        path.join(projectRoot, 'target', 'x86_64-unknown-linux-gnu', profile)
      ];

  return directories
    .map((directory) => path.join(directory, name))
    .find((candidate) => fs.existsSync(candidate));
}

/**
 * Copies the compiled library into `dist/index.node`.
 */
function copyNativeBinary(binaryPath) {
  const targetPath = path.join(distDir, 'index.node');

  try {
    fs.copyFileSync(binaryPath, targetPath);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      // The previous module is still loaded by a running process: replace it anyway.
      const backupPath = path.join(distDir, `index.node.${Date.now()}.old`);
      fs.renameSync(targetPath, backupPath);
      fs.copyFileSync(binaryPath, targetPath);
      try {
        fs.unlinkSync(backupPath);
      } catch (_) {}
    } else {
      throw err;
    }
  }

  return targetPath;
}

/**
 * Removes leftovers of previous builds (stale `.old` binaries).
 */
function cleanStaleArtifacts() {
  if (!fs.existsSync(distDir)) return;

  for (const entry of fs.readdirSync(distDir)) {
    if (/\.old$/.test(entry)) {
      try {
        fs.unlinkSync(path.join(distDir, entry));
      } catch (_) {}
    }
  }
}

/**
 * Copies the JavaScript layer and the type declarations into `dist`.
 */
function copyJavaScriptLayer() {
  if (!fs.existsSync(jsSourceDir)) {
    fail(`JavaScript sources not found at ${jsSourceDir}`);
  }

  const files = fs
    .readdirSync(jsSourceDir)
    .filter((file) => file.endsWith('.js') || file.endsWith('.d.ts'));

  if (files.length === 0) {
    fail(`No JavaScript sources found at ${jsSourceDir}`);
  }

  for (const file of files) {
    fs.copyFileSync(path.join(jsSourceDir, file), path.join(distDir, file));
  }

  return files;
}

/**
 * Verifies that the generated package is complete.
 */
function verifyOutput() {
  const required = ['index.node', 'index.js', 'http.js', 'errors.js', 'validation.js', 'index.d.ts'];
  const missing = required.filter((file) => !fs.existsSync(path.join(distDir, file)));

  if (missing.length > 0) {
    fail(`The build output is incomplete, missing: ${missing.join(', ')}`);
  }
}

const target = requestedTarget();
const platform = platformOf(target);

compileNativeModule(target);

const binaryPath = findNativeBinary(target, platform);
if (!binaryPath) {
  fail(
    'Compiled native binary not found. ' +
      `Check that the target "${target || process.platform}" is installed ` +
      '(rustup target add <triple>) and that the build succeeded.'
  );
}

fs.mkdirSync(distDir, { recursive: true });
cleanStaleArtifacts();

const nativeTarget = copyNativeBinary(binaryPath);
const jsFiles = copyJavaScriptLayer();

verifyOutput();

log(`✓ Native binary generated successfully at: ${nativeTarget}`);
log(`✓ JavaScript layer generated successfully at: ${distDir} (${jsFiles.join(', ')})`);
