import Jimp from "jimp";
import { createCanvas, Image } from "canvas";
import { JSDOM } from "jsdom";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import processDisplays, { takeScreenshot, getSettings } from './screenshot.js';

// ES ModulesでのCommonJS互換性のため
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── ブラウザ API のダミー実装 ────────────────────────────
const { window } = new JSDOM("");
global.document = window.document;
global.HTMLCanvasElement = createCanvas().constructor;
global.Image = Image;

// ── Module を先に置く（wasmBinaryFile は書かない！） ──
global.Module = { onRuntimeInitialized() {} };

/* ────────────────────────── ローダー関数 ────────────────────────── */
let cvPromise;

/**
 * OpenCV single-file 版をロードして cv を返す（初回のみ import）
 */
export function loadOpenCV() {
  if (cvPromise) return cvPromise;

  cvPromise = (async () => {
    // 1) CommonJS を ESM 側で読む
    const { default: exportedDefault, cv: exportedCv } = await import("./opencv.cjs");

    // 2) どこに入っているかを判定
    const cvObj =
      exportedDefault           // module.exports = cv の場合
      || exportedCv             // module.exports.cv = … の場合
      || global.cv;             // 旧ビルドは global.cv

    if (!cvObj) throw new Error("cv object not found after import");

    // 3) WASM 完全ロード待ち（single-file 版は必ず .ready がある）
    await cvObj.ready;

    // 4) global からも触れるようにしておくと後段が楽
    global.cv = cvObj;
    return cvObj;
  })();

  return cvPromise;
}


// 実際のOpenCV.jsを使った画像検索
// -------------------------------------------------------------
//  Improved findCenter() – pure JavaScript version
//  ※ 依存: loadOpenCV(), screenshot-desktop, jimp, fs, path
// -------------------------------------------------------------
export async function findCenter(
  tplPath,
  {
    thresh     = 0.85,
    scaleMin   = 0.8,
    scaleMax   = 1.2,
    scaleStep  = 0.05,
    useEdges   = true,
    useBlur    = true,
    debug      = false,
    dump       = false,
  } = {},
) {
  
  if (typeof thresh === "number" && typeof arguments[1] === "number") {
    // 数値だけで呼ばれた場合
    thresh   = arguments[1];
    scaleMin = 0.8; scaleMax = 1.2;
  }

  if (!existsSync(tplPath)){
    console.error("Template not found: ", tplPath);
    throw new Error(`Template not found: ${tplPath}`);
  }

  const cv  = await loadOpenCV();

  /* ───── 1) スクショ & テンプレ ───── */
  // マルチディスプレイ対応でスクリーンショットを処理
  const result = await processDisplays(async (tmpPng, display) => {
    const scr = await Jimp.read(tmpPng);
    const tpl = await Jimp.read(tplPath);
    
    try {
      return await processTemplateMatch(scr, tpl, {
        thresh, scaleMin, scaleMax, scaleStep, useEdges, useBlur, debug, dump, display
      });
    } catch (error) {
      if (debug) {
        console.log(`❌ Template not found on display ${display.id}: ${error.message}`);
      }
      return null; // 次のディスプレイを試行
    }
  });
  
  if (!result) {
    throw new Error(`Template not found on any display (threshold: ${thresh})`);
  }
  
  return result;
}

/**
 * テンプレートマッチング処理を分離した関数
 */
