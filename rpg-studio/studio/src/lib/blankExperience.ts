import { freeId, type BrowserProject } from "./browserProjects";

const fmt = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** A neutral independent project: it chooses no genre, player role, or game loop. */
export async function blankExperience(title: string, runtime: "experience" | "static" = "experience"): Promise<BrowserProject> {
  const name = title.trim() || "わたしの作品";
  const id = await freeId("my-experience");
  const now = new Date().toISOString();
  const texts: Record<string, string> = {
    "experience.json": fmt({ formatVersion: 1, id, title: name, runtime, entry: runtime === "static" ? "index.html" : "systems/main.ts", assetsPath: "assets.json", args: {}, save: { enabled: true, autosave: true } }),
    "assets.json": fmt({ formatVersion: 1, assets: [] }),
    ...(runtime === "static" ? {
      "index.html": `<!doctype html>\n<html lang="ja">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${name.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)}</title>\n</head>\n<body>\n  <!-- ここから先は自由です。CSS・JavaScript・Canvas・WebAudio・WASM等を好きな構成で追加できます。 -->\n  <main id="app"></main>\n</body>\n</html>\n`,
      "README.md": `# ${name}\n\nこれは独自ランタイム作品です。RPG Studio は制作方法やゲームルールを指定せず、公開時に作品ファイルをそのまままとめます。\n\n- index.html: 配布サイトの起点\n- assets.json: 工房から追加した画像・音声・フォントと出典\n\nCSS・JavaScript・Canvas・WebAudio・WASMや、お好みのファイル構成を自由に追加できます。ローカル工房では \`pnpm rpg dev --project <作品フォルダー>\` で試遊できます。\n`,
    } : {}),
    ...(runtime === "experience" ? {
    "systems/main.ts": `import { defineExperience, type ExperienceInput } from "@rpg/engine";

type State = {};

export default defineExperience<State>({
  id: ${JSON.stringify(id)},
  version: 1,
  title: ${JSON.stringify(name)},
  start: () => ({}),
  update: (state, _input: ExperienceInput) => state,
  render(host) {
    const screen = document.createElement("main");
    screen.style.cssText = "box-sizing:border-box;min-height:100dvh;display:grid;place-content:center;padding:24px;background:#101315;color:#f5f0df;font:16px/1.7 system-ui,sans-serif;text-align:center";
    const heading = document.createElement("h1");
    heading.textContent = ${JSON.stringify(name)};
    const note = document.createElement("p");
    note.textContent = "この画面から、思いついた体験を自由に実装できます。";
    screen.append(heading, note);
    host.append(screen);
  },
});
`,
    "README.md": `# ${name}\n\nRPGの主人公・マップ・HPを前提にしない独立作品です。ジャンル・役割・操作・終わり方はまだ決めていません。\n\n- experience.json: 作品情報\n- systems/main.ts: 状態・入力・画面全体\n- assets.json: 素材の出典と一覧\n\nこのブラウザで編集できます。作品ZIPは Codex／Claude Code のローカル制作にも渡せます。\n`,
    "tests/README.md": `# 作品の入力シナリオ\n\nこのフォルダーに *.experience.json を追加すると、ローカルで pnpm rpg test --project <作品フォルダー> を実行して update() の状態遷移を確認できます。形式と例は docs/experience-projects.md を参照してください。画面・音・操作感はプレビューで確認します。\n`,
    } : {}),
  };
  return { id, title: name, origin: "blank", texts, files: {}, createdAt: now, updatedAt: now };
}
