# Macの操作をAIで自動化する

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Sponsor](https://img.shields.io/github/sponsors/belcrod5)](https://github.com/sponsors/belcrod5)

**Macのあらゆる操作を、AIで自動化することを目指すプロジェクトです。**

画面に表示されている内容をOCRで読み取り、その意味をAIが理解。そして、まるで人間のようにマウスやキーボードを操作することで、これまで手動で行っていた定型作業や複雑なタスクを自動化します。

このツールはModel-Context Protocol (MCP)に対応しており、外部のAIエージェントから簡単に呼び出して利用できます。

## 特徴
- ✅ **ビジュアル化と透明性**: AIが取得した情報や処理しようとしていることを画面上に表示するようにしています。
- ✅ **完全オープンソース**: Apache 2.0およびその他の寛容なライセンスに基づいています。
- ✅ **MCP互換**: GUI制御機能をツールとして公開するMCPサーバーとして実行できます。
- ✅ **画像認識**: テンプレートマッチングによる操作の自動化。
- ✅ **マルチディスプレイ対応**: 接続されているすべてのディスプレイ上の要素を検索し、操作できます。

## ユースケース

このツールは、「画面上の画像を見つけてクリックする」といった単純なGUI自動化タスクに最適です。1080pから1440pのディスプレイ環境での使用を想定しています。


#### 機能一覧
| 用途             | 機能                            |
|------------------|---------------------------------|
| Youtube広告のスキップ   | 広告のスキップ               |
| アプリケーションOCR   | Macで起動中のアプリのテキストを判別、判別からクリックも可能               |
| 音量操作   | Macの音量をパーセンテージ指定で変更します               |mac-control-mcp)     |
| ノイズキャンセル操作   | ノイズキャンセルのON、OFFの操作               |mac-control-mcp)     |

## プラットフォーム

macOS (Apple Silicon / Intel)


## セットアップ

### 1. MCPサーバーの登録方法

```json
{
  "mcpServers": {
    "mac-control-mcp": {
      "command": "node",
      "args": [
        "{mac-control-mcpのルートパス}/index.js",
      ]
    }
  }
}
```

※ nodeが認識しない場合は ターミナルで `which node`とコマンドを実行したnodeのフルパスを使うと確実に動作します
```bash
例
% which node
/Users/{ユーザー名}/.nodebrew/current/bin/node
```

### 2. アクセシビリティと画面記録の権限を許可

初回実行時、macOSはターミナルアプリケーション（例: ターミナル、iTerm2、Visual Studio Code）に対してアクセシビリティと画面記録の権限を要求します。`システム設定 > プライバシーとセキュリティ`でこれらの要求を許可してください。

## デバッグ

### 定義済みプランの実行

`actions.json`で定義されたプランをコマンドラインから実行します。

```bash
# 例: "youtube_ad_skip" プランを実行
node index.js "youtube_ad_skip"
```

## カスタマイズ
### アクション定義 (`actions.json`)

`actions.json`で複数ステップの自動化シーケンス（プラン）を定義します。

```json
{
  "youtube_ad_skip": {
    "metadata": { "description": "YouTube広告をスキップします" },
    "plan": [
      {
        "type": "mouse_move",
        "text": "スキップ",
        "target_app": "Google Chrome",
        "threshold": 0.6
      },
      { "type": "wait", "ms": 500 },
      { "type": "click" }
    ]
  },
  "volume_up": {
    "metadata": { "description": "システムの音量を10%上げます" },
    "plan": [
      { "type": "volume_up", "amount": 10 }
    ]
  }
}
```

### ステップの種類

-   `mouse_move`: OCRまたは画像でテキストを検索し、その位置にマウスを移動します。
    -   `img`: テンプレート画像のパス。
    -   `text`: OCRで検索するテキスト。
    -   `target_app`: (任意) 検索対象のアプリケーション。
    -   `threshold`: (任意) マッチングの信頼度のしきい値 (0.0-1.0)。
-   `click`: 現在のマウス位置でクリックします。
-   `key`: キーを押します。
    -   `keyCode`: 数値のキーコード。
-   `wait`: 実行を一時停止します。
    -   `ms`: 待機時間（ミリ秒）。
-   `volume_up`/`volume_down`/`volume_set`: システムの音量を制御します。
-   `get_app_list`/`get_app_ocr`: アプリケーションウィンドウを管理し、OCRを実行します。


## トラブルシューティング

### 権限エラー

権限に関するエラーが発生した場合、ターミナルが`システム設定 > プライバシーとセキュリティ > アクセシビリティ`および`画面記録`で必要な権限を持っていることを確認してください。

### 画像が見つからない

-   `actions.json`内のテンプレート画像のパスを確認してください。
-   `threshold`の値を下げてみてください（例: `0.7`）。
-   対象の画像が画面に表示されていることを確認してください。

## パフォーマンス

-   **1080p-1440p**: 良好なパフォーマンス。
-   **4K**: WASMモジュールのシングルスレッド性のために遅くなります（150-300ms）。

## ライセンス

このプロジェクトは **Apache 2.0 ライセンス** の下で公開されています。

ただし、将来的にプロジェクトの継続性を担保するため、商用利用を制限するライセンス（BUSLなど）へ変更する可能性があることをご了承ください。

### 利用しているライブラリ

本プロジェクトは、以下のオープンソースソフトウェアを利用しています。素晴らしいソフトウェアを提供してくださる開発者の皆様に感謝します。

- **OpenCV.js**: Apache-2.0 License
- **@modelcontextprotocol/sdk**: Apache-2.0 License
- **canvas**: MIT License
- **jimp**: MIT License
- **jsdom**: MIT License
- **node-mac-displays**: MIT License
- **screenshot-desktop**: MIT License