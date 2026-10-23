import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = fs.readdirSync(path.join(root, "docs")).filter(name => /\.(md|html)$/.test(name)).map(name => `docs/${name}`);
const files = ["README.md", "README.en.md", "CHANGELOG.md", "CONTRIBUTING.md", "UPSTREAM.md", ...docs];
let count = 0;
const errors = [];
for (const file of files) {
  const body = fs.readFileSync(path.join(root, file), "utf8");
  const links = file.endsWith(".html")
    ? [...body.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1])
    : [...body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
  for (const link of links) {
    if (/^(?:https?:|mailto:|data:)/.test(link)) continue;
    const [relative, fragment] = link.split("#");
    const target = relative ? path.resolve(root, path.dirname(file), decodeURIComponent(relative)) : path.join(root, file);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) {
      errors.push(`${file}: missing or invalid local link ${link}`);
      continue;
    }
    if (file.endsWith(".html") && fragment && !relative && !body.includes(`id="${fragment}"`)) errors.push(`${file}: missing anchor ${link}`);
    count++;
  }
}
const guide = fs.readFileSync(path.join(root, "docs/index.html"), "utf8");
if (!guide.includes('id="guide-language"') || !guide.includes('id="guide-i18n"')) errors.push("Missing Chinese/English guide switch or language catalog");
for (const mode of ["split", "contrast", "selection", "input"]) {
  if (!guide.includes(`aria-controls="mode-${mode}"`) || !guide.includes(`id="mode-${mode}"`)) errors.push(`missing accessible demo panel ${mode}`);
}
if (/<script\b[^>]+src="https?:/i.test(guide) || /<link\b(?=[^>]*rel="stylesheet")[^>]+href="https?:/i.test(guide)) errors.push("The downloadable guide must not depend on remote scripts or styles");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: ${files.length} current documents, ${count} local links and four accessible demo modes`);
