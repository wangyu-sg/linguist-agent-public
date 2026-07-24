import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("power slider endpoint labels appear while the thumb is held or focused", async () => {
  const [component, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/ComposerPowerSlider.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(component, /const holding = previewIndex !== null \|\| thumbFocused/, "holding tracks pointer drag and keyboard focus");
  assert.match(component, /data-holding=\{holding \|\| undefined\}/, "the root exposes the holding state");
  assert.match(component, /composer-power-slider__endpoint composer-power-slider__endpoint--fast/, "fast endpoint label exists");
  assert.match(component, /composer-power-slider__endpoint composer-power-slider__endpoint--smart/, "smart endpoint label exists");
  assert.match(component, />更快</, "fast endpoint copy");
  assert.match(component, />更强</, "smart endpoint copy");
  assert.match(component, /onBlur=\{\(\) => setThumbFocused\(false\)\}/, "focus release clears the holding state");
  const endpointRule = /\.composer-power-slider__endpoint\s*\{(?<body>[\s\S]*?)\}/.exec(composer)?.groups?.body ?? "";
  for (const declaration of [/opacity:\s*0/, /transition:\s*opacity var\(--la-duration-micro\)/]) {
    assert.match(endpointRule, declaration, `endpoint keeps ${declaration}`);
  }
  assert.match(composer, /\.composer-power-slider\[data-holding="true"\] \.composer-power-slider__endpoint\s*\{[\s\S]*?opacity:\s*1/, "endpoints reveal while holding");
});

test("power slider spec geometry, keyboard map, and reset stay intact", async () => {
  const [component, composer, power] = await Promise.all([
    readFile(new URL("src/renderer/composer/ComposerPowerSlider.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer-power.ts", root), "utf8"),
  ]);
  assert.match(composer, /\.composer-power-slider__track\s*\{[\s\S]*?height:\s*24px[\s\S]*?border-radius:\s*12px/);
  assert.match(composer, /\.composer-power-slider__thumb\s*\{[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px/);
  assert.match(composer, /\.composer-power-slider__tick\s*\{[\s\S]*?width:\s*4px[\s\S]*?height:\s*4px/);
  assert.match(composer, /0\.3s var\(--la-ease-spring\)/);
  assert.match(component, /aria-valuetext=\{powerValueText\(index\)\}/);
  assert.match(power, /`\$\{thinkingLevelLabels\[powerLevelAt\(clamped\)\]\}, \$\{clamped \+ 1\} of \$\{COMPOSER_POWER_LEVELS\.length\}\.`/);
  assert.match(component, /className="composer-power-slider__reset"/);
});