async function processTemplateMatch(scr, tpl, options) {
  const { thresh, scaleMin, scaleMax, scaleStep, useEdges, useBlur, debug, dump, display } = options;
  const cv = await loadOpenCV();

  const srcRGBA = cv.matFromImageData(scr.bitmap);   // Jimp は RGBA
  const tplRGBA = cv.matFromImageData(tpl.bitmap);

  /* ───── 2) 前処理 ───── */
  const preprocess = rgba => {
    const ch = new cv.MatVector();
    cv.split(rgba, ch);
    const alpha = ch.get(3);
    const mask  = new cv.Mat();
    cv.threshold(alpha, mask, 0, 255, cv.THRESH_BINARY);
    alpha.delete(); ch.delete();

    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    if (useBlur) cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    if (useEdges) {
      const edge = new cv.Mat();
      cv.Canny(gray, edge, 50, 150);
      // エッジが 5px 未満なら効果無いので戻す
      if (cv.countNonZero(edge) >= 5) { gray.delete(); return { gray: edge, mask }; }
      edge.delete();
    }
    return { gray, mask };
  };

  const src = preprocess(srcRGBA);
  const tpl0 = preprocess(tplRGBA);
  srcRGBA.delete(); tplRGBA.delete();

  /* ───── 3) マルチスケール ───── */
  let bestVal = -1;
  let bestLoc = null;
  let bestScale = 1;

  for (let s = scaleMin; s <= scaleMax + 1e-6; s += scaleStep) {
    const tplG = new cv.Mat(); const tplM = new cv.Mat();
    cv.resize(tpl0.gray, tplG, new cv.Size(), s, s, cv.INTER_AREA);
    cv.resize(tpl0.mask, tplM, new cv.Size(), s, s, cv.INTER_NEAREST);

    if (tplG.rows > src.gray.rows || tplG.cols > src.gray.cols) {
      tplG.delete(); tplM.delete(); continue;
    }

    const res = new cv.Mat();
    cv.matchTemplate(src.gray, tplG, res, cv.TM_CCOEFF_NORMED, tplM);
    let { maxVal, maxLoc } = cv.minMaxLoc(res);

    /* ── CCOEFF が Infinity / NaN なら SQDIFF にフォールバック ── */
    if (!Number.isFinite(maxVal)) {
      cv.matchTemplate(src.gray, tplG, res, cv.TM_SQDIFF_NORMED, tplM);
      const { minVal, minLoc } = cv.minMaxLoc(res);
      maxVal = 1 - minVal;   // 小さいほど良い → 大きいほど良いに裏返す
      maxLoc = minLoc;
    }

    if (maxVal > bestVal) {
      bestVal = maxVal; bestLoc = maxLoc; bestScale = s;
    }
    res.delete(); tplG.delete(); tplM.delete();
  }

  tpl0.gray.delete(); tpl0.mask.delete();
  src.gray.delete(); src.mask.delete();

  /* ───── 4) ヒット判定 ───── */
  if (debug) console.log(`   best = ${bestVal.toFixed(3)} thresh=${thresh} scale=${bestScale.toFixed(2)}`);

  if (bestLoc === null || bestVal < thresh) {
    throw new Error(`best < thresh`);
  }

  /* ───── 5) 中心座標 & デバッグ出力 ───── */
  const tplW = tpl.bitmap.width  * bestScale;
  const tplH = tpl.bitmap.height * bestScale;

  const center = {
    x: Math.round(bestLoc.x + tplW / 2) + (display.left || 0),
    y: Math.round(bestLoc.y + tplH / 2) + (display.top || 0),
    confidence: bestVal,
  };

  if (dump) await dumpDebug(scr, bestLoc, tplW, tplH);
  return center;
}

/* ─────────── デバッグ描画 ─────────── */
async function dumpDebug(jimg, loc, w, h) {
  const dbg = jimg.clone();
  const red = Jimp.cssColorToHex("#ff0000");
  dbg.scan(loc.x, loc.y, w, h, function (x,y,idx) {
    if (x===loc.x || x===loc.x+w-1 || y===loc.y || y===loc.y+h-1)
      this.bitmap.data.writeUInt32BE(red, idx);
  });
  
  await dbg.writeAsync(`${__dirname}/debug/debug_result.png`);
}



// デバッグ用スクリーンショット保存
export async function saveDebugScreenshot(imagePath = "debug-screenshot.png") {
  try {
    console.log(`📸 Saving debug screenshot to: ${imagePath}`);
    
    const scrBuf = await takeScreenshot();
    writeFileSync(imagePath, scrBuf);
    
    console.log(`✅ Debug screenshot saved: ${imagePath}`);
    return imagePath;
  } catch (error) {
    console.error("❌ Error saving debug screenshot:", error);
    throw error;
  }
}
