import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Execute a JXA (JavaScript for Automation) script via osascript.
 * Returns raw stdout + stderr text produced by the script.
 *
 * @param {string} script - JXA source code
 * @returns {Promise<string>} resolves with combined output
 */
function runJXAScript(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('osascript', ['-l', 'JavaScript', '-']); // read script from stdin

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', chunk => (stdout += chunk.toString()));
    ps.stderr.on('data', chunk => (stderr += chunk.toString()));

    ps.on('error', reject);
    ps.on('close', code => {
      if (code === 0) {
        resolve(stdout + stderr); // JXA console.log goes to stderr
      } else {
        reject(new Error(`osascript exited with code ${code}: ${stderr || stdout}`));
      }
    });

    ps.stdin.write(script);
    ps.stdin.end();
  });
}

/**
 * Parse the JSON string that is expected somewhere inside osascript output.
 * We search for the first '[' and slice from there so that any preceding
 * warnings or noise is ignored.
 *
 * @param {string} rawOutput
 * @returns {Array}
 */
function extractJsonArray(rawOutput) {
  const idx = rawOutput.indexOf('[');
  if (idx === -1) return [];
  const jsonStr = rawOutput.slice(idx);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

// Resolve directory for locating Swift script
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/**
 * Execute Swift WindowList.swift and return parsed JSON array.
 */
function runWindowListSwift() {
  return new Promise((resolve, reject) => {
    const swiftScript = join(__dirname, 'swift', 'WindowList.swift');
    const proc = spawn('swift', [swiftScript]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => (stdout += chunk.toString()));
    proc.stderr.on('data', chunk => (stderr += chunk.toString()));

    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`WindowList exited with code ${code}: ${stderr.trim()}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse WindowList output: ${err.message}\nOutput was:\n${stdout}`));
      }
    });
  });
}

/**
 * Get a list of visible application windows with their bounds.
 *
 * @param {Object} [options]
 * @param {string} [options.appName] - If provided, only windows whose app name includes this value (case-insensitive) are returned.
 * @returns {Promise<Array<{appName:string, windowTitle:string, bounds:{x:number,y:number,w:number,h:number}}>>}
 */
export async function getWindows(options = {}) {
  const { appName, pid } = options;

  let windows = await runWindowListSwift();

  // Optional filtering
  if (pid !== undefined) {
    windows = windows.filter(w => w.pid === Number(pid));
  } else if (appName) {
    const lower = appName.toLowerCase();
    windows = windows.filter(w => w.appName.toLowerCase().includes(lower));
  }
  return windows;
}

// ---------- CLI ----------
// Usage: node window_tool.js [--app "Google Chrome"]
if (process.argv[1] === __filename) {
  (async () => {
    const args = process.argv.slice(2);
    const appFlagIndex = args.indexOf('--app');
    const filterName = appFlagIndex !== -1 ? args[appFlagIndex + 1] : undefined;

    try {
      const list = await getWindows({ appName: filterName });
      console.log(JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('❌', err.message || err);
      process.exit(1);
    }
  })();
} 