# 独立作品形式（experience）

RPGの主人公・マップ・HP・戦闘を使わない独立作品です。`experience.json` の `runtime` で制作方法を選べます。`experience` は状態・入力・画面をTypeScriptで定義する小さな任意ホスト、`static` は完成済みのHTML/CSS/JavaScript/WASM等をそのまま使う方式です。ジャンル・プレイヤーの役割・遊び方・画面構成はどちらも指定しません。

この形式はローカルの Codex／Claude Code と CLI に加え、ブラウザ工房でも編集・素材登録・ZIP出力できます。`experience` はブラウザ内の隔離プレビューとローカルの完全な型検査に対応します。`static` はHTMLの相対モジュール・外部ファイル・WASMをブラウザ工房内で実行せず、ローカルの `rpg dev` または書き出したサイトZIPで試遊します。ブラウザ工房ではRPG StudioのプロジェクトZIPに加え、`index.html` を含む完成済みサイトZIPも読み込めます。ソースから作る場合は `experience.json` に任意のビルド設定を記録できます。コマンドはブラウザや通常の検証では実行せず、ローカルCLIで `--run-project-build` を明示したときだけ実行します。「チャットで作る」のJSON変更形式はRPG向けなので、独立作品は作り手が選んだファイル編集型AIや任意の制作方法で進めてください。既存の `project.json` 作品はこれまで通りRPG形式で動きます。

## 始め方

```sh
pnpm rpg new my-experience --type experience --title "作品名"
pnpm rpg validate --project projects/my-experience
pnpm rpg dev --project projects/my-experience
pnpm rpg build --project projects/my-experience --zip

# 独自のHTML/CSS/JavaScript/WASMサイトをそのまま使う場合
pnpm rpg new my-site --type experience --runtime static --title "作品名"
pnpm rpg dev --project projects/my-site
pnpm rpg build --project projects/my-site --zip
```

`rpg dev` はローカルで必要なファイルをビルド先へコピーし、`127.0.0.1` 上に試遊画面を配信します。`experience` の `rpg build` はTypeScriptを型検査・bundleし、ホストとPWA用ファイルを作ります。`static` はHTML・CSS・JS・WASM等を変換せずコピーします。ソースからビルドする場合は、`build.command` と `build.outputDir` を `experience.json` に設定します。ビルド後の `build.outputDir` 直下に公開入口の `index.html` が必要です。`rpg build` は成果物があればパッケージし、コマンドを実行するには `--run-project-build` が必要です。通常の `validate`・`test`・`dev`、ブラウザ版ではこのコマンドを実行しません。静的サイト自体の型検査・自動テストは作品側の方法を使います。ビルドから `.git`、`node_modules`、`.rpg-studio`、`.rpg-backup`、`.env` と `.env.*` は除外します。ZIPを配布するときは素材の再配布条件とクレジットを確認してください。

```json
{
  "formatVersion": 1,
  "id": "my-site",
  "title": "作品名",
  "runtime": "static",
  "entry": "index.html",
  "build": {
    "command": "pnpm run build",
    "outputDir": "dist"
  },
  "assetsPath": "assets.json",
  "args": {},
  "save": { "enabled": true, "autosave": true }
}
```

設定したビルドを実行して公開ZIPを作る例です。`build.command` はシェルコマンドなので、内容を確認してから明示フラグを付けてください。

```sh
pnpm rpg build --project projects/my-site --run-project-build --zip
pnpm rpg dev --project projects/my-site
```

## ファイル

| ファイル | 役割 |
| --- | --- |
| `experience.json` | 作品ID・タイトル・`runtime`（`experience` / `static`）・入口・素材一覧の場所 |
| `experience.json` の `build` | 任意。`static` 専用のシェルコマンドと成果物フォルダー。明示フラグなしでは実行しない |
| `systems/main.ts` | `experience` runtime の状態遷移・入力処理・画面表示。`static` では不要 |
| `index.html` / 任意のファイル | `static` runtime の起点と、作り手が選んだHTML/CSS/JS/WASM等の構成 |
| `assets.json` | 工房で登録した素材の出典・規約・クレジット・ファイル一覧 |
| `tests/*.experience.json` | `experience` runtime の入力と状態期待値のシナリオ。`static` では自動実行しません |

`experience.json` は `project.json` と別の形式です。両方を同じ作品に置かず、作り手の発想・既存ファイル・制作希望に合う方を選んでください。

## 自分の実行環境を使う（`runtime: "static"`）

この方式ではRPG Studioのランタイム契約はありません。`index.html` からどんな仕組みを起動するかは作り手が決めます。Canvas・WebAudio・DOM・WebGL・Worker・ES modules・WASM・自前のゲームループなどを組み合わせられます。`rpg build` はファイルをそのまま出力し、`rpg dev` は相対パスを保ってローカル配信します。工房で追加したファイル以外もプロジェクトフォルダーからコピーされます。Vite・Webpack等のソースビルドを使う場合は、任意のビルド設定を記録できます。`rpg build` は成果物がすでにあればコマンドを実行せずに出力できます。設定コマンドの実行には、ローカルCLIでの `--run-project-build` が必要です。ブラウザ工房はコマンドを実行しません。

