import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the track carries a gear-graded fill that follows the thumb", async () => {
  const [component, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/ComposerPowerSlider.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(component, /data-index=\{index\}/, "the root exposes the current gear");
  assert.match(component, /className="composer-power-slider__fill"/, "the fill layer renders");
  assert.match(component, /width: `calc\(14px \+ \(100% - 28px\) \* \$\{index \/ \(total - 1\)\}\)`/, "the fill follows the thumb geometry");
  const fillRule = /\.composer-power-slider__fill\s*\{(?<body>[\s\S]*?)\}/.exec(composer)?.groups?.body ?? "";
  for (const declaration of [
    /border-radius:\s*12px/,
    /linear-gradient\(90deg, var\(--la-accent\)/,
    /transition:\s*width 0\.3s var\(--la-ease-spring\)/,
  ]) {
    assert.match(fillRule, declaration, `fill keeps ${declaration}`);
  }
});

test("committing a gear fires a 12-particle burst with the spec curve", async () => {
  const [component, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/ComposerPowerSlider.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(component, /const BURST_PARTICLES/, "burst particles are deterministic constants");
  assert.match(component, /className="composer-power-slider__burst"/, "the burst renders on commit");
  assert.match(component, /BURST_PARTICLES\.length === 12|BURST_PARTICLES\.map/ && /12 个|--particle-x/, "burst carries per-particle offsets");
  assert.match(composer, /@keyframes la-particle-burst\s*\{[\s\S]*?22%\s*\{[\s\S]*?scale\(1\.28\)/, "burst overshoots at 22%");
  assert.match(composer, /animation:\s*la-particle-burst \.62s cubic-bezier\(\.25, 1, \.5, 1\) both/, "burst keeps the spec .62s curve");
});

test("ambient track particles stream only at the max gear", async () => {
  const [component, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/ComposerPowerSlider.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(component, /index === total - 1 && !disabled/, "ambient particles require the max gear");
  assert.match(component, /className="composer-power-slider__track-particle"/, "ambient particles render");
  const particleRule = /\.composer-power-slider__track-particle\s*\{(?<body>[\s\S]*?)\}/.exec(composer)?.groups?.body ?? "";
  for (const declaration of [/width:\s*3px/, /height:\s*3px/, /box-shadow:\s*0 0 5px/]) {
    assert.match(particleRule, declaration, `track particle keeps ${declaration}`);
  }
  assert.match(composer, /@keyframes la-track-particle-travel\s*\{[\s\S]*?8%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?92%\s*\{[\s\S]*?opacity:\s*1/, "particles fade in and out along the travel");
  assert.match(composer, /\.composer-power-slider__track-particle\s*\{[\s\S]*?animation:\s*la-track-particle-travel linear infinite|animation:\s*la-track-particle-travel[\s\S]*?linear infinite/, "travel loops linearly");
});
