import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Music, Play, Plus, Square as StopIcon } from "lucide-react";
import type { AssetEntry, GameContent } from "@rpg/schema";
import { parseNotes, SONG_WAVES, type Song } from "../../../packages/schema/src/song";
import { previewSong } from "../../../packages/runtime/src/audio";
import { songToWav } from "../../../packages/runtime/src/songRender";
import { download } from "../lib/browserExport";
import { GRID_PITCHES, gridToNotes, notesToGrid, placeNote } from "../lib/stepgrid";
import type { ProjectStore } from "../lib/useProject";

/**
 * 楽譜BGM (roadmap 126): listen to the project's text-score songs, edit tempo / waves / notes, and write a track
 * with a step grid (16th notes, two octaves). Saved as the song's .song.json; new songs are registered in assets.json.
 */
/** The pitch a "~" step is holding (walk back to the note that started it). */
function held(grid: Array<string | null>, i: number): string | null {
  if (grid[i] !== "~") return null;
  for (let k = i - 1; k >= 0; k--) if (grid[k] !== "~") return grid[k] ?? null;
  return null;
}

export default function SongPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const songs = content.assets.assets.filter(a => a.kind === "song");
  const [path, setPath] = useState<string | null>(songs[0]?.path ?? null);
  const [track, setTrack] = useState(0);
  const [bars, setBars] = useState(2);
  /** Length of new notes in 16th steps (16分=1, 8分=2, 4分=4, 2分=8). */
  const [noteLen, setNoteLen] = useState(4);
  const playing = useRef<{ stop(): void } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => () => playing.current?.stop(), []);
  const song = useMemo<Song | null>(() => { try { return path ? JSON.parse(store.texts[path] ?? "null") as Song : null; } catch { return null; } }, [path, store.texts]);
  const write = (next: Song) => { if (path) store.setFileText(path, `${JSON.stringify(next, null, 2)}\n`); };
  const stop = () => { playing.current?.stop(); playing.current = null; setIsPlaying(false); };
  const play = () => {
    stop();
    if (!song) return;
    try { song.tracks.forEach(t => parseNotes(t.notes, t.transpose)); } catch (error) { store.log("error", `楽譜が読めません: ${error instanceof Error ? error.message : String(error)}`); return; }
    playing.current = previewSong(song); setIsPlaying(true);
  };
  const t = song?.tracks[track];
  const grid = t ? notesToGrid(t.notes, bars * 16) : null;
  const setStep = (i: number, pitch: string) => {
    if (!song || !t || !grid) return;
    const next = placeNote(grid, i, pitch, noteLen);
    write({ ...song, tracks: song.tracks.map((x, k) => (k === track ? { ...x, notes: gridToNotes(next) } : x)) });
  };
  const create = () => {
    const id = window.prompt("新しい曲のID（英数字）", `song-${songs.length + 1}`);
    if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id) || content.assets.assets.some(a => a.id === id)) return;
    // Next to the existing songs (new files can only be made in an existing folder).
    const folder = songs[0]?.path.replace(/[^/]+$/, "") ?? "assets/audio/";
    const p = `${folder}${id}.song.json`;
    const fresh: Song = { formatVersion: 1, title: id, tempo: 120, loop: true, tracks: [{ name: "メロディ", wave: "square", volume: 0.2, notes: "C4/4 E4/4 G4/4 C5/4", transpose: 0 }, { name: "ベース", wave: "triangle", volume: 0.25, notes: "C3/2 G2/2", transpose: 0 }] };
    store.setFileText(p, `${JSON.stringify(fresh, null, 2)}\n`);
    store.updateJson<{ assets: AssetEntry[] }>(content.project.assetsPath, f => { f.assets.push({ id, path: p, kind: "song", mimeType: "application/json", bytes: 300, source: "工房の楽譜BGMで作曲", license: "プロジェクト内素材", origin: "original", creditRequired: false, redistributable: true } as AssetEntry); });
    setPath(p); setTrack(0);
    store.log("ok", `楽譜BGM ${id} を作りました（${p}）。マップの bgm などに ${id} を指定すると流れます`);
  };
  return <div className="panel-page song-panel">
    <h2><Music size={18} /> 楽譜BGM</h2>
    <p className="muted">文字の楽譜（<code>.song.json</code>）の曲を試聴・編集します。マス目をクリックすると16分音符で打ち込めます（1列に1音）。書式は docs/asset-guide.md。</p>
    <div className="row">
      <select value={path ?? ""} onChange={e => { stop(); setPath(e.target.value || null); setTrack(0); }} aria-label="曲">
        {songs.map(s => <option key={s.id} value={s.path}>{s.id}</option>)}
      </select>
      <button className="button" onClick={create}><Plus size={13} /> 新しい曲</button>
      {!isPlaying ? <button className="button primary" disabled={!song} onClick={play}><Play size={13} /> 試聴</button> : <button className="button" onClick={stop}><StopIcon size={13} /> 止める</button>}
      <button className="button" disabled={!song} title="ほかのツールや動画でも使える音声ファイル（WAV）にします。ループする曲は、繰り返すと継ぎ目なくつながります" onClick={() => { if (song) download(`${(path ?? "song").split("/").pop()!.replace(/\.song\.json$/, "")}.wav`, songToWav(song), "audio/wav"); }}><Download size={13} /> WAVで書き出す</button>
    </div>
    {song && <>
      <div className="row">
        <label className="small">テンポ <input type="number" min={30} max={300} value={song.tempo} onChange={e => write({ ...song, tempo: Math.max(30, Math.min(300, Number(e.target.value) || 120)) })} style={{ width: "5em" }} /></label>
        <label className="small"><input type="checkbox" checked={song.loop} onChange={e => write({ ...song, loop: e.target.checked })} /> くり返す</label>
      </div>
      <div className="row">{song.tracks.map((x, i) => <button key={i} className={`chip ${i === track ? "is-on" : ""}`} onClick={() => setTrack(i)}>{x.name ?? `トラック${i + 1}`}</button>)}
        {song.tracks.length < 8 && <button className="chip" onClick={() => { write({ ...song, tracks: [...song.tracks, { name: `トラック${song.tracks.length + 1}`, wave: "square", volume: 0.2, notes: "R/1", transpose: 0 }] }); setTrack(song.tracks.length); }}>＋</button>}
      </div>
      {t && <>
        <div className="row">
          <select value={t.wave} onChange={e => write({ ...song, tracks: song.tracks.map((x, k) => (k === track ? { ...x, wave: e.target.value as typeof x.wave } : x)) })} aria-label="音色">{SONG_WAVES.map(w => <option key={w}>{w}</option>)}</select>
          <label className="small">音量 <input type="range" min={0} max={1} step={0.05} value={t.volume} onChange={e => write({ ...song, tracks: song.tracks.map((x, k) => (k === track ? { ...x, volume: Number(e.target.value) } : x)) })} /></label>
          <label className="small">置く音の長さ <select value={noteLen} onChange={e => setNoteLen(Number(e.target.value))}>{[[1, "16分"], [2, "8分"], [3, "付点8分"], [4, "4分"], [6, "付点4分"], [8, "2分"]].map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
          <label className="small">小節 <select value={bars} onChange={e => setBars(Number(e.target.value))}>{[1, 2, 4, 8].map(n => <option key={n}>{n}</option>)}</select></label>
        </div>
        <textarea className="mono" rows={3} value={t.notes} onChange={e => write({ ...song, tracks: song.tracks.map((x, k) => (k === track ? { ...x, notes: e.target.value } : x)) })} aria-label="楽譜" />
        {grid ? <div className="step-grid" style={{ gridTemplateColumns: `3.2em repeat(${bars * 16}, 1fr)` }}>
          {GRID_PITCHES.map(p => <div key={p} style={{ display: "contents" }}>
            <span className={`step-pitch ${p.includes("#") ? "is-sharp" : ""}`}>{p}</span>
            {Array.from({ length: bars * 16 }, (_, i) => <button key={i} className={`step-cell ${grid[i] === p ? "is-on" : held(grid, i) === p ? "is-held" : ""} ${i % 4 === 0 ? "is-beat" : ""} ${i % 16 === 0 ? "is-bar" : ""} ${p.includes("#") ? "is-sharp" : ""}`} onClick={() => setStep(i, p)} title={`${p}・${i + 1}`} />)}
          </div>)}
        </div> : <p className="muted small">この楽譜は和音・長い音符などを含むため、マス目では表示できません（文字で編集してください）。</p>}
      </>}
    </>}
  </div>;
}
