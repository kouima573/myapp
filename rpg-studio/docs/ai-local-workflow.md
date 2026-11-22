# Codex / Claude Codeでローカル制作

この工房はAI APIを内蔵しません。プロジェクト一式をPCに展開し、そのフォルダーをCodexまたはClaude Codeの作業フォルダーとして開いて、AIにJSON・画像・スクリプトなどの実ファイルを読ませて制作します。モデルへの送信やデータの取り扱いは利用するAIサービスとアカウントの設定に従います。

## 使い始める

1. `rpg-studio` のZIPをPC上の作業フォルダーへ展開します。
2. Codex Desktopで展開先フォルダーをプロジェクトとして開くか、そのフォルダーからCodex CLIを起動します。Claude Codeも同じフォルダーを作業ディレクトリにして起動します。
3. Codexはルートの `AGENTS.md`、Claude Codeは `CLAUDE.md` から共通の `AGENTS.md` を参照します。対象プロジェクトの `IDEA.md` があれば発想の正本として読み、`README.md` があれば概要を確認します。Node.js 22以上とpnpm 10.18.0を用意して `pnpm install` を実行すると、検証・試遊・ビルド用のCLIも使えます。
4. スキルを直接呼び出すか、普通の言葉で作りたい内容を頼みます。

```text
Codex:       $rpg-studio projects/sample-rpg に、村人に話しかけると橋の修理を頼まれるイベントを追加してください。
Claude Code: /rpg-studio projects/sample-rpg に、村人に話しかけると橋の修理を頼まれるイベントを追加してください。
```

`sample-rpg` は作業するプロジェクトIDに置き換えます。スキル名を指定しなくても、依頼内容に合えばAIが選ぶことがあります。Claude Codeでは `/skills` で利用できるスキルを確認できます。Codexはスキルの場所と `SKILL.md` にある説明をもとに必要なときに読み込みます。

## スキルの置き場所

このプロジェクトには両ツール向けの同じ `rpg-studio` スキルを同梱しています。

| ツール | プロジェクト内の場所 | 呼び出し |
| --- | --- | --- |
| Codex | `.agents/skills/rpg-studio/SKILL.md` | `$rpg-studio` |
| Claude Code | `.claude/skills/rpg-studio/SKILL.md` | `/rpg-studio` |

スキルの本文はプレーンテキストのMarkdownです。内容を確認・編集したいときは、両方の `SKILL.md` を同じ内容に保ってください。共通の制作規約はルートの `AGENTS.md` に置き、Claude Code用の入口 `CLAUDE.md` もそこへ案内します。

## AIへの頼み方

- 何を作るか、対象プロジェクト、プレイヤーがどう操作し何が起きるかを伝えます。細かい実装方法が決まっていなくても、遊びの意図を説明すれば既存データを調べて実装案を作れます。
- 作品の核となる発想は `projects/<id>/IDEA.md` に書くと、別の会話でも作り手の意図を参照できます。
- 画像・音・フォントは希望する雰囲気や用途を伝えます。第三者素材の取得元や利用条件を確認し、候補を選ぶ段階は利用者が行います。
- 「実装だけ」「まず案を見せて」「検証まで」など、今回どこまで進めるかも指定できます。

## ローカル環境での確認

```sh
pnpm rpg validate --project projects/<id>
pnpm rpg test --project projects/<id>
pnpm rpg build --project projects/<id>
```

AIには必要な作業範囲のコマンドを依頼できます。変更したファイルと実行したコマンドの結果を確認し、ユーザーの意図どおりかを見てから配布してください。AIがファイルを変更できる範囲は、CodexまたはClaude Code側でこのフォルダーに設定したアクセス権に従います。
