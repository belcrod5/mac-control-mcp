import fs from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import Jimp from "jimp";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import processDisplays, { takeScreenshot, getSettings } from './screenshot.js';
import { getWindows } from './window_tool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * OCR処理でテキストを検索し、画面上の位置を返す
 * @param {string} searchText - 検索したいテキスト
 * @param {Object} options - オプション設定
 * @param {number} options.threshold - マッチング閾値 (0.0-1.0, デフォルト: 0.8)
 * @param {string} options.lang - OCR言語設定 (デフォルト: "ja-JP")
 * @param {boolean} options.debug - デバッグモード
 * @returns {Promise<{x: number, y: number, confidence: number, matchedText: string}>}
 */
export async function findTextPosition(searchText, targetApp, options = {}) {

  const settings = getSettings();
  const {
    threshold = settings.ocr?.defaultThreshold || 0.8,
    lang = settings.ocr?.defaultLanguage || "ja-JP",
    debug = settings.screenshot?.debug || false,
    searchAllDisplays = settings.screenshot?.searchAllDisplays || true
  } = options;

  // 事前に対象アプリのウインドウ情報を取得
  let appWindows = [];
  if (targetApp) {
    appWindows = await getWindows({ appName: targetApp });
    if (debug) {
      console.log(`🪟 [Window] ${targetApp} windows:`, appWindows);
    }
  }

  console.log(`🔍 [OCR] Searching for text: "${searchText}" (threshold: ${threshold})`);

  // マルチディスプレイ対応のスクリーンショット処理
  const result = await processDisplays(async (tmpPng, display) => {
    try {
      if (debug) {
        const scrImg = await Jimp.read(tmpPng);
        console.log(`📸 [OCR] Screenshot size: ${scrImg.bitmap.width}x${scrImg.bitmap.height} on display ${display.id}`);
      }

      // ② OCR CLI 実行
      console.log(`🔄 [OCR] Running OCR analysis on display ${display.id}...`);
      const ocrResult = await runOCRTool(tmpPng, lang);

      if (debug) {
        console.log(`📊 [OCR] Found ${ocrResult.length} text regions on display ${display.id}`);
        ocrResult.forEach((item, index) => {
          console.log(`   ${index + 1}: "${item.text}" at (${item.box.x}, ${item.box.y})`);
        });
      }

      // ③ テキスト検索とマッチング
      let matches = findTextMatches(searchText, ocrResult, threshold);

      // ③.5 アプリケーション指定がある場合のみウインドウ内判定を実施
      if (targetApp && appWindows.length) {
        const isInside = (box, win) => (
          box.x >= win.x &&
          box.y >= win.y &&
          box.x + box.w <= win.x + win.w &&
          box.y + box.h <= win.y + win.h
        );

        matches = matches.filter(m => {
          const absBox = {
            x: m.box.x + (display.left || 0),
            y: m.box.y + (display.top || 0),
            w: m.box.w,
            h: m.box.h,
          };
          return appWindows.some(w => isInside(absBox, w.bounds));
        });
      }

      if (matches.length === 0) {
        if (debug) {
          console.log(`❌ Text "${searchText}" not found on display ${display.id}`);
        }
        return null; // 次のディスプレイを試行
      }

      // ④ 最適なマッチを選択
      const bestMatch = selectBestMatch(matches);
      
      // ディスプレイオフセットを適用して絶対座標に変換
      const absoluteX = bestMatch.x + (display.left || 0);
      const absoluteY = bestMatch.y + (display.top || 0);
      
      console.log(`✅ [OCR] Found text "${bestMatch.matchedText}" at center: (${absoluteX}, ${absoluteY}) with confidence: ${bestMatch.confidence.toFixed(3)} on display ${display.id}`);
      console.log(1);
      console.log(JSON.stringify({
        x: absoluteX,
        y: absoluteY,
        confidence: bestMatch.confidence,
        matchedText: bestMatch.matchedText,
        displayId: display.id
      }, null, 2));
      return {
        x: absoluteX,
        y: absoluteY,
        confidence: bestMatch.confidence,
        matchedText: bestMatch.matchedText,
        displayId: display.id
      };
      console.log(2);

    } catch (error) {
      console.warn(`⚠️ [OCR] Error processing display ${display.id}:`, error.message);
      return null; // 次のディスプレイを試行
    }
  }, { searchAllDisplays, debug });

  if (!result) {
    throw new Error(`❌ Text "${searchText}" not found on any display (threshold: ${threshold})`);
  }

  return result;
}

/**
 * OCRToolを実行してテキスト認識結果を取得
 * @param {string} imagePath - 画像ファイルパス
 * @param {string} lang - 言語設定
 * @returns {Promise<Array>} OCR結果の配列
 */
