import { spawn } from "node:child_process";

// 音量制御（AppleScriptを使用 - 非線形補正対応）
const VOLUME_STEPS = [
  0, 6, 13, 19, 25, 31, 38, 44,
  50, 56, 63, 69, 75, 81, 88, 94, 100
];

// 音量制御（AppleScriptを使用 - 非線形補正対応）
function nearestStep(val) {
  return VOLUME_STEPS.reduce((closest, s) =>
    Math.abs(s - val) < Math.abs(closest - val) ? s : closest, 0);
}


// 音量制御（AppleScriptを使用 - 非線形補正対応）
export async function controlVolume(mode, value = 10) {
  return new Promise((resolve, reject) => {
    let script, msg;

    switch (mode) {
      case "set": {
        if (value < 0 || value > 100)
          return reject(new Error(`0-100 で指定してください (${value})`));

        const stepVal = nearestStep(Math.round(value));
        script = `osascript -e 'set volume output volume ${stepVal}' -e 'output volume of (get volume settings)'`;
        msg = `🔊 要求 ${value}% → 最近接ステップ ${stepVal}%`;
        break;
      }

      case "up":
      case "down": {
        const sign = mode === "up" ? "+" : "-";
        script = `
          osascript -e '
            set v to (output volume of (get volume settings)) ${sign} ${Math.abs(
              value
            )}
            if v > 100 then set v to 100
            if v < 0   then set v to 0
            set volume output volume (my roundToStep(v))
            on roundToStep(n)
              set steps to {${VOLUME_STEPS.join(",")}}
              set best to item 1 of steps
              repeat with s in steps
                if (abs(s - n) < abs(best - n)) then set best to s
              end repeat
              return best
            end roundToStep
          '
        `;
        msg = `🔊 ${mode === "up" ? "上げ" : "下げ"} ${value}%`;
        break;
      }

      default:
        return reject(new Error("mode は set / up / down"));
    }

    const child = spawn("sh", ["-c", script.trim()]);
    let out = "";
    child.stdout.on("data", d => (out += d));
    child.on("exit", () => {
      console.log(`${msg}\n🔍 実スライダー = ${out.trim()}%`);
      resolve();
    });
    child.on("error", reject);
  });
}
