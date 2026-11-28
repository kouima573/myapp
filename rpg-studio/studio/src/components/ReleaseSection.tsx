import { useState, type ReactElement } from "react";
import { BadgeCheck, CircleAlert, CircleX, CircleDashed, ShoppingBag } from "lucide-react";
import { releaseChecklist, type ReleaseReport, type ReleaseStatus } from "../../../packages/cli/src/releaseCheck";
import { runScenario, ScenarioSchema } from "../../../packages/engine/src/scenario";
import { withModules } from "../../../packages/modules/src/index";
import type { ProjectStore } from "../lib/useProject";

const ICON: Record<ReleaseStatus, ReactElement> = {
  ok: <BadgeCheck size={14} className="ok-text" />, warn: <CircleAlert size={14} className="text-amber" />, block: <CircleX size={14} className="error-text" />, todo: <CircleDashed size={14} className="muted" />,
};
const VERDICT: Record<ReleaseReport["verdict"], string> = {
  ready: "公開・販売できる状態です。",
  warn: "止めるほどではありませんが、「注意」の項目を見てから出してください。",
  blocked: "「不可」の項目を直すまで、公開・販売しないでください。",
};

/** 販売前チェック: 検証・自動テスト・エンディング・書きかけ・文章・素材の権利・クレジットを1か所で（CLI: pnpm rpg release-check）。 */
export default function ReleaseSection({ store }: { store: ProjectStore }) {
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const run = () => {
    const content = store.content;
    let tests: Array<{ file: string; ok: boolean; message?: string }> | undefined;
    if (content) {
      const systems = withModules(content, store.systems);
      tests = Object.keys(store.texts).filter(f => f.startsWith("tests/") && f.endsWith(".scenario.json")).sort().map(file => {
        try {
          const r = runScenario(content, systems, ScenarioSchema.parse(JSON.parse(store.texts[file]!)));
          return { file, ok: r.ok, message: r.ok ? undefined : `steps[${r.failedStep ?? "?"}] ${r.message ?? ""}` };
        } catch (error) { return { file, ok: false, message: error instanceof Error ? error.message : String(error) }; }
      });
    }
    setReport(releaseChecklist({ content, texts: store.texts, diagnostics: store.diagnostics, tests }));
  };
  return <section className="card release-check">
    <header><h3><ShoppingBag size={15} /> 販売前チェック</h3></header>
    <p className="muted small">公開・販売の前に、検証・自動テスト・エンディング・書きかけの文章・文章の点検・素材の権利（このゲームを売ってよいか）・クレジットをまとめて確かめます。CLI: <code>pnpm rpg release-check</code></p>
    <div className="row">
      <button className="button primary" onClick={run}>チェックする</button>
      {store.content && <label title="セーブに記録されます。更新して出すたびに上げてください（例 1.0.0 → 1.1.0）">ゲームの版
        <input value={store.content.project.version ?? ""} placeholder="1.0.0" style={{ width: "7em" }}
          onChange={e => { const v = e.target.value.trim(); store.updateJson<Record<string, unknown>>("project.json", data => { if (v) data.version = v; else delete data.version; }); }} /></label>}
    </div>
    <p className="muted small">更新しても買った人のセーブが消えないように: 公開する版で <code>pnpm rpg release snapshot</code> を実行すると、その版のセーブ見本が <code>releases/版/saves/</code> に残ります。次に更新したとき <code>pnpm rpg release-check</code> が、それを今の版で読み込んで動かし、消したアイテム・技・仲間や、なくなったマップを知らせます（この確認は手元のCLIで行います）。</p>
    {report && <>
      <p className={report.verdict === "ready" ? "ok-text" : report.verdict === "warn" ? "text-amber" : "error-text"}><b>{VERDICT[report.verdict]}</b></p>
      <ul className="release-items">{report.items.map(item => <li key={item.id}>
        <div className="release-head">{ICON[item.status]} <b>{item.label}</b></div>
        {item.details.length > 0 && <ul className="small">{item.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      </li>)}</ul>
      <p className="muted small">素材の「要確認」は、規約を読んだうえで assets.json のその素材に <code>"commercial": true</code>（売ってよい）か <code>false</code> を書くと消えます。AI生成の画像は、使った生成サービスの規約で決まります。</p>
    </>}
  </section>;
}
