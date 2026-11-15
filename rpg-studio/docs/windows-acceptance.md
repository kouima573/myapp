# Windows実機での受け入れ確認

開発環境（Linux）では Windows 固有の動き（junction、ファイルのロック、パス区切り、改行コード、ファイル監視）を確かめられません。この手順を Windows で一度通し、結果を末尾の記録欄に書いてください。**記録が埋まるまでは「Windows検証済み」とは扱いません。**

所要時間の目安: 30〜45分。PowerShell を使います。

## 0. 準備と記録

```powershell
cd <クローンした場所>\rpg-studio
git pull
node -v; pnpm -v; git --version
[System.Environment]::OSVersion.VersionString
git rev-parse --short HEAD
pnpm install
```

- 本物のサンプルを汚さないように、**ホームフォルダーへのコピー**で確かめます。

```powershell
$W = "$HOME\rpg-win-check"
Remove-Item -Recurse -Force $W -ErrorAction SilentlyContinue
Copy-Item -Recurse projects\sample-rpg $W
```

## 1. CLI（期待: すべて OK、警告 0）

```powershell
pnpm check
pnpm test
pnpm rpg validate --project $W
pnpm rpg test --project $W
pnpm rpg build --project $W
```

- `validate` に「バイト数が違う」警告が出たら改行コード（CRLF）の問題です。`git config core.autocrlf` の値も記録してください。

## 2. 工房を起動する

```powershell
pnpm studio --project $W
```

- 表示された `http://127.0.0.1:4173/` をブラウザで開く。
- 期待: 上部に「ローカルファイル接続」「検証OK」「ビルド OK」。
- 「試遊」で村を歩き、長老に話しかけ、スライムと1回戦う。

## 3. 工房で編集して保存する

1. 「敵・アイテム・仲間」→ 敵「コケスライム」→ 最大HPを 7 → 9 にして別の欄をクリック。
   - 期待: 右上が「保存待ち」→「保存済み」。`$W\database.json` を開くと `"maxHp": 9`。
2. 「マップ」→「風穴の遺跡」→ 選択ツール（V）で封印の石扉をクリック → 右側に状態のフォームが出る。表示名に何か入れる。
   - 期待: `$W\maps\ruins.json` に反映。検証OKのまま。
3. 「会話・イベント」→「＋イベント」で新規作成。
   - 期待: `$W\events.json` に追加。
4. 保存後に `git diff --no-index --stat projects\sample-rpg $W` で、変更が上の3ファイルだけであること（改行が全行変わっていないこと）。

## 4. 外部での変更を拾う（watcher）

工房を開いたまま、メモ帳などで `$W\dialogues.json` の台詞を1つ書き換えて保存。

- 期待: 数秒以内に工房の表示が新しい台詞になり、ログに再読み込みが出る。工房側で同じ物を編集中なら「衝突」として最新内容が示される（上書きしない）。

## 5. 保存の失敗で元のデータが残る（rename失敗）

別の PowerShell で、ファイルを「読めるが置き換えられない」状態でつかみます。

```powershell
$f = [System.IO.File]::Open("$W\database.json", 'Open', 'Read', 'Read')
```

この間に工房で敵のHPを変えて保存させる。

- 期待: 工房にエラーが表示される。`$W\database.json` は元のまま（壊れない・空にならない）。`$W` に `.database.json.*.tmp` が残らない。

```powershell
Get-ChildItem -Force $W -Filter *.tmp
$f.Close()
```

閉じた後にもう一度保存すると成功すること。

## 6. junction（ディレクトリのリンク）を拒否する

工房を止めてから:

```powershell
$Outside = "$HOME\rpg-outside"
Move-Item "$W\maps" $Outside
cmd /c mklink /J "$W\maps" "$Outside"
pnpm studio --project $W
```

- 期待: マップが junction 経由で読み書きされない（工房にエラーが出て、マップの保存もされない）。`$Outside` の中身が変わらない。
- 確認後に戻す:

```powershell
cmd /c rmdir "$W\maps"
Move-Item $Outside "$W\maps"
```

## 7. エージェントで作業する

- **Codex**: `rpg-studio` で開き、「AGENTS.md を読んで、`$W` の村に新しいイベント（井戸を調べると薬草が1つ手に入る、一度だけ）を追加。validate / test / build を通す」と依頼。
- **Claude Code**: 同様に「既存イベントの文言の修正」と「独自能力（例: 毒が効かない特性）の追加」を依頼。
- 期待: どちらも `pnpm rpg validate/test/build --project $W` が OK。工房を開いていれば自動で反映される。

## 8. 片付け

```powershell
Remove-Item -Recurse -Force $W
```

## 記録欄（コピーして TODO.md かイシューに貼る）

```
日付:
Windows: （例 Windows 11 23H2）
Node / pnpm / git:
コミット:
core.autocrlf:
1 CLI: OK / NG（内容）
2 起動・試遊: OK / NG
3 編集・保存・差分: OK / NG
4 watcher: OK / NG
5 rename失敗で元データ保持: OK / NG
6 junction拒否: OK / NG（工房の表示）
7 Codex: OK / NG　Claude Code: OK / NG
気づいたこと:
```
