import type { Direction } from "../../schema/src/formats";

export interface Point { x: number; y: number }

export const WALK_STEP_INTERVAL_MS = 145;
export const WALK_ANIMATION_MS = 140;
export const MOVEMENT_TILE_SIZE = 32;

export interface GridMovementFrame {
  position: Point;
  moving: boolean;
}

interface MovementTween {
  from: Point;
  to: Point;
  startedAt: number;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
};

export function directionFromKey(key: string): Direction | null {
  return KEY_DIRECTIONS[key.toLowerCase()] ?? null;
}

export function interpolateGridPosition(from: Point, to: Point, progress: number, tileSize = MOVEMENT_TILE_SIZE): Point {
  const t = Math.max(0, Math.min(1, progress));
  const safeTileSize = Math.max(1, tileSize);
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return {
    x: Math.round(x * safeTileSize) / safeTileSize,
    y: Math.round(y * safeTileSize) / safeTileSize,
  };
}

/** Keeps collision on the integer tile grid while rendering each accepted step as a pixel-snapped tween. */
export class GridMovementAnimator {
  private position: Point;
  private readonly queue: Point[] = [];
  private tween: MovementTween | null = null;

  constructor(start: Point, private readonly durationMs = WALK_ANIMATION_MS, private readonly tileSize = MOVEMENT_TILE_SIZE) {
    this.position = { ...start };
  }

  get currentPosition(): Point {
    return { ...this.position };
  }

  reset(position: Point): void {
    this.position = { ...position };
    this.queue.length = 0;
    this.tween = null;
  }

  enqueue(target: Point): void {
    const last = this.queue[this.queue.length - 1] ?? this.tween?.to ?? this.position;
    if (last.x === target.x && last.y === target.y) return;
    this.queue.push({ ...target });
  }

  update(now: number, speed = 1): GridMovementFrame {
    this.beginNext(now);
    if (!this.tween) return { position: { ...this.position }, moving: false };
    const active = this.tween;
    const dur = this.durationMs / Math.max(0.5, speed);
    const progress = dur <= 0 ? 1 : Math.max(0, Math.min(1, (now - active.startedAt) / dur));
    if (progress < 1) {
      this.position = interpolateGridPosition(active.from, active.to, progress, this.tileSize);
      return { position: { ...this.position }, moving: true };
    }
    this.position = { ...active.to };
    this.tween = null;
    this.beginNext(now);
    return { position: { ...this.position }, moving: this.tween !== null };
  }

  private beginNext(startedAt: number): void {
    while (!this.tween && this.queue.length) {
      const target = this.queue.shift()!;
      if (target.x === this.position.x && target.y === this.position.y) continue;
      this.tween = { from: { ...this.position }, to: target, startedAt };
    }
  }
}
