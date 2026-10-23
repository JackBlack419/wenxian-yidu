import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const built = path.join(root, ".scaffold/build");
const manifest = JSON.parse(fs.readFileSync(path.join(built, "addon/manifest.json"), "utf8"));
if (manifest.version !== pkg.version || manifest.applications.zotero.id !== pkg.config.addonID) throw new Error("Build the current version before packaging");
const xpiName = `wenxianyidu-${pkg.version}.xpi`;
const xpi = fs.readFileSync(path.join(built, `${pkg.config.addonName}.xpi`));
fs.writeFileSync(path.join(dist, xpiName), xpi);
let guide = fs.readFileSync(path.join(root, "docs/index.html"), "utf8");
const site = new JSZip();
site.file("index.html", guide);
for (const name of fs.readdirSync(path.join(root, "docs/images"))) {
  if (name.endsWith(".png")) site.file(`images/${name}`, fs.readFileSync(path.join(root, "docs/images", name)));
}
for (const name of ["robots.txt", "sitemap.xml", ".nojekyll"]) site.file(name, fs.readFileSync(path.join(root, "docs", name)));
site.file("使用说明.txt", "双击index.html即可本地打开；也可把此目录全部上传至静态网站。无需Node或构建。\nGitHub Pages已托管同一演示：https://jackblack419.github.io/wenxian-yidu/\n如更换主要托管域名，请同步修改HTML中的canonical链接和sitemap.xml中的网址。\n");
fs.writeFileSync(path.join(dist, "wenxianyidu-guide.zip"), await site.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
guide = guide.replace(/(src|href)="(images\/[^"?#]+\.png)"/g, (_, attribute, relative) => {
  const image = fs.readFileSync(path.join(root, "docs", relative));
  return `${attribute}="data:image/png;base64,${image.toString("base64")}"`;
});
if (/(?:src|href)="images\//.test(guide)) throw new Error("Unembedded screenshot in standalone guide");
fs.writeFileSync(path.join(dist, "wenxianyidu-guide.html"), guide);
const download = `https://github.com/JackBlack419/wenxian-yidu/releases/download/v${pkg.version}/${xpiName}`;
const updates = { addons: { [pkg.config.addonID]: { updates: [{ version: pkg.version, update_link: download,
  applications: { zotero: { strict_min_version: "10.0", strict_max_version: "10.*" } } }] } } };
fs.writeFileSync(path.join(dist, "updates.json"), JSON.stringify(updates, null, 2) + "\n");
const assets = [xpiName, "wenxianyidu-guide.html", "wenxianyidu-guide.zip", "updates.json"];
const sums = assets.map(name => `${createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex")}  ${name}`);
fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`Prepared ${pkg.version}: ${xpi.length} bytes (${(xpi.length / 1e6).toFixed(2)} MB), self-contained HTML, website ZIP, update feed and SHA-256`);
