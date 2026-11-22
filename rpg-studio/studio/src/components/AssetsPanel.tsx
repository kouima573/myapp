import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardCopy, ExternalLink, Music2, Play, Square, Volume2 } from "lucide-react";
import {
  artPrompt, ArtRequestBundleSchema, isSourceEnabled, SFX_CUES, SOURCE_CATALOG_NOTE, sourcesFor,
  type ArtRequest, type AssetEntry, type GameContent, type GameMap, type ProjectManifest,
} from "@rpg/schema";
import { AudioManager } from "../../../packages/runtime/src/audio";
import { encodeWav, presetParams, renderSfx, SFX_PRESETS, type SfxPreset } from "../../../packages/runtime/src/sfx";
import type { ImageMap } from "../../../packages/runtime/src/render";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent; images: ImageMap }

const MB = 1024 * 1024;
const KIND_LABEL: Record<AssetEntry["kind"], string> = { tileset: "タイル", character: "キャラ", enemy: "敵", animation: "アニメ", portrait: "立ち絵", background: "背景", bgm: "BGM", sfx: "効果音", song: "楽譜BGM", font: "フォント" };
const CUE_LABEL: Record<string, string> = { cursor: "カーソル", confirm: "決定", cancel: "キャンセル", bump: "壁に当たる", hit: "攻撃が当たる", hurt: "ダメージ", heal: "回復", encounter: "戦闘開始", victory: "勝利", defeat: "敗北", door: "場所移動", item: "アイテム入手", save: "セーブ", menu: "メニュー", text: "文字送り（audio.textSound が true のとき）" };
const ORIGIN_LABEL: Record<AssetEntry["origin"], string> = { original: "自作", generated: "生成", site: "サイト", purchased: "購入", commission: "依頼" };

const ASSET_PROMPTS = [
  { label: "チャットで素材を選ぶ", text: "AGENTS.md の「素材はチャットの中で決める」の手順で、次の素材の候補を `pnpm rpg asset find`（画像は `pnpm rpg library preview` の番号つき見本）で番号つきで見せて。音は聴けるURLを出して、選ぶのは私。決まったら出どころ・ライセンスつきで登録して validate / test / build を通して。\n\n欲しい素材：" },
  { label: "効果音を追加", text: "次の場面の効果音を用意して。まず `pnpm rpg asset sources` で有効な取得元と確認事項を見て、prefer の順（生成→サイト）で探す。生成なら `pnpm rpg asset gen-sfx`、サイトなら規約の原文を読んでから `pnpm rpg asset add`（--source --url --license --terms-checked 必須、作者の注意書きは --notes）。project.json の audio.sfx に割り当てて validate / test / build を通す。\n\n場面：" },
  { label: "BGMを追加", text: "次の場所のBGMを用意して。軽さを優先して、まず楽譜BGM（.song.json、docs/asset-guide.md の書式）でオリジナル曲を作る案と、有効なサイトから商用利用可の曲を選ぶ案を比べて提案して。サイトの曲は規約・作曲者ごとの条件を確認し、OGG 96〜128kbps・1曲3MB以内にして `pnpm rpg asset add` で登録。\n\n場所・雰囲気：" },
  { label: "キャラ画像を作る", text: "art/requests.json に次のキャラクターの依頼を draft で追加して、内容を私に確認して。承認後に `pnpm rpg art prompt --id <依頼>` の文章で画像を生成し、`pnpm rpg art check` で寸法を確認してから `pnpm rpg asset add --request` で登録、マップに配置して。\n\nキャラクター：" },
  { label: "タイルを増やす", text: "art/requests.json の tiles-ruins-interior を私の要望に合わせて更新して確認を取り、生成後に tiles.json へ新しいシート（atlas）付きでタイル定義を追加して。既存タイルの並びは変えない。\n\n要望：" },
];

function useAudio(content: GameContent, resolve: (asset: AssetEntry) => Promise<string>) {
  const ref = useRef<AudioManager | null>(null);
  useEffect(() => () => { ref.current?.dispose(); ref.current = null; }, [content]);
  return () => {
    if (!ref.current) ref.current = new AudioManager(content, resolve, { bgm: true, sfx: true });
    ref.current.unlock();
    return ref.current;
  };
}

