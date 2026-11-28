import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Download, Plus } from "lucide-react";
import type { AssetEntry, GameContent } from "@rpg/schema";
import {
  BODY_TYPES, CHARACTERS, drawCharacterFrame, EARS, FACINGS, HAIR_STYLES, HEADGEARS, ITEMS, OUTFITS, PART_LABELS, randomCharacter, renderCharacterSheet, SPECIALS,
  type CharacterSpec,
} from "../../../packages/cli/src/artgen/characters";
import { download } from "../lib/browserExport";
import { rgbaToPngBlob } from "../lib/renderInBrowser";
import type { ProjectStore } from "../lib/useProject";

const label = (v: string) => PART_LABELS[v] ?? v;
const clone = (s: CharacterSpec): CharacterSpec => JSON.parse(JSON.stringify(s)) as CharacterSpec;

/**
 * キャラクター作り: 体型・肌・髪・服・帽子・耳・しっぽ・持ち物を選んで、歩くキャラクター（4方向×4コマ）を作る。
 * 内蔵ジェネレーター製（MIT）として登録されるので、ゲームに使うのも素材パックとして配る・売るのも自由。CLI: pnpm rpg art character
 */
export default function CharacterMakerPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [spec, setSpec] = useState<CharacterSpec>(() => clone(CHARACTERS[0]!));
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const seed = useRef(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const made = useMemo(() => content.assets.assets.filter(a => a.kind === "character" && typeof a.generator?.spec === "string"), [content]);

  // Walking preview: the 4 directions side by side, 4x.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const c = canvas.current; if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      FACINGS.forEach((facing, i) => {
        const img = drawCharacterFrame(spec, facing, frame);
        const tmp = document.createElement("canvas"); tmp.width = img.w; tmp.height = img.h;
        tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
        ctx.drawImage(tmp, i * 128, 0, 128, 128);
      });
      frame = (frame + 1) % 4;
    };
    draw();
    const timer = window.setInterval(draw, 180);
    return () => window.clearInterval(timer);
  }, [spec]);

  const set = (recipe: (s: CharacterSpec) => void) => setSpec(current => { const next = clone(current); recipe(next); return next; });
  const assetId = `chr-${id}`;
  const exists = content.assets.assets.some(a => a.id === assetId);

  const pngBlob = () => { const sheet = renderCharacterSheet(spec); return rgbaToPngBlob({ width: sheet.w, height: sheet.h, data: sheet.data }); };
  const addToProject = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !name.trim()) { window.alert("ID（英小文字・数字・ハイフン）と名前を入れてください"); return; }
    if (exists && !window.confirm(`${assetId} はもうあります。作り直した絵で置き換えますか？`)) return;
    if (!store.source.saveImage) { window.alert("この環境では画像を保存できません"); return; }
    setBusy(true);
    try {
      const path = `assets/characters/${assetId}.png`;
      const blob = await pngBlob();
      const expected = exists && store.source.assetHash ? await store.source.assetHash(path) : "";
      const saved = await store.source.saveImage(path, blob, expected);
      if (!saved.ok) throw new Error(saved.error);
      const full = { ...spec, id, name: name.trim(), tags: [...new Set([...(spec.tags ?? []), "custom"])] };
      const entry: AssetEntry = {
        id: assetId, path, kind: "character", mimeType: "image/png", bytes: saved.bytes, source: "RPGシステム工房の内蔵ジェネレーター",
        license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）", origin: "generated", sourceId: "builtin-art", creditRequired: false, redistributable: true,
        notes: `キャラクター作りで作成（${name.trim()}）。`, generator: { tool: "キャラクター作り", spec: JSON.stringify(full) },
        tileWidth: 64, tileHeight: 64, columns: 4, rows: 4, frameDurationMs: 160, frameOrder: [0, 1, 2, 3], loop: true,
      };
      store.updateJson<{ assets: AssetEntry[] }>(content.project.assetsPath, data => { data.assets = [...data.assets.filter(a => a.id !== assetId), entry]; });
      store.log("ok", `${assetId}（${name.trim()}）を登録しました。人物の見た目（sprite）に選べます。素材パックにも入れられます`);
    } catch (error) { store.log("error", `キャラクターを保存できません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const select = <T extends string,>(value: T | undefined, options: readonly T[], onChange: (v: T | undefined) => void, none?: string) =>
    <select value={value ?? ""} onChange={e => onChange((e.target.value || undefined) as T | undefined)}>
      {none && <option value="">{none}</option>}
      {options.map(o => <option key={o} value={o}>{label(o)}</option>)}
    </select>;
  const color = (value: string | undefined, onChange: (v: string) => void, fallback = "#808080") => <input type="color" value={value ?? fallback} onChange={e => onChange(e.target.value)} />;

  return <section className="maker-section character-maker">
    <p className="muted small">部品を選んで、歩くキャラクター（4方向×4コマ）を作ります。CLI: <code>pnpm rpg art character</code></p>
    <div className="row">
      <label>見本から <select value="" onChange={e => { const t = CHARACTERS.find(c => c.id === e.target.value); if (t) setSpec(clone(t)); }}><option value="">選ぶ…</option>{CHARACTERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {made.length > 0 && <label>作ったものを開く <select value="" onChange={e => { const a = made.find(x => x.id === e.target.value); if (a) { const s = JSON.parse(String(a.generator!.spec)) as CharacterSpec; setSpec(s); setName(s.name); setId(a.id.replace(/^chr-/, "")); } }}><option value="">選ぶ…</option>{made.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}</select></label>}
      <button className="button" onClick={() => setSpec(randomCharacter(`${Date.now()}-${seed.current++}`))}><Dices size={13} /> おまかせ</button>
    </div>
    <canvas ref={canvas} className="character-preview" width={512} height={128} aria-label="歩くキャラクターの見本（下・左・右・上）" />
    <div className="character-parts">
      <label>体型{select(spec.body ?? "adult", BODY_TYPES, v => set(s => { s.body = v; }))}</label>
      <label>肌{color(spec.skin, v => set(s => { s.skin = v; }), "#f2d0b0")}</label>
      <label>髪型{select(spec.hair?.style, HAIR_STYLES, v => set(s => { s.hair = v ? { style: v, color: s.hair?.color ?? "#7a4a2a" } : undefined; }), "なし（帽子など）")}{spec.hair && color(spec.hair.color, v => set(s => { s.hair!.color = v; }))}</label>
      <label>服{select(spec.outfit.type, OUTFITS, v => set(s => { if (v) s.outfit.type = v; }))}{color(spec.outfit.main, v => set(s => { s.outfit.main = v; }))}{color(spec.outfit.accent, v => set(s => { s.outfit.accent = v; }), "#6a4a2a")}</label>
      <label>ズボン・くつ{color(spec.outfit.pants, v => set(s => { s.outfit.pants = v; }), "#4a4038")}{color(spec.outfit.shoes, v => set(s => { s.outfit.shoes = v; }), "#3a2a24")}</label>
      <label>かぶり物{select(spec.headgear?.type, HEADGEARS, v => set(s => { s.headgear = v ? { type: v, color: s.headgear?.color ?? "#6a4a2a", accent: s.headgear?.accent } : undefined; }), "なし")}{spec.headgear && color(spec.headgear.color, v => set(s => { s.headgear!.color = v; }))}</label>
      <label>持ち物{select(spec.item, ITEMS, v => set(s => { s.item = v; }), "なし")}</label>
      <label>耳{select(spec.ears, EARS, v => set(s => { s.ears = v; if (v && !s.earColor) s.earColor = s.hair?.color ?? "#7a4a2a"; }), "ふつう")}{spec.ears && color(spec.earColor, v => set(s => { s.earColor = v; }))}</label>
      <label><input type="checkbox" checked={Boolean(spec.tail)} onChange={e => set(s => { s.tail = e.target.checked ? s.hair?.color ?? "#7a4a2a" : undefined; })} />しっぽ{spec.tail && color(spec.tail, v => set(s => { s.tail = v; }))}</label>
      <label><input type="checkbox" checked={Boolean(spec.cape)} onChange={e => set(s => { s.cape = e.target.checked ? "#b84a3a" : undefined; })} />マント{spec.cape && color(spec.cape, v => set(s => { s.cape = v; }))}</label>
      <label><input type="checkbox" checked={Boolean(spec.beard)} onChange={e => set(s => { s.beard = e.target.checked ? s.hair?.color ?? "#9a98a0" : undefined; })} />ひげ{spec.beard && color(spec.beard, v => set(s => { s.beard = v; }))}</label>
      <label>特別{select(spec.special, SPECIALS, v => set(s => { s.special = v; }), "なし")}</label>
    </div>
    <div className="row">
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例: 狐の娘" /></label>
      <label>ID<input value={id} onChange={e => setId(e.target.value.toLowerCase())} placeholder="fox-girl" /></label>
      <button className="button primary" disabled={busy} onClick={() => void addToProject()}><Plus size={13} /> {exists ? "置き換える" : "このプロジェクトに追加"}</button>
      <button className="button" onClick={() => void pngBlob().then(async b => download(`${id || "character"}.png`, new Uint8Array(await b.arrayBuffer()), "image/png"))}><Download size={13} /> PNGで保存</button>
    </div>
    <p className="muted small">追加すると <code>assets/characters/chr-ID.png</code>（64×64のコマが4列×4行。行は 下・左・右・上）として登録されます。人物や主人公の見た目に選べ、「素材」画面の素材パックにも入れられます。</p>
  </section>;
}
