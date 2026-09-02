import { describe, it, expect } from 'vitest';
import { resist, attract, inertia, tokens } from './motion';
describe('drag geometry', () => {
  it('keeps the grab delta inside bounds and gives bounded, continuous resistance outside', () => {
    expect(resist(23, 0, 100)).toBe(23);
    expect(resist(100, 0, 100)).toBe(100);
    const points = [101, 120, 500, 100000].map((x) => resist(x, 0, 100));
    expect(
      points.every(
        (x) => x >= 100 && x <= 100 + tokens.physics.resistanceLimit,
      ),
    ).toBe(true);
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(resist(-100000, 0, 100)).toBeGreaterThanOrEqual(
      -tokens.physics.resistanceLimit,
    );
  });
  it('attracts only nearby positions without overshooting or a jump at the snap radius', () => {
    expect(attract(0, 30)).toBe(0);
    expect(attract(7, 10)).toBeGreaterThan(7);
    expect(attract(7, 10)).toBeLessThan(10);
    expect(attract(10, 10)).toBe(10);
    expect(attract(0, tokens.physics.snapRadius)).toBe(0);
    expect(attract(0, tokens.physics.snapRadius - 0.001)).toBeCloseTo(0, 2);
  });
  it('limits inertia in both directions, including high velocity input', () => {
    expect(inertia(0)).toBe(0);
    expect(inertia(10000)).toBe(tokens.physics.inertiaLimit);
    expect(inertia(-10000)).toBe(-tokens.physics.inertiaLimit);
  });
});
