#!/usr/bin/env node
/** Print the current version's maintained CHANGELOG section for releases. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
const text = readFileSync(changelogPath, "utf8");

const heading = `## [${version}]`;
const start = text.indexOf(heading);
if (start === -1) {
  console.error(`release-notes: CHANGELOG.md has no section for version ${version}`);
  process.exit(1);
}

const rest = text.slice(text.indexOf("\n", start) + 1);
let end = rest.search(/^## \[/m);
const linkDefs = rest.search(/^\[\d+\.\d+\.[^\]]*\]:\s*http/m);
if (linkDefs !== -1 && (end === -1 || linkDefs < end)) {
  end = linkDefs;
}
const section = (end === -1 ? rest : rest.slice(0, end)).trim();

if (!section) {
  console.error(`release-notes: CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}
console.log(section);
