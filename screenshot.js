import screenshot from "screenshot-desktop";
import fs from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import macDisplays from "node-mac-displays";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 設定ファイルの読み込み
let settings;
try {
  const settingsData = await fs.readFile(join(__dirname, "settings.json"), "utf8");
  settings = JSON.parse(settingsData);
} catch {
  console.warn("⚠️ Failed to load settings.json, using defaults");
  settings = {
    screenshot: {
      displayPriority: ["center", "topLeft", "topRight", "bottomLeft", "bottomRight"],
      searchAllDisplays: true,
      format: "png",
      quality: 100,
      debug: false,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  ディスプレイ情報                                                   */
/* ------------------------------------------------------------------ */
export async function getAvailableDisplays() {
  return macDisplays.getAllDisplays({ useNSScreen: true })
    .map((d, idx) => ({
      id:     d.id,       // CGDirectDisplayID
      index:  idx,        // screenshot-desktop 用
      width:  d.bounds.width,
      height: d.bounds.height,
      left:   d.bounds.x,
      top:    d.bounds.y,
    }));
}

/* ------------------------------------------------------------------ */
/*  マルチディスプレイ処理                                             */
/* ------------------------------------------------------------------ */
export async function processDisplays(callback, options = {}) {
  const {
    searchAllDisplays = settings.screenshot.searchAllDisplays,
    displayPriority = settings.screenshot.displayPriority,
    debug = settings.screenshot.debug,
    overlayEnabled = true,
  } = options;

  try {
    const displays = await getAvailableDisplays();

    if (debug) {
      console.log(
        `🔄 [Screenshot] Processing ${displays.length} displays with priority: [${displayPriority.join(
          ", "
        )}]`
      );
    }

    /*
     * ────────────────────────────────────────────────────────────
     *  displayPriority の拡張
     *  ----------------------------------------------------------------
     *   以下 2 種類をサポートする。
     *     1. 数値 (display.id もしくは display.index) ※後方互換
     *     2. 文字列による位置指定: "center", "topLeft", "topRight",
     *        "bottomLeft", "bottomRight", "left", "right", "top", "bottom"
     *
     *   位置指定の場合:
     *     center      – すべてのディスプレイの中央（Union Bounds の中心）を含むディスプレイ
     *     topLeft     – もっとも左上にあるディスプレイ
     *     topRight    – もっとも右上にあるディスプレイ
     *     bottomLeft  – もっとも左下にあるディスプレイ
     *     bottomRight – もっとも右下にあるディスプレイ
     *     left/right  – もっとも左/右にあるディスプレイ
     *     top/bottom  – もっとも上/下にあるディスプレイ
     */

    // 位置関係を算出しておく
    const minLeft   = Math.min(...displays.map((d) => d.left));
    const maxLeft   = Math.max(...displays.map((d) => d.left));
    const minTop    = Math.min(...displays.map((d) => d.top));
    const maxTop    = Math.max(...displays.map((d) => d.top));
    const maxRight  = Math.max(...displays.map((d) => d.left + d.width));
    const maxBottom = Math.max(...displays.map((d) => d.top + d.height));
    const centerX   = (minLeft + maxRight) / 2;
    const centerY   = (minTop + maxBottom) / 2;

    const matchesDescriptor = (disp, descriptor) => {
      const dl = disp.left;
      const dt = disp.top;

      switch (descriptor) {
        case "center":
          return (
            centerX >= dl && centerX <= dl + disp.width &&
            centerY >= dt && centerY <= dt + disp.height
          );
        case "topLeft":
          return dt === minTop && dl === minLeft;
        case "topRight":
          return dt === minTop && dl === maxLeft;
        case "bottomLeft":
          return dt === maxTop && dl === minLeft;
        case "bottomRight":
          return dt === maxTop && dl === maxLeft;
        case "left":
        case "leftMost":
          return dl === minLeft;
        case "right":
        case "rightMost":
          return dl === maxLeft;
        case "top":
          return dt === minTop;
        case "bottom":
          return dt === maxTop;
        default:
          return false;
      }
    };

    const getPri = (disp) => {
      // displayPriority は配列の先頭ほど優先度が高い
      for (let i = 0; i < displayPriority.length; i++) {
        const pri = displayPriority[i];

        if (typeof pri === "number") {
          if (disp.id === pri || disp.index === pri) return i;
        } else if (typeof pri === "string") {
          if (matchesDescriptor(disp, pri)) return i;
        }
      }
      // マッチしない場合は末尾扱い
      return displayPriority.length;
    };

    const sortedDisplays = [...displays].sort((a, b) => {
      const diff = getPri(a) - getPri(b);
      if (diff !== 0) return diff;

      // 同 priority の場合は左→上の順で並べておく
      if (a.left !== b.left) return a.left - b.left;
      return a.top - b.top;
    });

    for (const display of sortedDisplays) {
      if (debug) {
        console.log(`📸 [Screenshot] Processing display ${display.id} (${display.width}x${display.height})`);
      }

      if (overlayEnabled) {
        // show overlay covering whole display
        const overlayColor = options.overlayColor || "00FF00";
        showOverlay(display.left, display.top, display.width, display.height, { alpha: 0.3, colorHex: overlayColor, duration: 2 });
      }

      const tmpPng = join(tmpdir(), `screenshot_display_${display.id}_${Date.now()}.png`);

      try {
        const screenshotBuffer = await takeFullScreenAndCrop(display);
        await fs.writeFile(tmpPng, screenshotBuffer);

        const result = await callback(tmpPng, display);
        await cleanupTempFile(tmpPng);

        if (result) {
          // 必ずオフセットを加算して絶対座標化
          if (result.x !== undefined && result.y !== undefined) {
            result.displayId = display.id;

            if (debug) {
              console.log(`✅  Converted coords → (${result.x}, ${result.y})`);
            }
          }
          return result;
        }

        if (!searchAllDisplays) break;
      } catch (err) {
        console.error(err);
        console.warn(`⚠️ [Screenshot] Failed on display ${display.id}:`, err.message);
        await cleanupTempFile(tmpPng);
      }
    }

    if (debug) console.log("❌ [Screenshot] No results found");
    return null;
  } catch (err) {
    console.error("❌ [Screenshot] Failed to process displays:", err);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  スクリーンショット取得                                             */
/* ------------------------------------------------------------------ */
export async function takeScreenshot(displayId = screenshot.MAIN) {
  const opts = { format: settings.screenshot.format, quality: settings.screenshot.quality };
  if (displayId !== screenshot.MAIN) opts.screen = displayId; // 0 始まりそのまま
  return screenshot(opts);
}

/* 全画面 → 必要なら Crop（現状そのまま返却） */
async function takeFullScreenAndCrop(display) {
  try {
    // ここは −1 しない！ display.id をそのまま
    return await screenshot({ format: settings.screenshot.format, screen: display.index });
  } catch (err) {
    console.warn(`⚠️ Fallback to direct capture for display ${display.index}`);
    return takeScreenshot(display.index);
  }
}

/* ------------------------------------------------------------------ */
/*  補助関数                                                           */
/* ------------------------------------------------------------------ */
export async function takeAllScreenshots() {
  const displays = await getAvailableDisplays();
  const shots = [];

  for (const d of displays) {
    try {
      const buf = await takeScreenshot(d.index);
      const path = join(tmpdir(), `screenshot_all_${d.index}_${Date.now()}.png`);
      await fs.writeFile(path, buf);
      shots.push({ displayId: d.index, display: d, filePath: path, buffer: buf });
    } catch (err) {
      console.warn(`⚠️ Failed screenshot for display ${d.index}:`, err.message);
    }
  }
  return shots;
}

async function cleanupTempFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    console.warn(`⚠️ Failed to delete temp file: ${filePath}`);
  }
}

export async function reloadSettings() {
  try {
    const data = await fs.readFile(join(__dirname, "settings.json"), "utf8");
    settings = JSON.parse(data);
    console.log("✅ Settings reloaded");
  } catch (err) {
    console.warn("⚠️ Failed to reload settings:", err.message);
  }
}

export function getSettings() {
  return settings;
}

/* ------------------------------------------------------------------ */
/*  Overlay (Swift)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Show semi-transparent overlay rectangle via Swift/Screen.swift.
 * Coordinates must be in global display space, top-left origin (same as NSScreen).
 *
 * @param {number} x      Global x (pts)
 * @param {number} y      Global y (pts)
 * @param {number} width  Width  (pts)
 * @param {number} height Height (pts)
 * @param {object} opts   { alpha=0.4, color="FF0000", duration=3 }
 */
export function showOverlay(x, y, width, height, opts = {}) {
  const {
    duration = 1.9,
    padding  = 100,
  } = opts;

  const binPath = join(__dirname, "Screen");

  // Build argv list matching new Screen CLI: `Screen --x <x> --y <y> --width <w> --height <h> [--padding <p>] [--duration <d>]`
  const args = [
    "--x",      String(Math.round(x - padding)),
    "--y",      String(Math.round(y - padding)),
    "--width",  String(Math.round(width)),
    "--height", String(Math.round(height)),
  ];

  // Optional flags -------------------------------------------------------
  if (padding && Number.isFinite(padding)) {
    args.push("--padding", String(Math.round(padding)));
  }
  if (duration && Number.isFinite(duration)) {
    args.push("--duration", String(duration));
  }
  

  // Detach process so overlay persists even if Node exits
  const child = spawn(binPath, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/* ------------------------------------------------------------------ */
/*  指定矩形のスクリーンショット                                     */
/* ------------------------------------------------------------------ */
/**
 * Capture a screenshot of the specified rectangle.
 * macOS の `screencapture` コマンドを利用するため、macOS 専用実装。
 *
 * @param {{x:number,y:number,w:number,h:number}} rect - Rectangle in global display coordinates.
 * @param {Object} [options]
 * @param {boolean} [options.debug=false] - If true, leaves tmp file undeleted.
 * @returns {Promise<Buffer>} PNG buffer of captured image.
 */
export async function captureRect(rect, options = {}) {
  const { debug = false, overlay = true } = options;

  // Optional visual overlay for the area being captured
  if (overlay) {
    try {
      showOverlay(rect.x, rect.y, rect.w, rect.h, { alpha: 0.25, colorHex: "0000FF", duration: 1.2 });
    } catch {/* non-fatal */}
  }
  const tmpPng = join(tmpdir(), `screenshot_rect_${Date.now()}.png`);

  return new Promise((resolve, reject) => {
    const proc = spawn("screencapture", ["-x", `-R${rect.x},${rect.y},${rect.w},${rect.h}`, tmpPng]);

    let stderr = "";
    proc.stderr.on("data", chunk => (stderr += chunk.toString()));

    proc.on("error", reject);

    proc.on("close", async code => {
      if (code !== 0) {
        return reject(new Error(`screencapture exited with ${code}: ${stderr.trim()}`));
      }
      try {
        const buf = await fs.readFile(tmpPng);
        if (!debug) {
          await fs.unlink(tmpPng).catch(() => {});
        }
        resolve(buf);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export default processDisplays;
