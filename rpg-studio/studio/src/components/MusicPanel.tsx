import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Music, Play, Plus, Shuffle, Square as StopIcon, Upload, Wand2 } from "lucide-react";
import { composeSong, SONG_MOOD_LABELS, SONG_MOODS, SOURCE_CATALOG, type AssetEntry, type GameContent, type SongMood } from "@rpg/schema";
import type { Song } from "../../../packages/schema/src/song";
import { previewSong } from "../../../packages/runtime/src/audio";
import { songToWav } from "../../../packages/runtime/src/songRender";
import { download } from "../lib/browserExport";
import { musicPlaces, musicUsage, setMusicAt } from "../lib/musicPlaces";
import type { ProjectStore } from "../lib/useProject";
import SongPanel from "./SongPanel";

type Way = "compose" | "ai" | "sites" | "import" | "score";
const WAYS: Array<{ id: Way; label: string; hint: string }> = [
  { id: "compose", label: "おまかせ作曲（かんたん）", hint: "場面を選ぶだけ。工房の中で作るので、売るのも素材として配るのも自由" },
  { id: "ai", label: "音楽AIで作る", hint: "言葉で注文して作る。商用に使えるかはサービスとプラン次第" },
  { id: "sites", label: "素材サイトから探す", hint: "無料で使える曲を探す。サイトごとの条件とクレジットに注意" },
  { id: "import", label: "音声ファイルを取り込む", hint: "自分で作った曲・ダウンロードした曲（MP3・OGG・WAV）を入れる" },
  { id: "score", label: "楽譜で作曲（くわしく）", hint: "音を1つずつ置いて作る・おまかせの曲を直す" },
];

const AI_IDS = ["soundraw", "suno", "aiva", "stable-audio"];
const STYLES = [
  { id: "chip", ja: "8ビット風（昔のゲーム機のような音）", en: "8-bit chiptune" },
  { id: "orch", ja: "オーケストラ", en: "orchestral" },
  { id: "piano", ja: "ピアノ", en: "solo piano" },
  { id: "rock", ja: "ロック", en: "rock band" },
  { id: "ambient", ja: "環境音楽（静か）", en: "ambient" },
];
const MOOD_WORDS: Record<SongMood, { ja: string; en: string }> = {
  town: { ja: "のどかな村や町のBGM。明るく素朴", en: "peaceful village theme, cheerful and simple" },
  field: { ja: "冒険に出るフィールドのBGM。前向きでわくわくする", en: "adventurous overworld theme, hopeful and exciting" },
  dungeon: { ja: "薄暗いダンジョンのBGM。あやしく緊張感がある", en: "dark dungeon theme, eerie and tense" },
  battle: { ja: "通常戦闘のBGM。速くて勢いがある", en: "fast battle theme, energetic" },
  boss: { ja: "ボス戦のBGM。重く激しい", en: "intense boss battle theme, heavy and dramatic" },
  sad: { ja: "悲しい場面のBGM。ゆっくりで切ない", en: "sad scene, slow and melancholic" },
  peaceful: { ja: "宿屋や家の中のBGM。やすらぐ", en: "cozy inn theme, calm and relaxing" },
  shop: { ja: "お店のBGM。にぎやかで楽しい", en: "lively shop theme, playful" },
  castle: { ja: "お城のBGM。おごそかで堂々としている", en: "royal castle theme, majestic" },
  mystery: { ja: "なぞめいた場所のBGM。不思議でふわっとしている", en: "mysterious place, dreamy and strange" },
  victory: { ja: "戦闘に勝ったときの短いファンファーレ（数秒）", en: "short victory fanfare, a few seconds" },
  ending: { ja: "エンディングのBGM。あたたかく感動的", en: "ending theme, warm and emotional" },
};

/** Is this asset one of the bundled sample's (borrowed, not made for this game)? */
function useSampleCheck(store: ProjectStore) {
  const source = store.source as { isSampleAsset?: (a: AssetEntry) => boolean };
  return (a: AssetEntry) => Boolean(source.isSampleAsset?.(a));
}

/**
 * 音楽（BGM・効果音）: このゲームの曲の一覧（試聴・使っている場所・流す場所）と、曲を手に入れる5つのやり方。
 * 初めての人は「おまかせ作曲」から。楽譜を自分で書く画面は「楽譜で作曲（くわしく）」。
 */