ブラウザ工房の「素材と出典」ではPNG・OGG・MP3・WAV・WOFF2・WOFF・TTF・OTFを作品内に取り込み、`assets.json` に出典・規約・クレジットを記録できます。ブラウザ版では本体をブラウザ内に保存し、プロジェクトZIPとサイトZIPに含めます。WASMや独自形式のデータはZIPから取り込むか、ローカル作品フォルダーに置いてください。外部サイト・有料API・クラウドビルドは使いません。

## 体験の定義

入口ファイルは `@rpg/engine` から `defineExperience` と型を読み込み、既定 export に作品の定義を返します。

```ts
import { defineExperience, type ExperienceInput } from "@rpg/engine";

type State = { page: number };

export default defineExperience<State>({
  id: "my-experience", // experience.json の id と一致
  version: 1,           // 保存状態の形を互換性なく変えたら上げる
  title: "作品名",
  start: args => ({ page: Number(args.firstPage ?? 0) }),
  update(state, input: ExperienceInput) {
    if (input.type === "key" && input.key === "confirm") return { page: state.page + 1 };
    if (input.type === "custom" && input.value === "back") return { page: Math.max(0, state.page - 1) };
    return state;
  },
  render(host, view) {
    const button = document.createElement("button");
    button.textContent = `次へ（${view.state.page}）`;
    button.onclick = () => view.send({ type: "key", key: "confirm" });
    host.append(button);
  },
});
```

- `start(args)` は最初の状態を返します。
- `update(state, input)` は次の状態を返す決定的な処理です。入力は `key`（押したキー）、`custom`（作品独自の値）、`frame`（固定FPSと押しっぱなしキー）です。矢印キーとWASDは `up` / `down` / `left` / `right`、EnterとSpaceは `confirm`、Escapeは `cancel` に変換され、その他のキーは小文字で届きます。
- `render(host, view)` が画面全体を作ります。固定のタイトル画面、HUD、マップ、戻るボタンはありません。必要なものを作品側で決めます。
- `view.send()` で入力を送ります。`view.reset()` は最初の状態に戻し、`view.save()` は手動保存を試します。
- `view.assetUrl(id)` は `assets.json` に登録した素材IDをビルド後のURLへ解決します。
- 状態をブラウザ保存する場合はJSONにできる値を使います。保存形を壊す変更をするときは `version` を増やすと古い保存状態を読み込みません。
- `fps` を設定すると、その頻度で固定フレーム入力を送ります。シミュレーションは壁時計や `Math.random()` に依存させず、状態から結果を決めてください。
- `checkArgs(args)` は `experience.json` の引数を検証する任意の関数です。

## 入力シナリオ

`tests/` に `*.experience.json` を置くと、`pnpm rpg test --project <dir>` が `start(args)` から始め、`update(state, input)` に入力を順番に渡します。RPG用シナリオとは別形式です。期待値は状態全体の `equals`、部分状態の `contains`、またはドット区切りパスの `paths` で指定できます。

```json
{
  "name": "ページを進めて戻る",
  "args": { "firstPage": 0 },
  "steps": [
    { "input": { "type": "key", "key": "confirm" }, "expect": { "paths": { "page": 1 } } },
    { "input": { "type": "custom", "value": "back" }, "expect": { "contains": { "page": 0 } } }
  ]
}
```

`equals` は状態全体の完全一致、`contains` はオブジェクトの部分一致（配列は先頭から指定分を比較）、`paths` は指定した状態パスの完全一致です。シナリオは状態遷移だけを実行するため、DOMの描画・音・実際の入力機器・ネットワーク・保存UIを検証するものではありません。作品コードはシミュレーション中に `Math.random()` や壁時計で状態を決めず、`frame` 入力を使うと再現可能なシナリオを作りやすくなります。

## 現在の対応範囲と未対応

- `validate`: 形式、入口・素材ファイル、素材記録を確認します。`experience` では既定exportのIDと `checkArgs` も確認します。
- `dev`: 作品形式に合わせてローカル試遊します。ファイル変更で再ビルドします。
- `build`: `experience` は型検査してホスト・PWA用ファイルを作ります。`static` は作品のファイルをそのまま出力します。
- `test`: `experience` の `tests/*.experience.json` で状態遷移を実行します。`static` は形式確認だけで、自動プレイテストは行いません。
- ブラウザ工房・公開サイト: 独立作品のファイル編集・素材登録・ZIP出力ができます。`experience` のブラウザ内TypeScript変換は構文診断のみで、完全な型検査はローカルCLIを使います。`static` の相対ファイルやWASMを含む試遊はローカルCLIを使います。
- 「チャットで作る」の構造化JSON差分取り込み: RPG形式向けです。独立作品はプロジェクトZIPを保存し、ファイル編集型AIから開いてください。

この形式は「どんな作品も実装なしで作れる」という約束ではありません。RPGに収まらない発想が出たとき、RPGの枠に押し込めず、作品自身のTypeScriptで実行形式を持てる入口です。必要な共通部品が見つかったら、複数の作品で使える形にしていきます。
