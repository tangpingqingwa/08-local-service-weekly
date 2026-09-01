import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the shared layout renders one exact maker contact footer", () => {
  assert.equal((layoutSource.match(/data-maker-contact/g) ?? []).length, 1);
  assert.match(
    layoutSource,
    /\{children\}[\s\S]*?<footer className="maker-footer" data-maker-contact="">[\s\S]*?<span>Built by <\/span>[\s\S]*?<a href="mailto:tangpingqingwa@gmail\.com">tangpingqingwa@gmail\.com<\/a>[\s\S]*?<\/footer>/,
  );
});

test("maker footer keeps the paper rule, accent link, focus, and narrow-screen fit", () => {
  assert.match(cssSource, /\.maker-footer\s*\{/);
  assert.match(cssSource, /\.maker-footer\s*\{[\s\S]*?border-top:\s*1px dashed var\(--rule-soft\)/);
  assert.match(cssSource, /\.maker-footer\s*\{[\s\S]*?color:\s*var\(--muted\)/);
  assert.match(cssSource, /\.maker-footer\s*\{[\s\S]*?text-align:\s*center/);
  assert.match(cssSource, /\.maker-footer a\s*\{[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(cssSource, /\.maker-footer a:hover\s*\{[\s\S]*?color:\s*var\(--ink\)/);
  assert.match(cssSource, /\.maker-footer a:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\)/);
  assert.match(cssSource, /\.maker-footer a\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(
    cssSource,
    /@media \(max-width: 700px\)[\s\S]*?\.maker-footer\s*\{[\s\S]*?font-size:\s*0\.72rem/,
  );
});