export default function AssetsPanel({ store, content, images }: Props) {
  const project = content.project;
  const [playing, setPlaying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [preset, setPreset] = useState<SfxPreset>("confirm");
  const [seed, setSeed] = useState(1);
  const audio = useAudio(content, asset => store.source.assetUrl(asset));
  const sources = sourcesFor(project);
  const budget = project.assetPolicy.budget;

  const size = useMemo(() => {
    const data = Object.values(store.texts).reduce((sum, text) => sum + new Blob([text]).size, 0);
    const assets = content.assets.assets.reduce((sum, a) => sum + a.bytes, 0);
    return { data, assets, total: data + assets };
  }, [store.texts, content.assets.assets]);
  const pct = Math.min(100, (size.total / (budget.maxTotalMB * MB)) * 100);

  const requests: ArtRequest[] = useMemo(() => {
    try { return ArtRequestBundleSchema.parse(JSON.parse(store.texts["art/requests.json"] ?? "")).requests; } catch { return []; }
  }, [store.texts]);
  const styleGuide = store.texts["art/style-guide.md"] ?? "";

  const editProject = (recipe: (p: ProjectManifest & Record<string, unknown>) => void) => store.updateJson("project.json", recipe);
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(null), 1500); }
    catch { store.log("warn", "クリップボードを使えません"); }
  };
  const audioAssets = content.assets.assets.filter(a => a.kind === "bgm" || a.kind === "sfx" || a.kind === "song");
  const musicAssets = audioAssets.filter(a => a.kind !== "sfx");
  const soundAssets = audioAssets;

  const preview = (asset: AssetEntry) => {
    const manager = audio();
    if (playing === asset.id) { manager.setMusic(null); setPlaying(null); return; }
    if (asset.kind === "sfx") { manager.playSound(asset.id); return; }
    manager.setMusic(asset.id);
    setPlaying(asset.id);
  };
  const previewPreset = () => {
    const ctx = new AudioContext();
    const samples = renderSfx(presetParams(preset, seed), ctx.sampleRate, seed);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => void ctx.close();
    src.start();
  };
  const downloadPreset = () => {
    const wav = encodeWav(renderSfx(presetParams(preset, seed), 22050, seed));
    const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sfx-${preset}-${seed}.wav`; a.click();
    URL.revokeObjectURL(url);
  };

  const warnings = (a: AssetEntry): string[] => {
    const out: string[] = [];
    const external = a.origin === "site" || a.origin === "purchased" || a.origin === "commission";
    if (external && !a.termsCheckedAt) out.push("規約未確認");
    if (a.creditRequired && !a.credit) out.push("クレジット文言なし");
    if (!a.redistributable && project.assetPolicy.shareable) out.push("共有不可");
    const src = a.sourceId ? sources.find(s => s.id === a.sourceId) : undefined;
    if (src && !isSourceEnabled(project, src)) out.push("取得元が無効");
    return out;
  };

  return <div className="assets-panel">
    <section className="card">
      <header><h3>容量</h3><span className={`badge ${pct > 100 ? "error" : size.total > budget.warnTotalMB * MB ? "warn" : "ok"}`}>{(size.total / MB).toFixed(2)}MB / {budget.maxTotalMB}MB</span></header>
      <div className="budget-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted small">素材 {(size.assets / MB).toFixed(2)}MB・データ {(size.data / 1024).toFixed(0)}KB。目安 {budget.warnTotalMB}MB を超えるとWeb公開やスマホでの読み込みが重くなります。1ファイル上限 {budget.maxFileMB}MB。上限は project.json の assetPolicy.budget で変更できます（推奨・理由は docs/asset-guide.md）。</p>
      <div className="field-row">
        {(["warnTotalMB", "maxTotalMB", "maxFileMB"] as const).map(key => <label key={key} className="field"><span className="field-label">{key === "warnTotalMB" ? "目安(MB)" : key === "maxTotalMB" ? "上限(MB)" : "1ファイル上限(MB)"}</span>
          <input type="number" min={1} value={budget[key]} onChange={e => { const v = Number(e.target.value); if (v > 0) editProject(p => { const pol = (p.assetPolicy ??= {} as never) as { budget?: Record<string, number> }; pol.budget = { ...budget, ...pol.budget, [key]: v }; }); }} /></label>)}
      </div>
    </section>

    <section className="card wide">
      <header><h3>素材一覧</h3><span className="muted small">{content.assets.assets.length}件</span></header>
      <div className="asset-table">
        {content.assets.assets.map(a => {
          const src = a.sourceId ? sources.find(s => s.id === a.sourceId) : undefined;
          const warn = warnings(a);
          const image = images[a.id];
          return <div key={a.id} className="asset-row">
            <div className="asset-thumb">
              {image?.src ? <img src={image.src} alt="" /> : a.kind === "sfx" || a.kind === "bgm" || a.kind === "song"
                ? <button className="icon-button" onClick={() => preview(a)} title="試聴">{playing === a.id ? <Square size={13} /> : a.kind === "sfx" ? <Volume2 size={13} /> : <Play size={13} />}</button>
                : <Music2 size={14} />}
            </div>
            <div className="asset-main">
              <div><b className="mono">{a.id}</b> <span className="tag">{KIND_LABEL[a.kind]}</span> <span className="tag">{ORIGIN_LABEL[a.origin]}</span> <span className="muted small">{(a.bytes / 1024).toFixed(1)}KB</span></div>
              <div className="muted small">{src?.name ?? a.source}・{a.license}{a.author ? `・作者 ${a.author}` : ""}{a.termsCheckedAt ? `・規約確認 ${a.termsCheckedAt}` : ""}{a.credit ? `・表記「${a.credit}」` : ""}</div>
              {a.notes && <div className="muted small">注: {a.notes}</div>}
            </div>
            <div className="asset-flags">{warn.map(w => <span key={w} className="badge error"><AlertTriangle size={11} /> {w}</span>)}{!a.redistributable && <span className="badge warn">再配布不可</span>}</div>
          </div>;
        })}
      </div>
      <p className="muted small">追加は CLI（<code>pnpm rpg asset add</code> / <code>gen-sfx</code>）かエージェントで行います。工房からは画像・音声ファイルを書き込みません。</p>
    </section>

    <section className="card">
      <header><h3>音の割り当て</h3></header>
      <div className="cue-grid">
        <label className="field"><span className="field-label">戦闘BGM</span>
          <select value={project.audio.battle ?? ""} onChange={e => editProject(p => { const au = (p.audio ??= {} as never) as Record<string, unknown>; if (e.target.value) au.battle = e.target.value; else delete au.battle; })}>
            <option value="">（なし）</option>{musicAssets.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select></label>
        <label className="field"><span className="field-label">勝利の音</span>
          <select value={project.audio.victory ?? ""} onChange={e => editProject(p => { const au = (p.audio ??= {} as never) as Record<string, unknown>; if (e.target.value) au.victory = e.target.value; else delete au.victory; })}>
            <option value="">（内蔵）</option>{soundAssets.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select></label>
        {SFX_CUES.map(cue => <label key={cue} className="field"><span className="field-label">{CUE_LABEL[cue]}</span>
          <select value={project.audio.sfx[cue] ?? ""} onChange={e => editProject(p => { const au = (p.audio ??= {} as never) as { sfx?: Record<string, string> }; const sfx = { ...au.sfx }; if (e.target.value) sfx[cue] = e.target.value; else delete sfx[cue]; au.sfx = sfx; })}>
            <option value="">（内蔵の簡易音）</option>{audioAssets.filter(a => a.kind === "sfx").map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select></label>)}
      </div>
      <h4 className="sub">マップごとのBGM</h4>
      <div className="cue-grid">
        {project.maps.map(ref => <label key={ref.id} className="field"><span className="field-label">{ref.title}</span>
          <select value={content.maps[ref.id]?.bgm ?? ""} onChange={e => store.updateJson<GameMap>(ref.path, m => { if (e.target.value) m.bgm = e.target.value; else delete m.bgm; })}>
            <option value="">（なし）</option>{musicAssets.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select></label>)}
      </div>
    </section>

    <section className="card">
      <header><h3>効果音ジェネレーター</h3></header>
      <p className="muted small">内蔵の合成器でオリジナル効果音を作ります（第三者の権利なし）。気に入ったら CLI で登録: <code>pnpm rpg asset gen-sfx --preset {preset} --seed {seed} --id sfx-{preset}</code></p>
      <div className="field-row">
        <label className="field"><span className="field-label">種類</span><select value={preset} onChange={e => setPreset(e.target.value as SfxPreset)}>{SFX_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="field"><span className="field-label">バリエーション</span><input type="number" min={1} value={seed} onChange={e => setSeed(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button className="button" onClick={previewPreset}><Volume2 size={14} /> 試聴</button>
        <button className="button" onClick={downloadPreset}>WAV保存</button>
        <button className="button" onClick={() => void copy("gen", `pnpm rpg asset gen-sfx --preset ${preset} --seed ${seed} --id sfx-${preset}`)}><ClipboardCopy size={14} /> {copied === "gen" ? "コピー済" : "コマンド"}</button>
      </div>
    </section>

    <section className="card wide">
      <header><h3>素材の取得元</h3><span className="muted small">プロジェクトごとにON/OFF</span></header>
      <p className="muted small"><AlertTriangle size={11} /> {SOURCE_CATALOG_NOTE}</p>
      <label className="check"><input type="checkbox" checked={project.assetPolicy.shareable} onChange={e => editProject(p => { const pol = (p.assetPolicy ??= {} as never) as Record<string, unknown>; pol.shareable = e.target.checked; })} /> 共有用プロジェクト（テンプレートとして配る。再配布禁止の素材は入れられない）</label>
      <div className="source-list">
        {sources.map(src => {
          const on = isSourceEnabled(project, src);
          return <div key={src.id} className={`source ${on ? "is-on" : ""}`}>
            <label className="check"><input type="checkbox" checked={on} onChange={e => editProject(p => { const pol = (p.assetPolicy ??= {} as never) as { sources?: Record<string, boolean> }; pol.sources = { ...pol.sources, [src.id]: e.target.checked }; })} /> <b>{src.name}</b></label>
            <div className="muted small">{src.categories.join("・")} ／ クレジット: {src.creditRequired} ／ テンプレートへの再配布: {src.redistribution} ／ 自動取得: {src.automatedDownload} ／ {src.verifiedAt ? `確認 ${src.verifiedAt}` : "規約原文は未照合"}</div>
            <div className="small">{src.summary}</div>
            {src.checklist.length > 0 && <ul className="small checklist">{src.checklist.map(item => <li key={item}>{item}</li>)}</ul>}
            {(src.termsUrl ?? src.url) && <a className="small" href={src.termsUrl ?? src.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={11} /> 規約・サイト</a>}
          </div>;
        })}
      </div>
      <h4 className="sub">入手方法の優先順</h4>
      <div className="cue-grid">
        {(["image", "bgm", "sfx", "song"] as const).map(cat => <label key={cat} className="field"><span className="field-label">{cat === "image" ? "画像" : cat === "bgm" ? "BGM" : cat === "sfx" ? "効果音" : "楽譜BGM"}</span>
          <select value={(project.assetPolicy.prefer[cat] ?? []).join(",")} onChange={e => editProject(p => { const pol = (p.assetPolicy ??= {} as never) as { prefer?: Record<string, string[]> }; pol.prefer = { ...pol.prefer, [cat]: e.target.value ? e.target.value.split(",") : [] }; })}>
            <option value="">（指定なし）</option><option value="generate">生成のみ</option><option value="generate,site">生成 → サイト</option><option value="site,generate">サイト → 生成</option><option value="site">サイトのみ</option><option value="site,purchased,commission">サイト → 購入 → 依頼</option>
          </select></label>)}
      </div>
    </section>

    <section className="card wide">
      <header><h3>画像の依頼（要件定義）</h3><span className="muted small">art/requests.json ・ art/style-guide.md</span></header>
      {!requests.length && <p className="muted small">art/requests.json がありません。エージェントに「キャラ画像を作る」で依頼すると作成されます。</p>}
      <div className="request-list">
        {requests.map(r => <div key={r.id} className="request">
          <div className="request-head"><b>{r.title}</b> <span className="tag">{r.kind}</span> <span className="tag">{r.mode === "generate" ? "生成" : r.mode === "site" ? "サイト" : "依頼"}</span>
            <select value={r.status} onChange={e => store.updateJson<{ requests: ArtRequest[] }>("art/requests.json", d => { const t = d.requests.find(x => x.id === r.id); if (t) t.status = e.target.value as ArtRequest["status"]; })}>
              {["draft", "approved", "in-progress", "done", "rejected"].map(s => <option key={s} value={s}>{s === "draft" ? "下書き" : s === "approved" ? "承認済み" : s === "in-progress" ? "制作中" : s === "done" ? "完了" : "見送り"}</option>)}
            </select>
            <span className="spacer" />
            <button className="button" onClick={() => void copy(r.id, artPrompt(r, styleGuide))}><ClipboardCopy size={13} /> {copied === r.id ? "コピー済" : "生成用プロンプト"}</button>
          </div>
          <div className="small">{r.description}</div>
          <div className="muted small">{r.spec.cellWidth}×{r.spec.cellHeight}px × {r.spec.columns}列{r.spec.rows}行{r.spec.transparent ? "・透過" : ""}{r.assetId ? ` → 素材ID ${r.assetId}` : ""}</div>
          <textarea className="small" rows={2} placeholder="あなたの要望・前回の生成結果へのフィードバック（例: もっと小柄に、帽子は赤で）" defaultValue={r.userNotes}
            onBlur={e => { const v = e.target.value; if (v !== r.userNotes) store.updateJson<{ requests: ArtRequest[] }>("art/requests.json", d => { const t = d.requests.find(x => x.id === r.id); if (t) t.userNotes = v; }); }} />
        </div>)}
      </div>
    </section>

    <section className="card wide">
      <header><h3>エージェントへの依頼（素材）</h3></header>
      <div className="chips">{ASSET_PROMPTS.map(p => <button key={p.label} className="chip" onClick={() => void copy(p.label, `${p.text}\n\n作業ルール: AGENTS.md と docs/asset-guide.md に従う。規約を守れない素材は使わない。最後に pnpm rpg validate / test / build と pnpm rpg asset report を実行する。`)}>{copied === p.label ? "コピーしました" : p.label}</button>)}</div>
      <p className="muted small">チップを押すと依頼文がコピーされます。Codex／Claude Codeに貼り付け、末尾に具体的な内容を書き足してください。</p>
    </section>
  </div>;
}
