import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import { tmpdir } from "os";
import { getWindows } from "./window_tool.js";
import { captureRect } from "./screenshot.js";

// Resolve current directory so that we can locate the Swift script regardless
// of where this module is executed from.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/**
 * Run the Swift AppInfo utility and return parsed JSON.
 * @param {string[]} args - arguments to pass after the script path
 * @returns {Promise<any>} parsed JSON output
 */
function runAppInfo(args = []) {
  return new Promise((resolve, reject) => {
    const swiftScript = join(__dirname, "swift", "AppInfo.swift");

    // Always invoke through the Swift interpreter (`swift`) so that users don't
    // need to pre-compile. This is slower but simpler and consistent with how
    // OCRTool et al. are spawned elsewhere in the project.
    const proc = spawn("swift", [swiftScript, ...args]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", chunk => (stdout += chunk.toString()));
    proc.stderr.on("data", chunk => (stderr += chunk.toString()));

    proc.on("error", err => reject(err));

    proc.on("close", code => {
      if (code !== 0) {
        return reject(new Error(`AppInfo exited with code ${code}: ${stderr.trim()}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse AppInfo output: ${err.message}\nOutput was:\n${stdout}`));
      }
    });
  });
}

/**
 * Retrieve a list of apps that currently own at least one on-screen window.
 * @returns {Promise<Array<{name:string,pid:number}>>}
 */
export async function getAppList() {
  return await runAppInfo(["list"]);
}

/**
 * Run OCRTool (Swift) on the provided image path and return parsed results.
 * @param {string} imagePath
 * @returns {Promise<Array<{text:string,box:{x:number,y:number,w:number,h:number}}>>}
 */
async function runOCRTool(imagePath) {
  return new Promise((resolve, reject) => {
    const binPath = join(__dirname, "OCRTool");
    const proc    = spawn(binPath, [imagePath]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", chunk => (stdout += chunk.toString()));
    proc.stderr.on("data", chunk => (stderr += chunk.toString()));

    proc.on("error", reject);

    proc.on("close", code => {
      if (code !== 0) {
        return reject(new Error(`OCRTool exited with code ${code}: ${stderr.trim()}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse OCRTool output: ${err.message}\nstdout:\n${stdout}`));
      }
    });
  });
}

/**
 * Bring the application with given PID to the front (foreground).
 * Uses AppInfo.swift front <pid>
 * @param {number} pid
 */
function bringAppToFront(pid) {
  return new Promise((resolve, reject) => {
    const swiftScript = join(__dirname, "swift", "AppInfo.swift");
    const proc = spawn("swift", [swiftScript, "front", String(pid)]);

    let stderr = "";
    proc.stderr.on("data", chunk => (stderr += chunk.toString()));

    proc.on("error", reject);
    proc.on("close", code => {
      if (code !== 0) {
        return reject(new Error(`front command failed: ${stderr.trim()}`));
      }
      resolve();
    });
  });
}

/**
 * Get information for the specified app (case-insensitive match on name).
 * When `appName` is omitted, the full list is returned (same as getAppList).
 *
 * @param {string} [appName]
 * @returns {Promise<Array|Object|null>} If appName provided, returns the first matching app object or null; otherwise returns the full list.
 */
export async function getAppOcr(pid, options = {}) {
  if (pid === undefined) {
    throw new Error("pid is required for getAppOcr");
  }

  const {
    windowIndex = 0, // which window to use if multiple
    debug       = false,
  } = options;

  // 1) Locate window bounds using pid
  let wins = await getWindows({ pid });

  // Fallback: if no windows found by pid, attempt lookup by app name retrieved from getAppList
  if (!wins.length) {
    try {
      const appList = await getAppList();
      const match   = appList.find(app => app.pid === Number(pid));
      if (match && match.name) {
        console.warn(`⚠️  No windows found for pid ${pid}. Retrying by app name "${match.name}"`);
        wins = await getWindows({ appName: match.name });
      }
    } catch {
      // ignore errors in fallback
    }
  }

  if (!wins.length) {
    throw new Error(`No windows found for pid: ${pid}`);
  }
  const win = wins[windowIndex] || wins[0];
  const { bounds } = win; // { x,y,w,h }

  // 1.5) Bring to front (foreground)
  try {
    await bringAppToFront(pid);
    await new Promise(r => setTimeout(r, 300));
  } catch {}

  // 2) Capture screenshot of rect
  const buf = await captureRect(bounds, { debug });

  // 3) Persist buffer to temp file so OCRTool can read
  const tmpPath = join(tmpdir(), `app_ocr_${Date.now()}.png`);
  await fs.writeFile(tmpPath, buf);

  try {
    // 4) Run OCR
    const ocrRes = await runOCRTool(tmpPath);

    // 5) Adjust coordinates to absolute (global) coordinates
    const adjusted = ocrRes.map(item => ({
      text: item.text,
      box: {
        x: item.box.x + bounds.x,
        y: item.box.y + bounds.y,
        w: item.box.w,
        h: item.box.h,
      }
    }));

    return adjusted;
  } finally {
    if (!debug) {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}