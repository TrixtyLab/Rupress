import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/**
 * Build pipeline for the rupress package.
 *
 * The Rust addon and the JavaScript layer are two halves of the same artifact:
 *
 *   1. `cargo build` compiles the native module (debug or release profile).
 *   2. The compiled library is copied into a platform-specific file:
 *      `win.node`, `lin.node`, `mac.node`, `mac-x64.node`, ...
 *   3. The JavaScript sources living in `src/js` are copied into `dist`.
 *
 * The bindings are platform specific because one published package carries all
 * of them: `src/js/index.js` selects the right file at runtime. This is what
 * keeps a Windows install from loading the Linux or the macOS binary.
 *
 * `--js-only` assembles the JavaScript layer without compiling. The publish
 * workflows use it after downloading the binaries produced by every platform,
 * and `--require-all` turns the assembly into the final packaging check.
 *
 * Usage:
 *   node ./scripts/build.js [--release] [--target <triple>]
 *   node ./scripts/build.js --js-only [--require-all]
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const distDir = path.join(projectRoot, 'dist');
const jsSourceDir = path.join(projectRoot, 'src', 'js');

const isRelease = process.argv.includes('--release');
const profile = isRelease ? 'release' : 'debug';
const isJsOnly =
  process.argv.includes('--js-only') ||
  process.argv.includes('--skip-native') ||
  process.env.SKIP_NATIVE_BUILD === '1' ||
  process.env.SKIP_NATIVE_BUILD === 'true';
const requireAllPlatforms = process.argv.includes('--require-all');

/**
 * The prefix of the binding of every platform, as understood by the loader.
 */
const BINDING_PREFIX = {
  win32: 'win',
  linux: 'lin',
  darwin: 'mac'
};

/**
 * The architecture that uses the unprefixed binding (`win.node`, ...).
 */
const PRIMARY_ARCH = {
  win32: 'x64',
  linux: 'x64',
  darwin: 'arm64'
};

/**
 * The name of the dynamic library produced by cargo on every platform.
 */
const LIBRARY_NAMES = {
  win32: 'server.dll',
  linux: 'libserver.so',
  darwin: 'libserver.dylib'
};

/**
 * The bindings a publishable package must contain. Intel macOS is an extra
 * binary built from the same macOS runner.
 */
const REQUIRED_PLATFORM_BINDINGS = ['win.node', 'lin.node', 'mac.node', 'mac-x64.node'];

/**
 * The files of the JavaScript layer generated on every build.
 */
const REQUIRED_JS_FILES = ['index.js', 'http.js', 'errors.js', 'validation.js', 'index.d.ts'];

/**
 * The target triple requested for the compilation, when it is not the host one.
 */
function requestedTarget() {
  const flag = process.argv.find((argument) => argument.startsWith('--target='));

  if (flag) {
    return flag.slice('--target='.length);
  }

  const index = process.argv.indexOf('--target');
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
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

  if (target.includes('windows')) return 'win32';
  if (target.includes('linux')) return 'linux';
  if (target.includes('darwin') || target.includes('apple')) return 'darwin';

  return process.platform;
}

/**
 * The architecture a target triple belongs to.
 */
function archOf(target) {
  if (!target) {
    return process.arch;
  }

  if (target.includes('aarch64') || target.includes('arm64')) return 'arm64';
  if (target.includes('x86_64') || target.includes('x64')) return 'x64';
  if (target.includes('i686') || target.includes('i586')) return 'ia32';
  if (target.includes('arm')) return 'arm';

  return process.arch;
}

/**
 * Resolves the platform-specific binding filename.
 */
function bindingName(platform, arch) {
  const prefix = BINDING_PREFIX[platform];

  if (!prefix) {
    fail(`Unsupported platform "${platform}".`);
  }

  return arch === PRIMARY_ARCH[platform] ? `${prefix}.node` : `${prefix}-${arch}.node`;
}

/**
 * The name of the library for a platform.
 */
