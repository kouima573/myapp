/**
 * 音楽の「流す場所」: マップのBGM・戦闘の曲・勝利の曲。どこで使われているかの一覧と、場所への設定（音楽画面で使う）。
 */
import type { GameContent } from "@rpg/schema";
import type { ProjectStore } from "./useProject";

export interface MusicPlace { key: string; label: string; current?: string }

export function musicPlaces(content: GameContent): MusicPlace[] {
  return [
    ...content.project.maps.map(ref => ({ key: `map:${ref.id}`, label: `マップ「${content.maps[ref.id]?.title ?? ref.title ?? ref.id}」`, current: content.maps[ref.id]?.bgm })),
    { key: "battle", label: "戦闘", current: content.project.audio.battle },
    { key: "victory", label: "勝利したとき", current: content.project.audio.victory },
  ];
}

/** Where an asset is used as music (maps, battle, victory, enemies' own battle music). */
export function musicUsage(content: GameContent, assetId: string): string[] {
  return [
    ...musicPlaces(content).filter(p => p.current === assetId).map(p => p.label),
    ...content.database.enemies.filter(e => e.bgm === assetId).map(e => `敵「${e.name}」の戦闘`),
  ];
}

/** Sets `assetId` as the music of a place (null clears it). */
export function setMusicAt(store: ProjectStore, content: GameContent, key: string, assetId: string | null) {
  if (key.startsWith("map:")) {
    const ref = content.project.maps.find(m => m.id === key.slice(4));
    if (!ref) return;
    store.updateJson<Record<string, unknown>>(ref.path, map => { if (assetId) map.bgm = assetId; else delete map.bgm; });
    return;
  }
  store.updateJson<Record<string, unknown>>("project.json", project => {
    const audio = { ...((project.audio as Record<string, unknown> | undefined) ?? {}) };
    if (assetId) audio[key] = assetId; else delete audio[key];
    project.audio = audio;
  });
}
