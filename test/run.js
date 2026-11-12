import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs every test file of the directory and summarizes the result.
 *
 * The suites are executed one after the other (they use ephemeral ports, but they
 * also share the machine) and the exit code is the number of failed suites.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith('.test.js'))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
const failedSuites = [];

for (const file of files) {
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`# ${file}`);
  console.log('#'.repeat(60));

  const code = await run(path.join(testDir, file));

  if (code !== 0) {
    failedSuites.push(file);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Suites: ${files.length - failedSuites.length}/${files.length} passed`);
console.log(`Tests:  ${totalPassed} passed, ${totalFailed} failed`);
console.log('='.repeat(60));

if (failedSuites.length > 0) {
  console.log(`\nFailed suites: ${failedSuites.join(', ')}`);
}

process.exit(failedSuites.length > 0 ? 1 : 0);

/**
 * Runs a test file and returns its exit code.
 */
function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: testDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      const match = output.match(/Summary: (\d+) passed, (\d+) failed/);
      if (match) {
        totalPassed += Number(match[1]);
        totalFailed += Number(match[2]);
      }
      resolve(code ?? 1);
    });
  });
}
