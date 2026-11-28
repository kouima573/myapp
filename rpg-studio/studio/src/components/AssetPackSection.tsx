import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import { assetRights, PACK_LICENSE_LABEL, PACK_TERMS_TEMPLATE, planAssetPack, writeZip, type GameContent, type PackLicense } from "@rpg/schema";
import { download } from "../lib/browserExport";
import { mapPngBlob } from "../lib/renderInBrowser";
import { songToWav } from "../../../packages/runtime/src/songRender";
import type { ProjectStore } from "../lib/useProject";

const KIND_LABEL: Record<string, string> = { tileset: "タイル", character: "キャラクター", enemy: "敵", animation: "アニメーション", portrait: "顔・立ち絵", background: "背景", bgm: "BGM", sfx: "効果音", song: "楽譜BGM", font: "フォント" };

/** 素材パック: キャラクターだけ・音楽だけ・タイルだけ…を、ライセンス・説明・出どころ付きのZIPにする（CLI: pnpm rpg asset pack）。 */
export default function AssetPackSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const rights = useMemo(() => assetRights(content.project, content.assets.assets), [content]);
  const packable = rights.filter(r => r.pack === "ok");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maps, setMaps] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(""); const [author, setAuthor] = useState(""); const [description, setDescription] = useState("");
  const [license, setLicense] = useState<PackLicense>("cc-by-4.0");
  const [terms, setTerms] = useState(PACK_TERMS_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const kinds = [...new Set(packable.map(r => r.kind))];
  /** Why a map cannot go in (one of its tile sheets may not be packed), or null. */
  const mapBlocked = (mapId: string): string | null => {
    const plan = planAssetPack(content.project, content.assets.assets, [], { id: "x", title: "x", author: "x", license: "cc0", mapIds: [mapId], content }, content.tileset);
    return plan.problems.find(p => p.startsWith("マップ ")) ?? null;
  };
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectKind = (kind: string) => setSelected(s => new Set([...s, ...packable.filter(r => r.kind === kind).map(r => r.id)]));

  const exportPack = async () => {
    const id = (title.trim() ? `${content.project.id}-pack` : "asset-pack").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const plan = planAssetPack(content.project, content.assets.assets, [...selected], { id, title, author, description, license, terms: license === "terms" ? terms : undefined, mapIds: [...maps], content }, content.tileset);
    if (plan.problems.length) { window.alert(plan.problems.join("\n")); return; }
    setBusy(true);
    try {
      const entries = [];
      for (const f of plan.files) {
        const s = f.source;
        if ("text" in s) { entries.push({ name: f.name, data: new TextEncoder().encode(s.text) }); continue; }
        if ("songWav" in s) { entries.push({ name: f.name, data: songToWav(JSON.parse(store.texts[s.songWav] ?? "null")) }); continue; }
        if ("mapImage" in s) { entries.push({ name: f.name, data: new Uint8Array(await (await mapPngBlob(content, s.mapImage, a => store.source.assetUrl(a))).arrayBuffer()) }); continue; }
        const asset = content.assets.assets.find(a => a.path === (f.source as { assetPath: string }).assetPath)!;
        const response = await fetch(await store.source.assetUrl(asset));
        if (!response.ok) throw new Error(`${asset.path} を読めません`);
        entries.push({ name: f.name, data: new Uint8Array(await response.arrayBuffer()) });
      }
      download(`${id}.zip`, writeZip(entries));
      store.log("ok", `素材パック ${id}.zip を書き出しました（${plan.included.length}点）`);
    } catch (error) { store.log("error", `素材パックを書き出せません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  return <section className="card wide asset-pack">
    <header><h3><Package size={15} /> 素材パックとして書き出す</h3></header>
    <p className="muted small">ゲームではなく「キャラクターだけ」「音楽だけ」「タイルだけ」の素材集として配ったり売ったりできます。入れられるのは、自作と内蔵ジェネレーター製の素材だけです（他の人の素材は、素材のままでは配れないのが普通のため）。README・ライセンス・出どころ・一覧（pack.json）が自動で付きます。CLI: <code>pnpm rpg asset pack</code></p>
    {!packable.length ? <p className="muted">素材のまま配れるもの（自作・内蔵ジェネレーター製）がまだありません。「キャラクター作り」画面や素材ライブラリの内蔵素材から作れます。</p> : <>
      <div className="chips">{kinds.map(k => <button key={k} className="chip" onClick={() => selectKind(k)}>{KIND_LABEL[k] ?? k}を全部選ぶ</button>)}<button className="chip" onClick={() => setSelected(new Set())}>選択を外す</button></div>
      <div className="asset-pack-list">{packable.map(r => <label key={r.id}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> {r.id} <span className="muted small">{KIND_LABEL[r.kind] ?? r.kind}</span></label>)}</div>
      <div className="asset-pack-maps"><b className="small">マップ（Tiled 形式と1枚絵。使っているタイルも一緒に入ります）</b>
        <div className="asset-pack-list">{content.project.maps.map(m => {
          const blocked = mapBlocked(m.id);
          return <label key={m.id} title={blocked ?? ""}><input type="checkbox" disabled={Boolean(blocked)} checked={maps.has(m.id)} onChange={() => setMaps(s => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} /> {m.title} <span className="muted small">{blocked ? "入れられない" : m.id}</span></label>;
        })}</div>
      </div>
      {rights.some(r => r.pack !== "ok") && <details className="small"><summary>入れられない素材（{rights.filter(r => r.pack !== "ok").length}）</summary><ul>{rights.filter(r => r.pack !== "ok").map(r => <li key={r.id}>{r.id}: {r.packReason}</li>)}</ul></details>}
      <div className="form-grid">
        <label>パックの名前<input value={title} onChange={e => setTitle(e.target.value)} placeholder="例: 森の村キャラクター素材集" /></label>
        <label>作者名（ハンドルネーム可）<input value={author} onChange={e => setAuthor(e.target.value)} /></label>
        <label>説明（任意）<textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label>ライセンス<select value={license} onChange={e => setLicense(e.target.value as PackLicense)}>{(Object.keys(PACK_LICENSE_LABEL) as PackLicense[]).map(k => <option key={k} value={k}>{PACK_LICENSE_LABEL[k]}</option>)}</select></label>
      </div>
      {license === "terms" && <label className="field">利用規約（自由に書き換えられます）<textarea rows={8} value={terms} onChange={e => setTerms(e.target.value)} /></label>}
      <div className="row"><button className="button primary" disabled={busy || (!selected.size && !maps.size)} onClick={() => void exportPack()}>素材パックをZIPで書き出す（{selected.size}点{maps.size ? `・マップ${maps.size}枚` : ""}）</button></div>
    </>}
  </section>;
}
