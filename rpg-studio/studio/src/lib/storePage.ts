/**
 * 作品ページの材料（itch.io・BOOTH・ふりーむ！など）: ゲームの画面そのもののスクリーンショット、カバー画像（630×500）、
 * 紹介文の下書き。工房の描画（render.ts の drawMap）で描くので、遊ぶときと同じ見た目になる。
 */
import type { AssetEntry, GameContent } from "@rpg/schema";
import { drawMap, loadImages, npcActors, TILE, type ImageMap } from "../../../packages/runtime/src/render";
import { creditLines } from "../../../packages/runtime/src/credits";

/** Loads every image of the game and waits until each one has loaded or failed (at most `timeoutMs`). */
export async function loadAllImages(content: GameContent, resolve: (asset: AssetEntry) => Promise<string>, timeoutMs = 15000): Promise<ImageMap> {
  const images = loadImages(content, resolve);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (Object.values(images).every(img => !img || (img.complete && (img.naturalWidth > 0 || img.src)))) break;
    await new Promise(r => setTimeout(r, 60));
  }
  await Promise.all(Object.values(images).map(img => (img?.decode ? img.decode().catch(() => undefined) : undefined)));
  return images;
}

/** A screenshot of a map (up to 960×640) (tiles, objects and characters; the hero at the start point on the first map). */
export function screenshot(content: GameContent, images: ImageMap, mapId: string): HTMLCanvasElement {
  const map = content.maps[mapId]!;
  // Small maps: the picture is the whole map (no empty border around it); large maps: a 30×20 view.
  const cols = Math.min(30, map.width), rows = Math.min(20, map.height);
  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE; canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  const start = content.project.start;
  const focus = start.mapId === mapId ? { x: start.x, y: start.y } : map.npcs[0] ? { x: map.npcs[0].x, y: map.npcs[0].y } : { x: map.width / 2, y: map.height / 2 };
  const camera = { x: Math.max(0, Math.min(map.width - cols, Math.round(focus.x - cols / 2))), y: Math.max(0, Math.min(map.height - rows, Math.round(focus.y - rows / 2))) };
  const actors = [
    ...npcActors(content, map, map.npcs.filter(n => !n.disabled)),
    ...(start.mapId === mapId ? [{ id: "player", x: start.x, y: start.y, facing: start.facing, sprite: content.project.player.sprite, kind: "player" as const }] : []),
  ];
  drawMap(ctx, { content, map, images, view: { camera, cols, rows }, actors, interactables: map.interactables.filter(i => !i.disabled), time: 0 });
  // Small maps are enlarged with crisp pixels to about 960px wide.
  const scale = Math.max(1, Math.round(960 / canvas.width));
  if (scale === 1) return canvas;
  const big = document.createElement("canvas");
  big.width = canvas.width * scale; big.height = canvas.height * scale;
  const bctx = big.getContext("2d")!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(canvas, 0, 0, big.width, big.height);
  return big;
}

/** 630×500 cover: a screenshot with the title on a dark band. */
export function cover(content: GameContent, shot: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 630; c.height = 500;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(630 / shot.width, 500 / shot.height);
  ctx.drawImage(shot, (630 - shot.width * scale) / 2, (500 - shot.height * scale) / 2, shot.width * scale, shot.height * scale);
  const g = ctx.createLinearGradient(0, 300, 0, 500);
  g.addColorStop(0, "rgba(10,12,10,0)"); g.addColorStop(0.45, "rgba(10,12,10,.78)"); g.addColorStop(1, "rgba(10,12,10,.92)");
  ctx.fillStyle = g; ctx.fillRect(0, 300, 630, 200);
  const title = content.project.title;
  let size = 46;
  ctx.font = `bold ${size}px "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif`;
  while (ctx.measureText(title).width > 590 && size > 20) { size -= 2; ctx.font = `bold ${size}px "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif`; }
  ctx.fillStyle = "#f6e7c1"; ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 6;
  ctx.fillText(title, 20, 440);
  const subtitle = content.project.titleScreen?.subtitle;
  if (subtitle) { ctx.font = `18px "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif`; ctx.fillStyle = "#d8d2bf"; ctx.fillText(subtitle, 22, 475); }
  return c;
}

/** Plain-language page text to start from (the creator rewrites it in their own words). */
export function descriptionDraft(content: GameContent, texts: Record<string, string>): string {
  const p = content.project;
  const maps = Object.keys(content.maps).length, dialogues = Object.keys(content.dialogues).length, events = Object.keys(content.events).length;
  const est = Math.max(2, maps * 3 + Math.ceil((dialogues + events) * 0.5));
  const endings = Object.keys(p.endings ?? {}).length;
  const companions = content.database.companions?.length ?? 0;
  const idea = (texts["IDEA.md"] ?? "").split("\n").map(l => l.trim()).find(l => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("-"));
  const features = [
    `マップ ${maps} 枚`,
    content.database.enemies.length ? `敵 ${content.database.enemies.length} 種類` : "",
    companions ? `仲間 ${companions} 人` : "",
    endings ? `エンディング ${endings} 種類` : "",
    Object.keys(p.modules ?? {}).length ? `ミニゲーム・特別な遊び ${Object.keys(p.modules).length} 種類` : "",
  ].filter(Boolean);
  return `# ${p.title}

## ひとこと（作品ページの短い説明）
${p.titleScreen?.subtitle || idea || "（ここに、作品をひとことで）"}

## 紹介文（下書き。自分の言葉に書き直してください）
${idea ? `${idea}\n\n` : ""}（どんな世界で、主人公が何をするのか。遊んだ人がどんな気持ちになってほしいか）

## 特徴
${features.map(f => `- ${f}`).join("\n")}
- 遊ぶ時間の目安: 約 ${est}〜${est + 5} 分（工房の見積もり。実際に遊んで直してください）
- ブラウザで遊べます（インストール不要・スマートフォン対応）

## 操作
- 移動: 矢印キー / WASD（スマートフォンは画面のボタン）
- 調べる・決定: Enter / Z
- メニュー・戻る: Esc / X

## クレジット
${creditLines(content).map(l => `- ${l}`).join("\n")}

---

## English (draft)
**${p.title}** — a short browser RPG. Play time: about ${est}–${est + 5} minutes.
Controls: Arrow keys / WASD to move, Enter / Z to confirm, Esc / X for the menu. Made with RPG System Studio.
`;
}
