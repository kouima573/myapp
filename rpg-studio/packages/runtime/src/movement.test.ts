import { describe, expect, it } from "vitest";
import { directionFromKey, GridMovementAnimator, interpolateGridPosition } from "./movement";

describe("DQ-style grid movement presentation", () => {
  it("maps arrows and WASD to four cardinal directions", () => {
    expect(directionFromKey("ArrowUp")).toBe("up");
    expect(directionFromKey("W")).toBe("up");
    expect(directionFromKey("a")).toBe("left");
    expect(directionFromKey(" ")).toBeNull();
  });

  it("interpolates between tile centers and snaps to source pixels", () => {
    expect(interpolateGridPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0.5)).toEqual({ x: 2.5, y: 3 });
    expect(interpolateGridPosition({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.2)).toEqual({ x: 0.1875, y: 0 });
    expect(interpolateGridPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 2)).toEqual({ x: 3, y: 3 });
  });

  it("finishes the current cell before turning, so a corner is not cut diagonally", () => {
    const animator = new GridMovementAnimator({ x: 0, y: 0 }, 100);
    animator.enqueue({ x: 1, y: 0 });
    expect(animator.update(0)).toEqual({ position: { x: 0, y: 0 }, moving: true });
    expect(animator.update(50)).toEqual({ position: { x: 0.5, y: 0 }, moving: true });

    animator.enqueue({ x: 1, y: 1 });
    expect(animator.update(100)).toEqual({ position: { x: 1, y: 0 }, moving: true });
    expect(animator.update(150)).toEqual({ position: { x: 1, y: 0.5 }, moving: true });
    expect(animator.update(200)).toEqual({ position: { x: 1, y: 1 }, moving: false });
  });

  it("resets on a map change and never skips queued cells after a delayed frame", () => {
    const animator = new GridMovementAnimator({ x: 0, y: 0 }, 100);
    animator.enqueue({ x: 1, y: 0 });
    animator.enqueue({ x: 2, y: 0 });
    expect(animator.update(0).moving).toBe(true);
    expect(animator.update(500)).toEqual({ position: { x: 1, y: 0 }, moving: true });
    expect(animator.update(550)).toEqual({ position: { x: 1.5, y: 0 }, moving: true });
    expect(animator.update(600)).toEqual({ position: { x: 2, y: 0 }, moving: false });

    animator.enqueue({ x: 3, y: 0 });
    animator.reset({ x: 8, y: 6 });
    expect(animator.currentPosition).toEqual({ x: 8, y: 6 });
    expect(animator.update(600)).toEqual({ position: { x: 8, y: 6 }, moving: false });
  });
});
