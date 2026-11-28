import { z } from "zod";
import type { ExperienceDefinition, ExperienceInput } from "./experience";

const InputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("key"), key: z.string().min(1) }).strict(),
  z.object({ type: z.literal("custom"), value: z.unknown() }).strict(),
  z.object({ type: z.literal("frame"), held: z.array(z.string()) }).strict(),
]);

const ExpectSchema = z.object({
  equals: z.unknown().optional(),
  contains: z.unknown().optional(),
  paths: z.record(z.string().min(1), z.unknown()).optional(),
}).strict().refine(value => value.equals !== undefined || value.contains !== undefined || (value.paths && Object.keys(value.paths).length > 0), "equals、contains、paths のいずれかを指定してください");

export const ExperienceScenarioSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(z.object({ input: InputSchema, expect: ExpectSchema.optional() }).strict()).min(1),
}).strict();

export type ExperienceScenario = z.infer<typeof ExperienceScenarioSchema>;
export interface ExperienceScenarioResult { name: string; ok: boolean; steps: number; failedStep?: number; message?: string }

function jsonCopy(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("状態がJSONで表せません。undefined・関数・循環参照を状態に入れないでください");
  return JSON.parse(text) as unknown;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/** Object assertions are partial; array assertions compare the listed prefix by index. */
function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length <= actual.length && expected.every((value, index) => contains(actual[index], value));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && contains((actual as Record<string, unknown>)[key], value));
  }
  return stable(actual) === stable(expected);
}

function atPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

export function runExperienceScenario<State>(definition: ExperienceDefinition<State>, scenario: ExperienceScenario): ExperienceScenarioResult {
  let state: unknown;
  try { state = jsonCopy(definition.start(jsonCopy(scenario.args) as Record<string, unknown>)); }
  catch (error) { return { name: scenario.name, ok: false, steps: 0, failedStep: 0, message: `start: ${error instanceof Error ? error.message : String(error)}` }; }

  for (let index = 0; index < scenario.steps.length; index++) {
    const step = scenario.steps[index]!;
    try {
      state = jsonCopy(definition.update(state as State, jsonCopy(step.input) as ExperienceInput));
      const expect = step.expect;
      if (!expect) continue;
      if (expect.equals !== undefined && stable(state) !== stable(expect.equals)) return { name: scenario.name, ok: false, steps: index + 1, failedStep: index, message: `state が equals と一致しません。actual=${JSON.stringify(state)}` };
      if (expect.contains !== undefined && !contains(state, expect.contains)) return { name: scenario.name, ok: false, steps: index + 1, failedStep: index, message: `state が contains を満たしません。actual=${JSON.stringify(state)}` };
      for (const [path, expected] of Object.entries(expect.paths ?? {})) {
        const actual = atPath(state, path);
        if (!actual.found || stable(actual.value) !== stable(expected)) return { name: scenario.name, ok: false, steps: index + 1, failedStep: index, message: `state.${path} が期待値と一致しません。actual=${actual.found ? JSON.stringify(actual.value) : "<missing>"}` };
      }
    } catch (error) {
      return { name: scenario.name, ok: false, steps: index + 1, failedStep: index, message: error instanceof Error ? error.message : String(error) };
    }
  }
  return { name: scenario.name, ok: true, steps: scenario.steps.length };
}