export default function MusicPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const music = content.assets.assets.filter(a => a.kind === "song" || a.kind === "bgm");
  const [way, setWay] = useState<Way>("compose");
  const isSample = useSampleCheck(store);
  const playing = useRef<{ stop(): void } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  useEffect(() => () => playing.current?.stop(), []);
  const stop = () => { playing.current?.stop(); playing.current = null; setPlayingId(null); };
  const listen = async (a: AssetEntry) => {
    if (playingId === a.id) { stop(); return; }
    stop();
    try {
      if (a.kind === "song") { playing.current = previewSong(JSON.parse(store.texts[a.path] ?? "null") as Song); }
      else { const audio = new Audio(await store.source.assetUrl(a)); audio.loop = true; void audio.play(); playing.current = { stop: () => audio.pause() }; }
      setPlayingId(a.id);
    } catch (error) { store.log("error", `再生できません: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const places = musicPlaces(content);

  return <div className="panel-page music-panel">
    <h2><Music size={18} /> 音楽（BGM・効果音）</h2>
    <p className="muted">ゲームの曲は、作る・AIで作る・素材サイトで探す・自分のファイルを入れる、のどれでも大丈夫です。迷ったら「おまかせ作曲」で場面を選んでください。</p>

    <section className="card wide">
      <header><h3>このゲームの曲</h3><span className="muted small">{music.length}曲</span></header>
      {music.length === 0 ? <p className="muted small">まだ曲がありません。下のやり方から1つ選んで入れてください。</p>
        : <ul className="music-list">{music.map(a => {
          const used = musicUsage(content, a.id);
          return <li key={a.id}>
            <button className="button" onClick={() => void listen(a)}>{playingId === a.id ? <><StopIcon size={12} /> 止める</> : <><Play size={12} /> 試聴</>}</button>
            <b>{a.id}</b>
            <span className="badge">{a.kind === "song" ? "楽譜" : "音声ファイル"}</span>
            {isSample(a) && <span className="badge warn" title="見本のゲームから借りている曲です。自分のゲームには、自分で用意した曲に入れ替えるのがおすすめです">見本</span>}
            <span className="muted small">{used.length ? `流れる所: ${used.join("・")}` : "まだどこでも流れていません"}</span>
            <select value="" aria-label={`${a.id} を流す場所`} onChange={e => { if (e.target.value) { setMusicAt(store, content, e.target.value, a.id); store.log("ok", `${a.id} を「${places.find(p => p.key === e.target.value)?.label}」の曲にしました`); } }}>
              <option value="">流す場所を決める…</option>
              {places.map(p => <option key={p.key} value={p.key}>{p.label}{p.current ? `（今: ${p.current}）` : ""}</option>)}
            </select>
          </li>;
        })}</ul>}
    </section>

    <section className="card wide">
      <header><h3>曲を手に入れる</h3></header>
      <div className="music-ways" role="tablist">{WAYS.map(w => <button key={w.id} role="tab" aria-selected={way === w.id} className={`way-card ${way === w.id ? "is-on" : ""}`} onClick={() => setWay(w.id)}><b>{w.label}</b><span className="muted small">{w.hint}</span></button>)}</div>
    </section>

    {way === "compose" && <ComposeSection store={store} content={content} />}
    {way === "ai" && <AiSection onImport={() => setWay("import")} />}
    {way === "sites" && <SitesSection onImport={() => setWay("import")} />}
    {way === "import" && <ImportSection store={store} content={content} />}
    {way === "score" && <SongPanel store={store} content={content} />}
  </div>;
}

/** Folder for new song files: next to the existing songs (local projects can only create files in existing folders). */
function songFolder(store: ProjectStore, content: GameContent): string {
  const existing = content.assets.assets.find(a => a.kind === "song");
  if (existing) return existing.path.replace(/[^/]+$/, "");
  return store.source.kind === "preview" ? "assets/audio/songs/" : "assets/";
}

function ComposeSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [mood, setMood] = useState<SongMood>("town");
  const [seed, setSeed] = useState(1);
  const [long, setLong] = useState(false);
  const [tempo, setTempo] = useState<number | null>(null);
  const baseTempo = useMemo(() => composeSong({ mood, seed }).tempo, [mood, seed]);
  const song = useMemo(() => composeSong({ mood, seed, bars: long ? 16 : 8, ...(tempo ? { tempo } : {}) }), [mood, seed, long, tempo]);
  const [id, setId] = useState("");
  const [place, setPlace] = useState("");
  const playing = useRef<{ stop(): void } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => () => playing.current?.stop(), []);
  const stop = () => { playing.current?.stop(); playing.current = null; setIsPlaying(false); };
  const play = (s: Song) => { stop(); playing.current = previewSong(s); setIsPlaying(true); };
  // Changing the scene or number plays the new tune right away (if something is playing).
  useEffect(() => { if (playing.current) play(song); }, [song]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultId = `song-${mood}-${seed}`;
  const finalId = id.trim() || defaultId;
  const places = musicPlaces(content);

  const add = () => {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(finalId)) { window.alert("ID は英数字・ハイフンで入れてください"); return; }
    if (content.assets.assets.some(a => a.id === finalId)) { window.alert(`${finalId} はもうあります。別のIDにしてください`); return; }
    const path = `${songFolder(store, content)}${finalId}.song.json`;
    const text = `${JSON.stringify(song, null, 2)}\n`;
    store.beginGroup();
    store.setFileText(path, text);
    store.updateJson<{ assets: AssetEntry[] }>(content.project.assetsPath, f => {
      f.assets.push({
        id: finalId, path, kind: "song", mimeType: "application/json", bytes: text.length, source: "RPGシステム工房のおまかせ作曲",
        license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）", origin: "generated", sourceId: "builtin-song", creditRequired: false, redistributable: true,
        generator: { tool: "おまかせ作曲", mood, seed, bars: long ? 16 : 8, tempo: song.tempo }, notes: `おまかせ作曲（${SONG_MOOD_LABELS[mood]}・${seed}番）`,
      } as AssetEntry);
    });
    if (place) setMusicAt(store, content, place, finalId);
    store.endGroup();
    store.log("ok", `曲 ${finalId} をゲームに入れました${place ? `（${places.find(p => p.key === place)?.label}で流れます）` : "。「このゲームの曲」で流す場所を決められます"}。細かく直すときは「楽譜で作曲（くわしく）」で開けます`);
    setId("");
  };

  return <section className="card wide compose-section">
    <header><h3><Wand2 size={15} /> おまかせ作曲</h3></header>
    <p className="muted small">場面を選ぶと、工房が曲を組み立てます（AIは使いません）。気に入らなければ「別の曲」を押すと、同じ場面で違う曲になります。工房の内蔵ジェネレーター製なので、ゲームに使うのも、売るのも、素材として配るのも自由です。</p>
    <div className="row">
      <label>場面 <select value={mood} onChange={e => { setMood(e.target.value as SongMood); setTempo(null); }}>{SONG_MOODS.map(m => <option key={m} value={m}>{SONG_MOOD_LABELS[m]}</option>)}</select></label>
      <button className="button" onClick={() => setSeed(s => Math.max(1, s - 1))} disabled={seed <= 1}>前の曲</button>
      <span className="muted small">{seed}番</span>
      <button className="button" onClick={() => { setSeed(s => s + 1); setTempo(null); }}><Shuffle size={13} /> 別の曲</button>
      {mood !== "victory" && <label><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />長め（16小節）</label>}
    </div>
    <div className="row">
      {!isPlaying ? <button className="button primary" onClick={() => play(song)}><Play size={13} /> 試聴</button> : <button className="button" onClick={stop}><StopIcon size={13} /> 止める</button>}
      <label className="small">はやさ <input type="range" min={Math.max(40, baseTempo - 40)} max={Math.min(220, baseTempo + 40)} value={song.tempo} onChange={e => setTempo(Number(e.target.value))} /> {song.tempo}</label>
      <span className="muted small">{song.loop ? "くり返して流れます" : "1回だけ鳴ります"}・パート: {song.tracks.map(t => t.name).join("・")}</span>
    </div>
    <div className="row">
      <label>ID <input value={id} onChange={e => setId(e.target.value.toLowerCase())} placeholder={defaultId} style={{ width: "12em" }} /></label>
      <label>流す場所 <select value={place} onChange={e => setPlace(e.target.value)}><option value="">あとで決める</option>{places.map(p => <option key={p.key} value={p.key}>{p.label}{p.current ? `（今: ${p.current}）` : ""}</option>)}</select></label>
      <button className="button primary" onClick={add}><Plus size={13} /> この曲をゲームに入れる</button>
      <button className="button" title="ほかのツールや動画でも使える音声ファイル（WAV）" onClick={() => download(`${finalId}.wav`, songToWav(song), "audio/wav")}><Download size={13} /> WAVで保存</button>
    </div>
  </section>;
}

function AiSection({ onImport }: { onImport: () => void }) {
  const services = AI_IDS.map(id => SOURCE_CATALOG.find(s => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const [mood, setMood] = useState<SongMood>("field");
  const [style, setStyle] = useState(STYLES[0]!.id);
  const st = STYLES.find(s => s.id === style)!;
  const loopJa = mood === "victory" ? "" : "、ループしやすい（最初と最後が自然につながる）";
  const loopEn = mood === "victory" ? "" : ", seamless loop";
  const ja = `${MOOD_WORDS[mood].ja}。${st.ja}${loopJa}。歌なし。1〜2分。`;
  const en = `${MOOD_WORDS[mood].en}, ${st.en}${loopEn}, instrumental, 1-2 minutes`;
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };
  return <section className="card wide">
    <header><h3>音楽AIで作る</h3></header>
    <p className="muted small">外のサービスで曲を作り、ダウンロードしたファイルを「音声ファイルを取り込む」で入れます。工房からAIにはつながりません（リンクだけです）。</p>
    <ol className="small steps">
      <li>下の注文文をコピーして、サービスに貼ります（英語のほうが通じやすいサービスもあります）</li>
      <li>できた曲を MP3 か WAV でダウンロードします</li>
      <li><button className="linklike" onClick={onImport}>音声ファイルを取り込む</button> で「音楽AIで作った」を選び、サービスとプランを記録します</li>
    </ol>
    <div className="row">
      <label>場面 <select value={mood} onChange={e => setMood(e.target.value as SongMood)}>{SONG_MOODS.map(m => <option key={m} value={m}>{SONG_MOOD_LABELS[m]}</option>)}</select></label>
      <label>雰囲気 <select value={style} onChange={e => setStyle(e.target.value)}>{STYLES.map(s => <option key={s.id} value={s.id}>{s.ja}</option>)}</select></label>
    </div>
    <div className="prompt-box"><code>{ja}</code><button className="button" onClick={() => copy(ja)}>コピー</button></div>
    <div className="prompt-box"><code>{en}</code><button className="button" onClick={() => copy(en)}>コピー（英語）</button></div>
    <p className="small"><b>大事なこと</b>: 無料プランで作った曲は、たいてい<b>売るゲームには使えません</b>。有料プランに入っている間に作った曲だけが商用に使える、というサービスが多く、あとから有料にしても前の曲は商用にならないことがあります。既存の曲名・歌手名・作曲家名を注文に入れないでください。</p>
    <ul className="way-list">{services.map(s => <li key={s.id}>
      <a href={s.url} target="_blank" rel="noopener noreferrer"><b>{s.name}</b> <ExternalLink size={11} /></a>
      <span className="small">{s.summary}</span>
      {(s as { cautions?: string[] }).cautions?.map(c => <span key={c} className="small text-amber">注意: {c}</span>)}
    </li>)}</ul>
    <p className="muted small">上の条件は、工房が 2026年11月に解説記事やヘルプの抜粋から調べた目安です（規約の原文は未確認）。料金・条件は変わります。使う前に、必ずそのサービスの利用規約を読んでください。読んだら、取り込むときに「規約を読んで、売るゲームに使えると確かめた」に印を付けます（販売前チェックの「要確認」が消えます）。</p>
  </section>;
}

function SitesSection({ onImport }: { onImport: () => void }) {
  const sites = SOURCE_CATALOG.filter(s => s.origin === "site" && s.categories.includes("bgm") && s.integration !== "avoid" && s.url);
  return <section className="card wide">
    <header><h3>素材サイトから探す</h3></header>
    <p className="muted small">無料で使える曲を配っているサイトです。曲をダウンロードしたら <button className="linklike" onClick={onImport}>音声ファイルを取り込む</button> で「素材サイトから」を選び、曲のページのURLと、規約を読んだ日を記録します。</p>
    <ul className="way-list">{sites.map(s => <li key={s.id}>
      <a href={s.url} target="_blank" rel="noopener noreferrer"><b>{s.name}</b> <ExternalLink size={11} /></a>
      <span className="small">{s.summary}</span>
      <span className="muted small">クレジット表記: {s.creditRequired === "yes" ? "必要" : s.creditRequired === "no" ? "不要（任意）" : "曲・作者による"}{s.termsUrl ? <> ・ <a href={s.termsUrl} target="_blank" rel="noopener noreferrer">利用規約</a></> : null}</span>
    </li>)}</ul>
    <p className="muted small">条件の要約は工房が調べた目安で、規約の原文は未確認です。曲を使う前に、必ずそのサイトの規約を読んでください。素材の曲を、そのまま素材として配ったり売ったりすることは、どのサイトでもできません。</p>
  </section>;
}

function ImportSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"bgm" | "sfx">("bgm");
  const [id, setId] = useState("");
  const [how, setHow] = useState<"own" | "ai" | "site" | "bought">("own");
  const [sourceId, setSourceId] = useState("");
  const [plan, setPlan] = useState("有料プラン");
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [credit, setCredit] = useState("");
  const [termsDate, setTermsDate] = useState("");
  const [license, setLicense] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const aiServices = SOURCE_CATALOG.filter(s => s.origin === "generated" && s.categories.includes("bgm") && !s.id.startsWith("builtin-"));
  const sites = SOURCE_CATALOG.filter(s => s.origin === "site" && s.categories.some(c => c === "bgm" || c === "sfx") && s.integration !== "avoid");
  const places = musicPlaces(content);
  const today = new Date().toISOString().slice(0, 10);
  const choose = (f: File | undefined) => { if (!f) return; setFile(f); if (!id) setId(f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bgm"); };

  const doImport = async () => {
    if (!file || !store.source.importAsset) return;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) { window.alert("ID は英数字で始め、英数字・._- で入れてください"); return; }
    const src = how === "ai" ? aiServices.find(s => s.id === sourceId) : how === "site" ? sites.find(s => s.id === sourceId) : undefined;
    if ((how === "ai" || how === "site") && !src) { window.alert(how === "ai" ? "使ったサービスを選んでください（一覧になければ「AI作曲（音楽生成サービス全般）」）" : "サイトを選んでください"); return; }
    if (how === "site" && !/^https?:\/\//.test(url)) { window.alert("曲のページのURLを入れてください（あとで条件を確かめ直すときに使います）"); return; }
    // A project marked "shareable" (a template whose files may be handed out) cannot hold files that may not be redistributed.
    if (how !== "own" && content.project.assetPolicy.shareable) {
      if (!window.confirm("この作品は「共有用」（素材ごと配れるひな形）の設定になっています。ほかの人の曲やAIで作った曲を入れるには、共有用の設定を外す必要があります。外しますか？（自分のゲームとして作るなら外して大丈夫です）")) return;
      store.updateJson<Record<string, unknown>>("project.json", p => { p.assetPolicy = { ...((p.assetPolicy as Record<string, unknown> | undefined) ?? {}), shareable: false }; });
    }
    const entry: Record<string, unknown> = { id, kind, loop: kind === "bgm", notes: file.name };
    if (how === "own") Object.assign(entry, { origin: "original", source: "自作", license: "プロジェクト内素材", redistributable: true });
    if (how === "ai") Object.assign(entry, {
      origin: "generated", sourceId: src!.id, source: src!.name, license: `${src!.name} の利用規約（${plan}）`, redistributable: false,
      generator: { tool: src!.name, plan, createdAt: today }, ...(confirmed ? { commercial: true, termsCheckedAt: today } : {}),
    });
    if (how === "site") Object.assign(entry, {
      origin: "site", sourceId: src!.id, source: src!.name, license: license || `${src!.name} の利用規約`, url, redistributable: false,
      ...(author ? { author } : {}), ...(credit ? { credit } : {}), creditRequired: src!.creditRequired === "yes" || Boolean(credit), ...(termsDate ? { termsCheckedAt: termsDate } : {}),
    });
    if (how === "bought") Object.assign(entry, { origin: "purchased", source: "購入・依頼", license: license || "購入時のライセンス", redistributable: false, ...(author ? { author } : {}), ...(credit ? { credit, creditRequired: true } : {}) });
    setBusy(true);
    try {
      const result = await store.source.importAsset(file, entry);
      if (!result.ok) throw new Error(result.error);
      await store.reload([content.project.assetsPath]);
      // A catalog source must be turned on for this project before its files can be used.
      if (src && !src.defaultEnabled) store.updateJson<Record<string, unknown>>("project.json", p => {
        const policy = { ...((p.assetPolicy as Record<string, unknown> | undefined) ?? {}) };
        policy.sources = { ...((policy.sources as Record<string, boolean> | undefined) ?? {}), [src.id]: true };
        p.assetPolicy = policy;
      });
      if (place) setMusicAt(store, content, place, id);
      store.log("ok", `${result.asset.id} を ${result.asset.path} に取り込みました${place ? `（${places.find(p => p.key === place)?.label}で流れます）` : ""}${how === "ai" && !confirmed ? "。売るゲームに使う前に、サービスの規約を読んで「商用可」を記録してください（素材画面）" : ""}`);
      setFile(null); setId("");
    } catch (error) { store.log("error", `取り込めません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  if (!store.source.importAsset) return <section className="card wide"><p className="muted small">この環境では音声ファイルを取り込めません。</p></section>;
  return <section className="card wide music-import">
    <header><h3><Upload size={15} /> 音声ファイルを取り込む</h3></header>
    <input ref={input} type="file" accept=".mp3,.ogg,.wav,audio/*" hidden onChange={e => { choose(e.target.files?.[0]); e.target.value = ""; }} />
    <button type="button" className="asset-import-drop" onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files?.[0]); }}>
      <Upload size={20} /><b>{file ? file.name : "曲のファイルをここへドラッグ＆ドロップ"}</b><span className="muted small">またはクリックして選ぶ（MP3・OGG・WAV、20MBまで）</span>
    </button>
    {file && <>
      <div className="row">
        <label>ID <input value={id} onChange={e => setId(e.target.value)} style={{ width: "12em" }} /></label>
        <label>種類 <select value={kind} onChange={e => setKind(e.target.value as "bgm" | "sfx")}><option value="bgm">BGM（くり返す）</option><option value="sfx">効果音・ジングル（1回）</option></select></label>
        <label>流す場所 <select value={place} onChange={e => setPlace(e.target.value)}><option value="">あとで決める</option>{places.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
      </div>
      <div className="row"><b className="small">この曲はどうやって手に入れましたか？</b>
        {([["own", "自分で作った"], ["ai", "音楽AIで作った"], ["site", "素材サイトから"], ["bought", "購入・依頼"]] as const).map(([v, l]) => <label key={v}><input type="radio" name="music-how" checked={how === v} onChange={() => { setHow(v); setSourceId(""); }} />{l}</label>)}
      </div>
      {how === "ai" && <div className="row">
        <label>サービス <select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">選ぶ…</option>{aiServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>作ったときのプラン <select value={plan} onChange={e => setPlan(e.target.value)}><option>有料プラン</option><option>無料プラン</option><option>わからない</option></select></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />規約を読んで、売るゲームに使えると確かめた</label>
        {plan === "無料プラン" && <span className="small text-amber">無料プランの曲は、たいてい売るゲームに使えません</span>}
      </div>}
      {how === "site" && <div className="row">
        <label>サイト <select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">選ぶ…</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>曲のページのURL <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
        <label>作曲者 <input value={author} onChange={e => setAuthor(e.target.value)} /></label>
        <label>クレジット表記 <input value={credit} onChange={e => setCredit(e.target.value)} placeholder="例: 音楽: 〇〇（サイト名）" /></label>
        <label>規約を読んだ日 <input type="date" value={termsDate} onChange={e => setTermsDate(e.target.value)} /></label>
      </div>}
      {how === "bought" && <div className="row">
        <label>ライセンス・条件 <input value={license} onChange={e => setLicense(e.target.value)} placeholder="購入ページに書かれた条件の名前" /></label>
        <label>作者 <input value={author} onChange={e => setAuthor(e.target.value)} /></label>
        <label>クレジット表記 <input value={credit} onChange={e => setCredit(e.target.value)} /></label>
      </div>}
      <div className="row"><button className="button primary" disabled={busy} onClick={() => void doImport()}><Upload size={13} /> {busy ? "取り込み中…" : "取り込む"}</button></div>
    </>}
  </section>;
}
