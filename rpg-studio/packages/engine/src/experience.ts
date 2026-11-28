/**
 * A project-wide, scene-first game contract.
 *
 * Unlike GameSystem, an Experience does not receive an RPG GameContent or GameState. Its creator
 * owns the entire game state, input vocabulary, presentation, and ending. Keep start/update pure
 * and store JSON-serializable state so a future save or deterministic replay can inspect it.
 */
export type ExperienceInput =
  | { type: "key"; key: string }
  | { type: "custom"; value: unknown }
  | { type: "frame"; held: string[] };

export interface ExperienceView<State = unknown> {
  state: State;
  send(input: ExperienceInput): void;
  reset(): void;
  save(): boolean;
  assetUrl(id: string): string | undefined;
}

export interface ExperienceDefinition<State = unknown> {
  /** Stable project ID; must match experience.json. */
  id: string;
  /** Increment when the saved state shape changes incompatibly. */
  version: number;
  /** Optional label for browser metadata and accessibility. The game draws its own title screen. */
  title?: string;
  /** Fixed simulation frequency. The runtime supplies frame inputs; it never supplies wall-clock time. */
  fps?: number;
  /** Initial state. Keep it JSON-serializable if saving is enabled. */
  start(args: Record<string, unknown>): State;
  /** Deterministic state transition. The experience decides what counts as progress or completion. */
  update(state: State, input: ExperienceInput): State;
  /** The experience owns the full screen; there is no injected map, player, HUD, or menu. */
  render(host: HTMLElement, view: ExperienceView<State>): void;
  /** Optional argument checks used by validate/build. */
  checkArgs?(args: Record<string, unknown>): string[];
}

export function defineExperience<State = unknown, T extends ExperienceDefinition<State> = ExperienceDefinition<State>>(experience: T): T {
  return experience;
}
