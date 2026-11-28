import { z } from "zod";

const ExperienceIdSchema = z.string().min(1).max(96).regex(/^[a-z0-9][a-z0-9._-]*$/i);
const ExperiencePathSchema = z.string().min(1).max(240).refine(
  value => !value.includes("\\") && !value.startsWith("/") && !value.split("/").some(part => part === "" || part === "." || part === ".."),
  "プロジェクト内の相対POSIXパスを指定してください",
);
const StaticBuildSchema = z.object({
  /** A creator-owned shell command. The CLI runs it only with --run-project-build. */
  command: z.string().trim().min(1).max(500).refine(value => !value.includes("\0"), "ビルドコマンドにNUL文字は使えません"),
  /** Directory produced by the command, relative to the project folder. */
  outputDir: ExperiencePathSchema.default("dist"),
}).strict();

/**
 * Minimal project format for games that own their complete runtime.
 * It deliberately has no player, map, HP, battle, party, or quest fields.
 */
export const EXPERIENCE_FORMAT_VERSION = 1;
export const ExperienceProjectSchema = z.object({
  formatVersion: z.literal(EXPERIENCE_FORMAT_VERSION),
  id: ExperienceIdSchema,
  title: z.string().min(1).max(120),
  /** experience: use the optional state/update/render host. static: ship a creator-owned site rooted at index.html. */
  runtime: z.enum(["experience", "static"]).default("experience"),
  entry: ExperiencePathSchema.default("systems/main.ts"),
  /** Optional source build recipe for static sites. Never run automatically. */
  build: StaticBuildSchema.optional(),
  assetsPath: ExperiencePathSchema.default("assets.json"),
  args: z.record(z.string(), z.unknown()).default({}),
  save: z.object({
    enabled: z.boolean().default(true),
    autosave: z.boolean().default(true),
  }).strict().default({ enabled: true, autosave: true }),
}).strict().superRefine((project, ctx) => {
  if (project.runtime === "experience" && !project.entry.toLowerCase().endsWith(".ts")) {
    ctx.addIssue({ code: "custom", path: ["entry"], message: "experience runtime の entry は TypeScript ファイル(.ts)を指定してください" });
  }
  if (project.runtime !== "static" && project.build !== undefined) {
    ctx.addIssue({ code: "custom", path: ["build"], message: "build 設定は static runtime でのみ使えます" });
  }
  if (project.runtime === "static" && project.entry !== "index.html") {
    ctx.addIssue({ code: "custom", path: ["entry"], message: "static runtime の entry は公開先の起点となる index.html を指定してください" });
  }
});

export type ExperienceProject = z.infer<typeof ExperienceProjectSchema>;
