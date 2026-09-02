import tokens from './motion-tokens.json';
import type { Transition } from 'motion/react';
export { tokens };
export type Weight = keyof typeof tokens.spring;
export const spring = (weight: Weight): Transition => ({
  type: 'spring',
  ...tokens.spring[weight],
});
export const tween = (
  speed: keyof typeof tokens.duration = 'normal',
  phase: keyof typeof tokens.ease = 'standard',
): Transition => ({
  type: 'tween',
  duration: tokens.duration[speed] / 1000,
  ease: tokens.ease[phase] as [number, number, number, number],
});
export const cssEase = (phase: keyof typeof tokens.ease = 'standard') =>
  `cubic-bezier(${tokens.ease[phase].join(',')})`;
/** Rubber-band resistance never crosses more than resistanceLimit beyond a boundary. */
export function resist(value: number, min: number, max: number) {
  const bound = Math.min(max, Math.max(min, value));
  const extra = value - bound;
  return (
    bound +
    Math.sign(extra) *
      tokens.physics.resistanceLimit *
      (1 -
        Math.exp(
          (-Math.abs(extra) * tokens.physics.elasticity) /
            tokens.physics.resistanceLimit,
        ))
  );
}
export function attract(value: number, target: number) {
  const distance = target - value;
  return Math.abs(distance) < tokens.physics.snapRadius
    ? value +
        distance *
          tokens.physics.snapStrength *
          (1 - Math.abs(distance) / tokens.physics.snapRadius)
    : value;
}
/** A bounded settling tail, never used to change the selected drop target. */
export function inertia(velocity: number) {
  return Math.max(
    -tokens.physics.inertiaLimit,
    Math.min(
      tokens.physics.inertiaLimit,
      velocity * (1 - tokens.physics.dragFriction),
    ),
  );
}
