import { useState } from "react";
import { Wand2 } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import CharacterMakerPanel from "./CharacterMakerPanel";
import MonsterMakerSection from "./MonsterMakerSection";
import TileMakerSection from "./TileMakerSection";
import BackgroundMakerSection from "./BackgroundMakerSection";
import type { ProjectStore } from "../lib/useProject";

type Tab = "character" | "monster" | "tiles" | "background";
const TABS: Array<{ id: Tab; label: string }> = [{ id: "character", label: "キャラクター・顔グラフィック" }, { id: "monster", label: "敵・モンスター" }, { id: "tiles", label: "タイル" }, { id: "background", label: "戦闘背景" }];

/** 素材作り: 内蔵ジェネレーターの部品を選んで、キャラクター・敵・タイルを作る。作ったものは自作扱い（MIT）で、ゲームにも素材パックにも使える。 */
export default function AssetMakerPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [tab, setTab] = useState<Tab>("character");
  return <div className="panel-page asset-maker">
    <h2><Wand2 size={18} /> 素材作り</h2>
    <p className="muted">部品や色を選ぶだけで、キャラクター・顔グラフィック・敵・タイル・戦闘背景を作れます。内蔵ジェネレーター製なので、ゲームに使うのも、「素材」画面の素材パックとして配ったり売ったりするのも自由です。</p>
    <div className="chips" role="tablist">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip ${tab === t.id ? "is-on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
    {tab === "character" && <CharacterMakerPanel store={store} content={content} />}
    {tab === "monster" && <MonsterMakerSection store={store} content={content} />}
    {tab === "tiles" && <TileMakerSection store={store} content={content} />}
    {tab === "background" && <BackgroundMakerSection store={store} content={content} />}
  </div>;
}
