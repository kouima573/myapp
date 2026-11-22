# デスクトップ版ゲームの作り方（ロードマップ188）

この工房は `pnpm rpg build --project <プロジェクト>` で、ブラウザだけで動く静的ゲームを `dist/game/<プロジェクトID>/` に出力します。このフォルダーをデスクトップアプリの画面として読み込めば、既存のランタイムを使ったWindows/macOS/Linux向けアプリを作れます。このガイドは**完成したゲームの配布**を対象にします。工房そのものをデスクトップ化する手順ではありません。

## 方式を選ぶ

| 方式 | 向いている場合 | 主な特徴 |
| --- | --- | --- |
| PWAのまま配布 | Webリンクで公開でき、インストール不要を優先 | 追加のデスクトップ用コードやOS別ビルドが不要。`rpg build` がホーム画面追加とオフライン用ファイルも生成 |
| Tauri | 静的ゲームを小さなネイティブ枠に入れたい | 既存のHTML/CSS/JSを画面として使う。RustとOS別の開発依存が必要で、描画はOSのWebViewを使う |
| Electron | Node.js連携や大きなElectron拡張エコシステムが必要 | ChromiumとNode.jsを同梱するため動作環境をそろえやすい。アプリ容量が増え、配布・更新・署名の管理が必要 |

このプロジェクトはビルド済みの静的ゲームだけで動くため、ネイティブAPIを使わない初版なら**Tauriを先に検討**できます。Web公開だけで要件を満たすなら、現在のPWAをそのまま使うのが最短です。TauriはOSのWebViewに依存するので、各OSで表示・音声・入力を確認してください。Electronは独自APIやNode連携が必要になった段階で選ぶとよいでしょう。

## 共通の準備

プロジェクトのルートで対象のゲームを検証し、静的ファイルを作ります。

```sh
pnpm install
pnpm rpg validate --project projects/sample-rpg
pnpm rpg test --project projects/sample-rpg
pnpm rpg build --project projects/sample-rpg
```

`projects/sample-rpg` は対象プロジェクトに置き換えます。生成物は `dist/game/<プロジェクトID>/` にあり、`index.html`・ゲームのJavaScript・`data/` 内のプロジェクトデータと素材をまとめて含みます。配布用ラッパーからは、このフォルダー全体を参照または同梱します。`--zip` が作るZIPは静的ゲームのアーカイブで、インストーラーではありません。

## Tauriで包む

1. Tauri v2 の公式手順で `desktop/tauri/` にラッパーを作ります。Rust、Node.js、OSごとの依存を先に用意します。WindowsではC++ Build ToolsとWebView2、macOSではXcode Command Line Tools、LinuxではディストリビューションごとのWebKitGTK等が必要です。
2. `src-tauri/tauri.conf.json` の `build.frontendDist` を、ゲームのビルド出力へ向けます。たとえばラッパーが `desktop/tauri/`、プロジェクトIDが `sample-rpg` の場合、設定ファイルからの相対パスは次のようになります。

   ```json
   {
     "build": {
       "frontendDist": "../../../dist/game/sample-rpg"
     }
   }
   ```

   `frontendDist` は `tauri.conf.json` がある `src-tauri/` からの相対パスです。プロジェクトIDや配置場所を変えたら、この値も合わせます。
3. 対象のゲームをルートでビルドしてから、Tauriラッパーのディレクトリで `pnpm exec tauri build` を実行します。出力先やインストーラー形式は `tauri.conf.json` の `bundle` 設定で決めます。
4. 無署名の開発用ビルドを別PCで起動し、後述の確認をします。一般配布では各OSの署名要件を確認し、必要な証明書・署名・macOSの公証を設定します。

Tauriは静的フロントエンドを `frontendDist` からアプリに同梱できます。ファイルアクセスなどのネイティブ機能を使わない間は、プラグインや権限を追加しないでください。必要になった機能だけを capability として許可し、CSPもゲームの構成に合わせて制限します。

## Electronで包む

1. Electron公式チュートリアルに沿って `desktop/electron/` にラッパーを作り、配布はElectron Forgeを使います。
2. `rpg build` でできた `dist/game/<プロジェクトID>/` をElectronのパッケージに含め、起動時にその `index.html` をウィンドウに表示します。Electronの `BrowserWindow.loadFile()` はローカルHTMLの試作に使えます。Electronのセキュリティガイドは `file://` を避けカスタムプロトコルを使うよう勧めているため、一般配布前に公式のセキュリティ指針に沿って読み込み方式を決めてください。
3. RendererではNode.js統合を有効にせず、context isolation と sandbox を有効にします。このゲームだけを表示する場合は、preloadやIPCを追加する必要はありません。外部サイトをアプリ内で開かず、画面遷移と新しいウィンドウも制限し、CSPを設定します。
4. Electron Forgeで対象OS向けの配布物を作成します。ElectronアプリはOSごとにビルド・署名要件を確認します。macOSアプリの署名と公証などは配布先に応じて準備します。

## セーブと更新で気をつけること

- ブラウザ版とデスクトップ版は保存領域が分かれます。既存ブラウザのIndexedDBセーブが自動でデスクトップ版に現れるとは限りません。ブラウザ版の「ファイルに書き出す」で退避し、デスクトップ版の「ファイルから読み込む」でロードしたあと、ゲーム内のセーブ枠へ保存します。
- アプリの識別子・保存先・読み込み元をリリース間で不用意に変えると、以前の設定やセーブを見つけられなくなる場合があります。更新版を同じPCへ上書きして、セーブが残ることを確認します。
- `rpg build` のPWA用 `manifest.webmanifest` と `sw.js` はWeb配布用です。現在のランタイムはService Workerを `http(s)` のときだけ登録します。デスクトップアプリはファイル一式を同梱するため、Service Workerによるキャッシュ更新には依存しません。
- プロジェクトに含める画像・音声・フォントの再配布条件を確認し、同梱するクレジットも確認します。共有可能性の検査は `pnpm rpg validate --project <プロジェクト>` で行います。

## 配布前の確認

1. ネット接続を切って起動し、タイトル表示・マップ・音声・操作が動く。
2. セーブ、アプリの終了と再起動、ロードを確認する。
3. セーブの書き出しと読み込みを確認する。
4. 画面の拡大縮小、全画面、キーボードとタッチ操作、長い日本語タイトルや素材名を確認する。
5. Windows・macOS・Linuxのそれぞれ、実際に配布する環境で確認する。WebViewの種類やOSの署名・インストーラーが異なるため、別OSで作った成果物がそのまま動くと仮定しない。
6. 署名済みの配布物をクリーンなユーザーアカウントまたは別PCにインストールし、更新後もセーブが残ることを確認する。

## 公式資料

- [Tauri: Frontend Configuration](https://v2.tauri.app/start/frontend/)
- [Tauri: Prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri: Distribute](https://v2.tauri.app/distribute/)
- [Tauri: Security and Capabilities](https://v2.tauri.app/security/)
- [Electron: Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Electron: Security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron: Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)

この資料はラッパーの選び方と構成を示すガイドです。Electron/Tauriのラッパー本体、署名証明書、OS別インストーラーはまだこのリポジトリに追加していません。実際にアプリ化するときは、対象OS・署名方法・配布先を決めてから別途実装します。
