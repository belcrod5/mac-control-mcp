import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Jimp from "jimp";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findCenter, saveDebugScreenshot } from "./match.js";
import { takeScreenshot } from "./screenshot.js";
import { findTextPosition } from "./ocr_match.js";
import { moveToPosition, clickAtCurrentPosition, pressKey } from "./mouse.js";
import { controlVolume } from "./volume.js";
import { getAppList, getAppOcr } from "./ocr_app.js";

// --- ログはすべて stderr に逃がす -----------------
console.log = (...args) => {
  // MCP メッセージと混ざらないよう stderr に書く
  process.stderr.write(args.map(String).join(" ") + "\n");
};



// 現在のファイルの場所を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ACTIONS_JSON_PATH = join(__dirname, "actions.json");



// 複数画像検索（配列の順番に試行、最初にヒットしたらループを抜ける）
async function findMultipleImages(imageList, threshold = 0.85, retryCount = 3, retryDelay = 1000, debugMode = false) {
  // 文字列の場合は配列に変換（後方互換性）
  const imagePaths = Array.isArray(imageList) ? imageList : [imageList];
  
  console.log(`🔍 Searching for ${imagePaths.length} image variant(s): [${imagePaths.join(', ')}]`);
  if (debugMode) {
    console.log(`🐛 [DEBUG MODE] Detailed matching information will be saved`);
  }
  
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    console.log(`📸 Attempt ${attempt}/${retryCount}`);
    
    // 配列の順番に画像を試行
    for (let i = 0; i < imagePaths.length; i++) {
      let imagePath = imagePaths[i];
      const originalImagePath = imagePath;
      // 相対パスの場合は、プロジェクトルートからの絶対パスに変換
      if (!imagePath.startsWith('/') && !imagePath.includes(':')) {
        imagePath = join(__dirname, imagePath);
      }
      
      console.log(`   🎯 Trying image ${i + 1}/${imagePaths.length}: ${originalImagePath}`);
      
      try {
        const result = await findCenter(imagePath, {
          thresh    : 0.8,   // 少し下げる
          scaleMin  : 1.0,    // 広げる
          scaleMax  : 1.0,
          useEdges  : true,  // 前回と同じ
          useBlur   : false,
          debug     : true,
          dump      : true,
        });
        console.log(`✅ Found ${imagePath} at (${result.x}, ${result.y}) with confidence ${result.confidence.toFixed(3)}`);
        return result;
      } catch (error) {
        console.error('   \x1b[31m%s\x1b[0m', error.message);
        // この画像は見つからないが、次の画像を試行
        console.log(`   ⏭️\n`);
        continue;
      }
    }
    
    // 全ての画像が見つからなかった場合
    if (attempt < retryCount) {
      console.log(`🔄 No images found in this attempt, retrying in ${retryDelay}ms... (${attempt}/${retryCount})\n\n`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // 全ての試行で全ての画像が見つからなかった
  // throw new Error(`None of the ${imagePaths.length} image variant(s) found after ${retryCount} attempts: [${imagePaths.join(', ')}]`);
  return false;
}

// 画像検索（単一・複数対応）
async function findImagePosition(imageList, threshold = 0.85, retryCount = 3, retryDelay = 1000, debugMode = false) {
  return await findMultipleImages(imageList, threshold, retryCount, retryDelay, debugMode);
}

// 単一ステップの実行（エラーハンドリング強化版）
async function runStep(step, stepIndex, totalSteps, debugMode = false) {
  try {
    console.log(`\n📍 Step ${stepIndex + 1}/${totalSteps}: ${step.type}`);
    if (step.description) {
      console.log(`   ${step.description}`);
    }
    
    switch (step.type) {
      case "mouse_move":
        // 直接座標指定モード（最優先）
        if (step.pos && Array.isArray(step.pos) && step.pos.length === 2) {
          const [x, y] = step.pos;
          console.log(`📍 Moving to direct coordinates: (${x}, ${y})`);
          await moveToPosition({ x, y });
        }
        // テキスト・画像検索モード（フォールバック方式）
        else {
          let position = null;
          let lastError = null;
          
          // 1. テキスト検索を試行（指定されている場合）
          if (step.text) {
            try {
              console.log(`🔍 Searching for text: "${step.text}"`);
              position = await findTextPosition(step.text, step.target_app, {
                threshold: step.threshold || 0.8,
                lang: step.lang || "ja-JP",
                debug: step.debugMode || debugMode
              });
              console.log(3,  JSON.stringify(position, null, 2));
              console.log(`📍 Moving to text position: (${position.x}, ${position.y})`);
            } catch (error) {
              console.error(error);
              console.warn(`⚠️  Text search failed: ${error.message}`);
              lastError = error;
              // positionはnullのまま、画像検索に進む
            }
          }
          
          // 2. テキスト検索が失敗またはなければ、画像検索を試行
          if (!position && step.img) {
            try {
              console.log(`🔍 Falling back to image search: ${Array.isArray(step.img) ? step.img.join(', ') : step.img}`);
              position = await findImagePosition(
                step.img, 
                step.threshold || 0.85,
                step.retryCount || 1,
                step.retryDelay || 1000,
                step.debugMode || debugMode
              );

              if(!position) {
                // 見つからなかった時の画面を保存
                const scrBuf = await takeScreenshot();
                const scrImg = await Jimp.read(scrBuf);
                await scrImg.writeAsync(`${__dirname}/debug/failed-mouse-move/${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
                throw new Error("Image not found on screen");
              }
              
              // マッチした画像の情報を表示
              if (position.matchedImage) {
                console.log(`📍 Using matched image: ${position.matchedImage} (${position.imageIndex + 1}/${position.totalImages})`);
              }
              
            } catch (error) {
              console.warn(`⚠️  Image search failed: ${error.message}`);
              lastError = error;
            }
          }
          
          // 3. 結果判定
          if (position) {
            await moveToPosition(position);
          } else if (step.skipOnError) {
            const reason = step.text && step.img ? 
              "Both text and image search failed" : 
              (step.text ? "Text search failed" : "Image search failed");
            console.warn(`⚠️  Skipping step: ${reason}`);
            return { type: step.type, skipped: true, reason, success: false };
          } else {
            // pos、text、imgのいずれも指定されていないか、すべて失敗
            if (!step.text && !step.img) {
              throw new Error("mouse_move step requires either 'pos', 'text', or 'img' parameter");
            } else {
              const errorMessage = step.text && step.img ? 
                `Both text ("${step.text}") and image search failed` : 
                (step.text ? `Text "${step.text}" not found` : "Image not found");
              throw new Error(errorMessage);
            }
          }
        }
        break;
        
      case "click":
        // If direct coordinates are provided, move there before clicking
        if (step.x && step.y) {
          const [x, y] = [step.x, step.y];
          console.log(`📍 Clicking at specified coordinates: (${x}, ${y})`);
          await moveToPosition({ x, y });
        }
        await clickAtCurrentPosition();
        break;
        
      case "key":
        if (!step.keyCode) {
          throw new Error("key step requires keyCode parameter");
        }
        await pressKey(step.keyCode);
        break;
        
      case "volume_up":
        const upAmount = step.amount || 10;
        await controlVolume('up', upAmount);
        break;
        
      case "volume_down":
        const downAmount = step.amount || 10;
        await controlVolume('down', downAmount);
        break;
        
      case "volume_set":
        if (step.volume === undefined) {
          throw new Error("volume_set step requires volume parameter (0-100)");
        }
        await controlVolume('set', step.volume);
        break;
        
      case "wait":
        const waitTime = step.ms || 1000;
        console.log(`⏱️  Waiting for ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        break;

      case "get_app_list":
        const appList = await getAppList();
        console.log(JSON.stringify(appList, null, 2));
        return { type: step.type, success: true, appList };

      case "get_app_ocr":
        if (step.pid === undefined) {
          throw new Error("get_app_ocr step requires pid parameter");
        }
        const appOcr = await getAppOcr(step.pid);
        return { type: step.type, success: true, appOcr };

      case "debug_screenshot":
        const screenshotPath = step.path || 'debug-manual-screenshot.png';
        await saveDebugScreenshot(screenshotPath);
        console.log(`📸 Debug screenshot saved: ${screenshotPath}`);
        break;
        
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
    
    // ステップ間の遅延
    const delay = step.delayMs || 200;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    return { type: step.type, success: true };
    
  } catch (error) {
    console.error(`❌ Error executing step ${stepIndex + 1}:`, error.message);
    throw error;
  }
}

// プラン実行（エラーハンドリング強化版）
async function runPlan(planName, debugMode = false, parameters = {}) {
  try {
    console.log(`🚀 Starting plan: ${planName}${debugMode ? ' [DEBUG MODE]' : ''}`);
    
    const actionsData = await readFile(ACTIONS_JSON_PATH, "utf8");
    const actionsFile = JSON.parse(actionsData);
    
    // 新しい構造: プランが直接キーになっている
    if (!actionsFile[planName] || !actionsFile[planName].plan) {
      throw new Error(`Plan not found: ${planName}`);
    }
    
    let steps = actionsFile[planName].plan;
    
    // パラメータがある場合、ステップにパラメータを注入
    if (parameters && Object.keys(parameters).length > 0) {
      steps = steps.map(step => {
        const newStep = { ...step };
        // 各ステップのプロパティをチェックして、パラメータを注入
        for (const [key, value] of Object.entries(parameters)) {
          if (newStep[key] === undefined && key !== 'debugMode') {
            newStep[key] = value;
          }
        }
        return newStep;
      });
    }
    
    console.log(`📋 Plan has ${steps.length} steps`);
    
    let successCount = 0;
    let skipCount = 0;
    let results = [];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await runStep(step, i, steps.length, debugMode);
        results.push(result);
        
        if (result.skipped) {
          skipCount++;
          console.log(`⏭️  Step ${i + 1} skipped: ${result.reason}`);
        } else {
          successCount++;
          console.log(`✅ Step ${i + 1} completed successfully`);
        }
        
      } catch (error) {
        const failureResult = { failed: true, reason: error.message, stepIndex: i + 1 };
        results.push(failureResult);
        
        // continueOnError オプションがある場合は続行
        if (step.continueOnError) {
          console.warn(`⚠️  Step ${i + 1} failed but continuing: ${error.message}`);
          skipCount++;
          continue;
        } else {
          throw error;
        }
      }
    }
    
    const summary = `Plan completed: ${successCount} successful, ${skipCount} skipped`;
    console.log(`\n🎉 ${summary}`);
    return { 
      success: true, 
      summary, 
      successCount, 
      skipCount, 
      totalSteps: steps.length,
      results 
    };
    
  } catch (error) {
    console.error(`💥 Plan execution failed:`, error.message);
    throw error;
  }
}

// MCPサーバーを作成
const server = new Server(
  {
    name: "GUI Bot WASM",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 動的ツールリスト生成
async function generateToolsFromActions() {
  try {
    const actionsData = await readFile(ACTIONS_JSON_PATH, "utf8");
    const actionsFile = JSON.parse(actionsData);
    
    const tools = [];
    
    // 新しい構造: 各プラン名が直接キーになっている
    for (const [planName, planData] of Object.entries(actionsFile)) {
      // planData.metadata と planData.plan が存在することを確認
      if (planData.metadata && planData.plan) {
        const metadata = planData.metadata;
        
        tools.push({
          name: planName,
          description: metadata.description || `Execute automation plan: ${planName}`,
          inputSchema: {
            ...metadata.parameters,
            properties: {
              ...metadata.parameters.properties,
              debugMode: {
                type: "boolean",
                description: "Enable debug mode with detailed logging and image saving",
                default: false
              }
            }
          }
        });
      }
    }
    
    console.error(`📋 Loaded ${tools.length} automation plans as MCP tools`);
    return tools;
    
  } catch (error) {
    console.error("❌ Error loading actions.json:", error);
    // フォールバック: 空のツールリスト
    return [];
  }
}

// ツールリストハンドラー（動的生成）
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await generateToolsFromActions();
  
  return {
    tools
  };
});

// ツール実行ハンドラー（動的対応）
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    // actions.jsonからプラン一覧を取得
    const actionsData = await readFile(ACTIONS_JSON_PATH, "utf8");
    const actionsFile = JSON.parse(actionsData);
    
    // プラン名がツール名として指定された場合、そのプランを実行
    if (actionsFile[name] && actionsFile[name].plan) {
      console.log(`🚀 Executing plan: ${name}`);
      const debugMode = args.debugMode || false;
      
      // debugModeを除いた残りのパラメータを取得
      const parameters = { ...args };
      delete parameters.debugMode;
      
      const result = await runPlan(name, debugMode, parameters);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    // プランが見つからない場合
    const availablePlans = Object.keys(actionsFile).filter(key => 
      actionsFile[key].plan && actionsFile[key].metadata
    );
    throw new Error(`Unknown plan: ${name}. Available plans: ${availablePlans.join(', ')}`);
    
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// プロセス引数で即座にプランを実行する場合
if (process.argv[2]) {
  const planName = process.argv[2];
  console.log(`Running plan from command line: ${planName}`);
  
  try {
    const result = await runPlan(planName);
    console.log(JSON.stringify(result, null, 2));
    console.log("Plan execution completed, starting MCP server...");
  } catch (error) {
    console.error("Command line plan execution failed:", error);
    process.exit(1);
  }
}

// MCPサーバーを開始
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP GUI Bot server started");
}

// メイン実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Server failed to start:", error);
    process.exit(1);
  });
}
