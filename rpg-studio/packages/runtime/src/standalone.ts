/**
 * Entry for the static game build. The CLI generates a tiny module that imports this file plus the
 * project's systems and calls `bootStandalone`. Data JSON is fetched from `./data/` so a built game
 * can still be inspected and patched without rebuilding.
 */
import { loadProjectContent, referencedJsonFiles, type ProjectManifest } from "../../schema/src/index";
import type { GameSystem } from "../../engine/src/index";
import { formatDiagnostic } from "../../schema/src/validate";
import { mountGame } from "./player";

export async function bootStandalone(options: { systems: GameSystem[]; host?: HTMLElement; dataBase?: string }): Promise<void> {
  const host = options.host ?? document.getElementById("game")!;
  const base = options.dataBase ?? "./data/";
  const status = document.getElementById("boot-status");
  try {
    const fetchText = async (path: string) => {
      const response = await fetch(new URL(path, new URL(base, location.href)));
      if (!response.ok) throw new Error(`${path} を取得できません (HTTP ${response.status})`);
      return response.text();
    };
    const manifestText = await fetchText("project.json");
    const manifest = JSON.parse(manifestText) as ProjectManifest;
    const files = referencedJsonFiles(manifest).filter(path => path !== "project.json");
    const texts: Record<string, string> = { "project.json": manifestText };
    await Promise.all(files.map(async path => { texts[path] = await fetchText(path); }));
    // System sources are compiled into the bundle; mark them present for validation.
    for (const system of manifest.systems ?? []) texts[system.path] = "";
    const result = loadProjectContent(texts);
    if (!result.content) throw new Error(result.diagnostics.filter(d => d.severity === "error").map(formatDiagnostic).join("\n"));
    const content = result.content;
    document.title = content.project.title;
    status?.remove();
    const handle = mountGame(host, {
      content,
      systems: options.systems,
      resolveAsset: asset => new URL(asset.path, new URL(base, location.href)).href,
      keyboard: "window",
    });
    handle.focus();
    // `?debug` exposes the handle for automated play-tests and quick inspection in DevTools.
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { rpg: unknown }).rpg = handle;
  } catch (error) {
    if (status) {
      status.textContent = `ゲームを起動できません:\n${error instanceof Error ? error.message : String(error)}`;
      status.classList.add("is-error");
    }
    throw error;
  }
}
