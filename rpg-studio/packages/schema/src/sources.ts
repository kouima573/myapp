import catalogJson from "./asset-sources.json";
import { AssetSourceSchema, type AssetEntry, type AssetSource, type ProjectManifest } from "./formats";

/** Built-in catalog of asset sources (editable JSON). Projects add their own via assetPolicy.customSources. */
export const SOURCE_CATALOG: AssetSource[] = (catalogJson as { sources: unknown[] }).sources.map(source => AssetSourceSchema.parse(source));
export const SOURCE_CATALOG_NOTE: string = (catalogJson as { note: string }).note;

export function sourcesFor(project: Pick<ProjectManifest, "assetPolicy">): AssetSource[] {
  const custom = project.assetPolicy.customSources;
  return [...SOURCE_CATALOG.filter(s => !custom.some(c => c.id === s.id)), ...custom];
}

export function isSourceEnabled(project: Pick<ProjectManifest, "assetPolicy">, source: AssetSource): boolean {
  return project.assetPolicy.sources[source.id] ?? source.defaultEnabled;
}

export function assetCategory(kind: AssetEntry["kind"]): "image" | "bgm" | "sfx" | "song" {
  return kind === "bgm" || kind === "sfx" || kind === "song" ? kind : "image";
}
