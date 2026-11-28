import { useState } from "react";
import { ImageDown } from "lucide-react";
import { writeZip } from "@rpg/schema";
import { cover, descriptionDraft, loadAllImages, screenshot } from "../lib/storePage";
import { download } from "../lib/browserExport";
import type { ProjectStore } from "../lib/useProject";

const blobOf = (c: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => c.toBlob(b => (b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a))) : reject(new Error("PNGにできません"))), "image/png"));

/** 作品ページの材料: スクリーンショット（各マップ）・カバー画像（630×500）・紹介文の下書きをZIPに。 */
export default function StorePageSection({ store }: { store: ProjectStore }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const content = store.content;
  if (!content) return null;
  const make = async () => {
    setBusy(true);
    try {
      const images = await loadAllImages(content, a => store.source.assetUrl(a));
      const start = content.project.start.mapId;
      const ids = [start, ...content.project.maps.map(m => m.id).filter(id => id !== start)].slice(0, 4);
      const shots = ids.map(id => ({ id, canvas: screenshot(content, images, id) }));
      const coverCanvas = cover(content, shots[0]!.canvas);
      setPreview(coverCanvas.toDataURL("image/png"));
      const enc = new TextEncoder();
      const entries = [
        { name: "store-page/cover.png", data: await blobOf(coverCanvas) },
        ...await Promise.all(shots.map(async (s, i) => ({ name: `store-page/screenshots/${String(i + 1).padStart(2, "0")}-${s.id}.png`, data: await blobOf(s.canvas) }))),
        { name: "store-page/description.md", data: enc.encode(descriptionDraft(content, store.texts)) },
      ];
      download(`${content.project.id}-store-page.zip`, writeZip(entries));
      store.log("ok", `作品ページの材料を書き出しました（カバー1枚・スクリーンショット${shots.length}枚・紹介文の下書き）`);
    } catch (error) { store.log("error", `作品ページの材料を作れません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <section className="card store-page">
    <header><h3><ImageDown size={15} /> 作品ページの材料</h3></header>
    <p className="muted small">itch.io・BOOTH・ふりーむ！などの作品ページに載せる、カバー画像（630×500）・スクリーンショット（最初のマップから最大4枚、960×640）・紹介文の下書き（日本語と短い英語）をまとめて作ります。紹介文は必ず自分の言葉に直してください。</p>
    <div className="row"><button className="button primary" disabled={busy} onClick={() => void make()}>{busy ? "作っています…" : "作る（ZIP）"}</button></div>
    {preview && <img src={preview} alt="カバー画像の見本" className="store-cover-preview" />}
  </section>;
}
