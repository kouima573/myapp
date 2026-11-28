# Claude Code — RPGシステム工房

共通の作業規約・完了条件・禁止事項は [`AGENTS.md`](./AGENTS.md) にあります。最初に読んでください。対象に `experience.json` があれば [`docs/experience-projects.md`](./docs/experience-projects.md)、RPG形式の `project.json` があれば [`docs/project-format.md`](./docs/project-format.md)・[`docs/extension-api.md`](./docs/extension-api.md) を参照してください。

タスクに必要なファイルだけを変更し、形式に合う確認方法を使ってください。独立作品の `runtime` が `experience` の場合は `tests/*.experience.json` を `rpg test` で実行できます。`static` は作者のHTML/CSS/JS/WASM等を保持し、ローカル `rpg dev` で試遊してください。ブラウザプレビューの型検査には限界があります。未実行の確認を成功したと報告しないでください。
