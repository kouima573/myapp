// Builds the public website (Cloudflare Pages etc.): the studio in browser mode (projects saved in the browser)
// and the two sample games. Output: dist/site/. Run with `pnpm build:site`; deploy with `pnpm deploy:site`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "site");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
// 公開中の版を確かめられるように、トップに版とビルド日時を出す（README の見出しの版）。
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const siteVersion = readme.match(/^# .*?(v\d+(?:\.\d+)+)/m)?.[1] ?? "";
const builtAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const copy = async (from, to) => fs.cp(path.join(root, from), path.join(out, to), { recursive: true });
await copy("dist/studio", "studio");
await copy("dist/game/sample-rpg", "play");
await copy("dist/game/genre-gallery", "gallery");
await copy("dist/runtime", "runtime");
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
h2{font-size:20px;margin:36px 0 4px}.steps{color:var(--muted);padding-left:1.3em}.steps li{margin:4px 0}
.prompt{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:12px 14px;margin:12px 0}
.prompt pre{white-space:pre-wrap;margin:0 0 10px;font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;color:var(--text)}
.prompt button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer}
</style></head><body><main>
<h1>RPGシステム工房</h1>
<p>発想がそのままRPGになる制作ツール。Codex や Claude Code などのAIエージェントと会話しながら、マップ・会話・戦闘・独自の仕組み・素材まで作れます。</p>
<div class="grid">
<a class="card" href="./play/"><b>見本ゲームを遊ぶ</b>森境の小さな冒険（種族・動詞・ジャンルモジュール・スクリプトの見本）</a>
<a class="card" href="./gallery/"><b>ジャンルの回廊</b>26種のジャンルモジュールと内蔵素材ライブラリの見本</a>
<a class="card" href="./studio/"><b>工房を開く（ブラウザ版）</b>インストール不要。作ったゲームはこのブラウザに保存され、遊べる形のZIPで書き出せます</a>
</div>
<h2>AIと作ってみる</h2>
<p>このツールは、Codex や Claude Code などのAIに「こんなゲームにして」と話しかけて作るのがいちばん楽です。工房の画面はほとんど開かなくても大丈夫。</p>
<ol class="steps">
<li>工房一式を手元に用意し、フォルダで <code>pnpm install</code>（Node.js 22 以上・pnpm）。</li>
<li>そのフォルダを Claude Code や Codex で開く（AGENTS.md に作業ルールが書いてあり、AIが自動で読みます）。</li>
<li>下の依頼文をコピーして、<b>発想</b>の欄を自分の言葉に書き換えて送る。</li>
</ol>
<div class="prompt"><pre id="ask">新しいゲームを作って。まず pnpm rpg new my-game --stage 1 で土台を作り、次の発想を docs/idea-to-game.md のとおりに形にして。
発想の核を削らず、10分で遊べる最小の形から。素材は内蔵ライブラリから選び、候補は番号つきの見本画像で見せて。
最後に pnpm rpg validate / test / proofread / build がすべて OK になるまで直して、遊び方を3行で教えて。

発想：（例）眠ると夢の中の町に行ける。夢で見つけた物は、起きると少しだけ形を変えて手元に残る。</pre>
<button type="button" id="copy">依頼文をコピー</button></div>
<p><small><b>ChatGPT などのチャットで作る場合</b>（短編向け・インストール不要）: <a href="./studio/">ブラウザ版の工房</a>の「プロジェクト」で新しいゲームを作り、「チャットで作る」画面で作業カードごとに依頼文をコピーしてチャットに貼り、返事を工房に貼り戻します。工房が検証と自動テストをしてから取り込み、できたら「遊べる形で書き出す」でZIPにして公開できます（itch.io なら HTML のゲームとしてそのままアップロード）。長編は Codex（おすすめ）や Claude Code で。どちらも台本（SCRIPT.md）があると話がぶれず、長編は仕様書（SPEC.md）もおすすめです。</small></p>
<p><small>工房（Preview）の「発想」画面でも、発想シートからAI向けの依頼文を作れます。段階別の見本は <code>pnpm rpg new &lt;名前&gt; --stage 1</code>（会話）・<code>2</code>（+戦闘と宝箱）・<code>3</code>（+鍵と門・エンディング）。</small></p>
<script>document.getElementById("copy").addEventListener("click",function(){navigator.clipboard&&navigator.clipboard.writeText(document.getElementById("ask").textContent);this.textContent="コピーしました";});</script>
<p><small>ブラウザ版の作品は、そのブラウザの中だけに保存されます。ときどき「プロジェクトをZIPで書き出す」で手元に残してください。独自のコード（TypeScript）を書く・大きなゲームを作るときは、手元で <code>pnpm studio</code> を起動します。<br>
見本の素材はすべて内蔵ジェネレーター・AI生成・内蔵効果音／楽譜BGMによるもので、第三者のサイト素材は含みません。</small></p>
<p id="site-version"><small>版: ${siteVersion || "（不明）"}　ビルド: ${builtAt}（日本時間）</small></p>
</main></body></html>
`);
await fs.writeFile(path.join(out, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
/
  Cache-Control: no-cache
/*/sw.js
  Cache-Control: no-cache
`);
let files = 0, bytes = 0;
const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else { files++; bytes += (await fs.stat(p)).size; } } };
await walk(out);
console.log(`OK site: ${path.relative(root, out)}（${files}ファイル、${(bytes / 1024 / 1024).toFixed(1)}MB）`);
