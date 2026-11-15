// Builds the public website (Cloudflare Pages etc.): the studio in Preview mode (edits stay in the browser)
// and the two sample games. Output: dist/site/. Run with `pnpm build:site`; deploy with `pnpm deploy:site`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "site");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const copy = async (from, to) => fs.cp(path.join(root, from), path.join(out, to), { recursive: true });
await copy("dist/studio", "studio");
await copy("dist/game/sample-rpg", "play");
await copy("dist/game/genre-gallery", "gallery");
await fs.copyFile(path.join(root, "studio", "public", "favicon.svg"), path.join(out, "favicon.svg")).catch(() => {});

await fs.writeFile(path.join(out, "index.html"), `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RPGシステム工房</title><link rel="icon" href="favicon.svg">
<meta name="description" content="発想がそのままRPGになる、AIエージェントと一緒に使うRPG制作ツール。">
<style>
:root{color-scheme:dark;--bg:#111511;--card:#192019;--line:#2c362c;--text:#e8eee6;--muted:#9aa898;--accent:#f0b450}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 16px}h1{font-size:30px;margin:0 0 4px}p{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:28px 0}
a.card{display:block;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);text-decoration:none}
a.card:hover{border-color:var(--accent)}a.card b{display:block;font-size:18px;margin-bottom:4px;color:var(--accent)}
code{background:#0c100c;padding:2px 6px;border-radius:4px}small{color:var(--muted)}
</style></head><body><main>
<h1>RPGシステム工房</h1>
<p>発想がそのままRPGになる制作ツール。Codex や Claude Code などのAIエージェントと会話しながら、マップ・会話・戦闘・独自の仕組み・素材まで作れます。</p>
<div class="grid">
<a class="card" href="./play/"><b>見本ゲームを遊ぶ</b>森境の小さな冒険（種族・動詞・ジャンルモジュール・スクリプトの見本）</a>
<a class="card" href="./gallery/"><b>ジャンルの回廊</b>25種のジャンルモジュールと内蔵素材ライブラリの見本</a>
<a class="card" href="./studio/"><b>工房を試す（Preview）</b>見本プロジェクトで工房を操作できます。変更はブラウザの中だけで、保存されません</a>
</div>
<p><small>自分のゲームを作るには、手元で <code>pnpm studio</code> を起動してください（ファイルの保存・ビルド・自動テストはローカル版の機能です）。<br>
見本の素材はすべて内蔵ジェネレーター・AI生成・内蔵効果音／楽譜BGMによるもので、第三者のサイト素材は含みません。</small></p>
</main></body></html>
`);
await fs.writeFile(path.join(out, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
`);
let files = 0, bytes = 0;
const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else { files++; bytes += (await fs.stat(p)).size; } } };
await walk(out);
console.log(`OK site: ${path.relative(root, out)}（${files}ファイル、${(bytes / 1024 / 1024).toFixed(1)}MB）`);