async function runOCRTool(imagePath, lang) {
  return new Promise((resolve, reject) => {
    const ocrTool = spawn(join(__dirname, "OCRTool"), [imagePath]);
    
    let stdout = "";
    let stderr = "";

    ocrTool.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    ocrTool.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ocrTool.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`OCRTool failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse OCR result: ${error.message}`));
      }
    });

    ocrTool.on("error", (error) => {
      reject(new Error(`Failed to spawn OCRTool: ${error.message}`));
    });
  });
}

/**
 * 検索テキストとOCR結果をマッチング
 * @param {string} searchText - 検索テキスト
 * @param {Array} ocrResults - OCR結果配列
 * @param {number} threshold - マッチング閾値
 * @returns {Array} マッチした結果の配列
 */
function findTextMatches(searchText, ocrResults, threshold) {
  const matches = [];
  const normalizedSearch = normalizeText(searchText);

  for (const item of ocrResults) {
    const normalizedOcr = normalizeText(item.text);
    
    // 完全一致チェック
    if (normalizedOcr === normalizedSearch) {
      matches.push({
        ...item,
        confidence: 1.0,
        matchType: "exact",
        matchedText: item.text
      });
      continue;
    }

    // 部分一致チェック（含む）
    if (normalizedOcr.includes(normalizedSearch) || normalizedSearch.includes(normalizedOcr)) {
      const confidence = calculateTextSimilarity(normalizedSearch, normalizedOcr);
      if (confidence >= threshold) {
        matches.push({
          ...item,
          confidence,
          matchType: "partial",
          matchedText: item.text
        });
      }
    }

    // ファジーマッチング（レーベンシュタイン距離）
    const similarity = calculateLevenshteinSimilarity(normalizedSearch, normalizedOcr);
    if (similarity >= threshold) {
      matches.push({
        ...item,
        confidence: similarity,
        matchType: "fuzzy",
        matchedText: item.text
      });
    }
  }

  return matches;
}

/**
 * テキストの正規化（スペース除去、小文字化）
 * @param {string} text - 正規化するテキスト
 * @returns {string} 正規化されたテキスト
 */
function normalizeText(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * テキスト類似度を計算（包含関係ベース）
 * @param {string} text1 - テキスト1
 * @param {string} text2 - テキスト2
 * @returns {number} 類似度 (0.0-1.0)
 */
function calculateTextSimilarity(text1, text2) {
  const longer = text1.length > text2.length ? text1 : text2;
  const shorter = text1.length > text2.length ? text2 : text1;
  
  if (longer.length === 0) return 1.0;
  
  // 短い方が長い方に含まれる割合
  const containmentRatio = shorter.length / longer.length;
  
  // 共通文字数の割合も考慮
  let commonChars = 0;
  for (const char of shorter) {
    if (longer.includes(char)) {
      commonChars++;
    }
  }
  const commonRatio = commonChars / shorter.length;
  
  return (containmentRatio + commonRatio) / 2;
}

/**
 * レーベンシュタイン距離ベースの類似度計算
 * @param {string} text1 - テキスト1  
 * @param {string} text2 - テキスト2
 * @returns {number} 類似度 (0.0-1.0)
 */
function calculateLevenshteinSimilarity(text1, text2) {
  const distance = levenshteinDistance(text1, text2);
  const maxLength = Math.max(text1.length, text2.length);
  
  if (maxLength === 0) return 1.0;
  
  return 1 - (distance / maxLength);
}

/**
 * レーベンシュタイン距離を計算
 * @param {string} str1 - 文字列1
 * @param {string} str2 - 文字列2  
 * @returns {number} レーベンシュタイン距離
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * マッチした結果から最適なものを選択
 * @param {Array} matches - マッチ結果配列
 * @returns {Object} 最適なマッチ結果
 */
function selectBestMatch(matches) {
  // 優先順位: 完全一致 > 信頼度 > 画面中央に近い
  matches.sort((a, b) => {
    // 完全一致を優先
    if (a.matchType === "exact" && b.matchType !== "exact") return -1;
    if (b.matchType === "exact" && a.matchType !== "exact") return 1;
    
    // 信頼度で比較
    if (Math.abs(a.confidence - b.confidence) > 0.01) {
      return b.confidence - a.confidence;
    }
    
    // 画面中央に近い方を優先
    const centerX = 1920 / 2; // 一般的な画面幅の半分
    const centerY = 1080 / 2; // 一般的な画面高さの半分
    
    const distA = Math.sqrt(Math.pow(a.box.x - centerX, 2) + Math.pow(a.box.y - centerY, 2));
    const distB = Math.sqrt(Math.pow(b.box.x - centerX, 2) + Math.pow(b.box.y - centerY, 2));
    
    return distA - distB;
  });

  const bestMatch = matches[0];
  
  // テキストボックスの中心座標を計算
  const centerX = bestMatch.box.x + Math.round(bestMatch.box.w / 2);
  const centerY = bestMatch.box.y + Math.round(bestMatch.box.h / 2);

  return {
    x: centerX,
    y: centerY,
    confidence: bestMatch.confidence,
    matchedText: bestMatch.matchedText,
    matchType: bestMatch.matchType
  };
}
