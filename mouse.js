import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MOUSE_TOOL_PATH = join(__dirname, "MouseTool");


// Swift MouseToolを実行するヘルパー関数
async function executeMouseTool(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(MOUSE_TOOL_PATH, args);

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("exit", (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`MouseTool failed with code ${code}: ${stderr}`));
            }
        });

        child.on("error", (error) => {
            reject(error);
        });
    });
}

// マウス移動
async function moveToPosition(point) {
    try {
        console.log(`Moving mouse to (${point.x}, ${point.y})`);
        await executeMouseTool(["move", point.x.toString(), point.y.toString()]);
    } catch (error) {
        console.error("Failed to move mouse:", error);
        throw error;
    }
}

// クリック実行
async function clickAtCurrentPosition() {
    try {
        console.log("Clicking at current position");
        await executeMouseTool(["click"]);
    } catch (error) {
        console.error("Failed to click:", error);
        throw error;
    }
}

// キープレス実行（改良版）
async function pressKey(keyInput) {
    try {
        const keyCode = resolveKeyCode(keyInput);
        console.log(`Pressing key: ${keyInput} (code: ${keyCode})`);
        await executeMouseTool(["key", keyCode.toString()]);
    } catch (error) {
        console.error("Failed to press key:", error);
        throw error;
    }
}

// キーコード解決（文字列または数値を受け付け）
function resolveKeyCode(input) {
    // 数値の場合はそのまま返す
    if (typeof input === 'number') {
        return input;
    }

    // 文字列の場合
    if (typeof input === 'string') {
        // 数値文字列の場合は数値に変換
        const numericValue = parseInt(input, 10);
        if (!isNaN(numericValue)) {
            return numericValue;
        }

        // 大文字に変換してマッピングから検索
        const upperKey = input.toUpperCase();
        if (KEY_CODES[upperKey] !== undefined) {
            return KEY_CODES[upperKey];
        }

        // マッピングにない場合はエラー
        throw new Error(`Unknown key: ${input}. Supported keys: ${Object.keys(KEY_CODES).join(', ')}`);
    }

    throw new Error(`Invalid key code type: ${typeof input}. Expected string or number.`);
}


// キーコードマッピング（文字列 → 数値）
const KEY_CODES = {
    // 特殊キー
    'ESC': 53,
    'ESCAPE': 53,
    'TAB': 48,
    'SPACE': 49,
    'ENTER': 36,
    'RETURN': 36,
    'BACKSPACE': 51,
    'DELETE': 117,
    'SHIFT': 56,
    'CONTROL': 59,
    'CTRL': 59,
    'OPTION': 58,
    'ALT': 58,
    'COMMAND': 55,
    'CMD': 55,
    'CAPS_LOCK': 57,

    // 音量キー
    'VOLUME_UP': 72,
    'VOLUME_DOWN': 73,
    'MUTE': 74,

    // ファンクションキー
    'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96, 'F6': 97,
    'F7': 98, 'F8': 100, 'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111,

    // 矢印キー
    'UP': 126,
    'DOWN': 125,
    'LEFT': 123,
    'RIGHT': 124,
    'ARROW_UP': 126,
    'ARROW_DOWN': 125,
    'ARROW_LEFT': 123,
    'ARROW_RIGHT': 124,

    // 数字キー（メインキーボード）
    '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23,
    '6': 22, '7': 26, '8': 28, '9': 25,

    // アルファベット
    'A': 0, 'B': 11, 'C': 8, 'D': 2, 'E': 14, 'F': 3, 'G': 5, 'H': 4,
    'I': 34, 'J': 38, 'K': 40, 'L': 37, 'M': 46, 'N': 45, 'O': 31,
    'P': 35, 'Q': 12, 'R': 15, 'S': 1, 'T': 17, 'U': 32, 'V': 9,
    'W': 13, 'X': 7, 'Y': 16, 'Z': 6,

    // 記号キー
    '-': 27, '=': 24, '[': 33, ']': 30, '\\': 42, ';': 41, "'": 39,
    ',': 43, '.': 47, '/': 44, '`': 50,

    // 数字キーパッド
    'NUMPAD_0': 82, 'NUMPAD_1': 83, 'NUMPAD_2': 84, 'NUMPAD_3': 85,
    'NUMPAD_4': 86, 'NUMPAD_5': 87, 'NUMPAD_6': 88, 'NUMPAD_7': 89,
    'NUMPAD_8': 91, 'NUMPAD_9': 92,
    'NUMPAD_MULTIPLY': 67, 'NUMPAD_PLUS': 69, 'NUMPAD_MINUS': 78,
    'NUMPAD_DECIMAL': 65, 'NUMPAD_DIVIDE': 75, 'NUMPAD_ENTER': 76,
    'NUMPAD_EQUALS': 81
};



export { moveToPosition, clickAtCurrentPosition, pressKey };