function libraryName(platform) {
  const name = LIBRARY_NAMES[platform];

  if (!name) {
    fail(`Unsupported platform "${platform}".`);
  }

  return name;
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
        path.join(projectRoot, 'target', 'x86_64-pc-windows-msvc', profile),
        path.join(projectRoot, 'target', 'aarch64-apple-darwin', profile),
        path.join(projectRoot, 'target', 'x86_64-apple-darwin', profile),
        path.join(projectRoot, 'target', 'x86_64-unknown-linux-gnu', profile),
        path.join(projectRoot, 'target', 'aarch64-unknown-linux-gnu', profile)
      ];

  return directories
    .map((directory) => path.join(directory, name))
    .find((candidate) => fs.existsSync(candidate));
}

/**
 * Atomically copies a file, replacing it safely even if it is locked by a running
 * process on Windows.
 */
function copyFileAtomic(source, destination) {
  try {
    fs.copyFileSync(source, destination);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      // The previous module is still loaded by a running process: replace it anyway.
      const backupPath = `${destination}.${Date.now()}.old`;
      fs.renameSync(destination, backupPath);
      fs.copyFileSync(source, destination);
      try {
        fs.unlinkSync(backupPath);
      } catch (_) {}
    } else {
      throw err;
    }
  }
}

/**
 * Removes leftovers of previous builds and the old monolithic `index.node`,
 * which cannot coexist with the platform-specific bindings.
 */
function cleanStaleArtifacts() {
  if (!fs.existsSync(distDir)) return;

  for (const entry of fs.readdirSync(distDir)) {
    if (entry === 'index.node' || entry.endsWith('.old')) {
      try {
        fs.unlinkSync(path.join(distDir, entry));
      } catch (_) {}
    }
  }
}

/**
 * Copies the compiled library into its platform-specific `.node` file.
 */
function copyNativeBinary(binaryPath, platform, arch) {
  const targetPath = path.join(distDir, bindingName(platform, arch));

  copyFileAtomic(binaryPath, targetPath);

  return targetPath;
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
function verifyOutput(nativeFile) {
  const leftovers = fs
    .readdirSync(distDir)
    .filter((file) => file === 'index.node' || file.endsWith('.old'));

  if (leftovers.length > 0) {
    fail(
      `The build output contains stale artifacts: ${leftovers.join(', ')}. ` +
        'Close any process using them and build again.'
    );
  }

  const missing = REQUIRED_JS_FILES.filter((file) => !fs.existsSync(path.join(distDir, file)));

  if (missing.length > 0) {
    fail(`The build output is incomplete, missing JavaScript files: ${missing.join(', ')}`);
  }

  if (nativeFile) {
    const nativePath = path.join(distDir, nativeFile);

    if (!fs.existsSync(nativePath) || fs.statSync(nativePath).size === 0) {
      fail(`The native binary "${nativeFile}" was not generated.`);
    }
  }

  const binaries = fs.readdirSync(distDir).filter((file) => file.endsWith('.node'));

  if (binaries.length === 0) {
    fail('The build output is incomplete: no .node binary found in dist.');
  }

  if (requireAllPlatforms) {
    const unavailable = REQUIRED_PLATFORM_BINDINGS.filter((file) => !binaries.includes(file));

    if (unavailable.length > 0) {
      fail(
        `The package is missing platform binaries: ${unavailable.join(', ')}. ` +
          'Build them on their platforms (or download the CI artifacts) before packing.'
      );
    }
  }
}

fs.mkdirSync(distDir, { recursive: true });
cleanStaleArtifacts();

const target = requestedTarget();
const platform = platformOf(target);
const arch = archOf(target);

let nativeTarget = null;

if (!isJsOnly) {
  compileNativeModule(target);

  const binaryPath = findNativeBinary(target, platform);
  if (!binaryPath) {
    fail(
      'Compiled native binary not found. ' +
        `Check that the target "${target || process.platform}" is installed ` +
        '(rustup target add <triple>) and that the build succeeded.'
    );
  }

  nativeTarget = copyNativeBinary(binaryPath, platform, arch);
  log(`✓ Native binary generated: ${path.relative(projectRoot, nativeTarget)}`);
} else {
  log('Assembling the JavaScript layer without compiling the native addon (--js-only)...');
}

const jsFiles = copyJavaScriptLayer();

verifyOutput(nativeTarget ? path.basename(nativeTarget) : null);

log(`✓ JavaScript layer generated: ${path.relative(projectRoot, distDir)} (${jsFiles.join(', ')})`);
