import fs from 'node:fs';
const tokens = JSON.parse(
  fs.readFileSync(
    new URL('../lib/motion-tokens.json', import.meta.url),
    'utf8',
  ),
);
// Sample the same damped springs used by Motion. CSS fallbacks use ease-enter.
function curve({ mass, stiffness, damping }) {
  let x = 0,
    velocity = 0;
  const samples = [0];
  for (let step = 1; step <= 360; step++) {
    velocity += (stiffness * (1 - x) - damping * velocity) / mass / 600;
    x += velocity / 600;
    if (step % 12 === 0) samples.push(Number(x.toFixed(4)));
  }
  samples[samples.length - 1] = 1;
  return `linear(${samples.join(', ')})`;
}
const rules = [];
for (const [name, value] of Object.entries(tokens.scale))
  rules.push(`--scale-${name}: ${value};`);
for (const [name, value] of Object.entries(tokens.distance))
  rules.push(`--distance-${name}: ${value}px;`);
for (const [name, value] of Object.entries(tokens.duration))
  rules.push(`--duration-${name}: ${value}ms;`);
for (const [name, value] of Object.entries(tokens.ease))
  rules.push(`--ease-${name}: cubic-bezier(${value.join(', ')});`);
for (const [name, value] of Object.entries(tokens.spring)) {
  rules.push(`--spring-${name}: ${curve(value)};`);
  for (const [prop, amount] of Object.entries(value))
    rules.push(`--spring-${name}-${prop}: ${amount};`);
}
for (const [name, value] of Object.entries(tokens.elevation))
  rules.push(`--elevation-${name}: ${value};`);
rules.push(
  `--hover-scale: ${tokens.scale.hover};`,
  `--press-scale: ${tokens.scale.press};`,
  `--drag-friction: ${tokens.physics.dragFriction};`,
  `--snap-strength: ${tokens.physics.snapStrength};`,
  `--spin-duration: ${tokens.timing.spin}ms;`,
  '--reduced-motion-duration: 0ms;',
);
const output = `/* Generated from lib/motion-tokens.json. Run npm run tokens after editing. */\n:root {\n  ${rules.join('\n  ')}\n}\n`;
const destination = new URL('../app/motion-tokens.css', import.meta.url);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(destination, 'utf8') !== output)
    throw new Error('Motion CSS is stale; run npm run tokens');
} else fs.writeFileSync(destination, output);
