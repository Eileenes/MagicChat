import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { collectMapleFontGlyphs } from "./maple-font-glyphs.mjs";

const homepageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDirectory = path.join(homepageDirectory, "src");
const fontDirectory = path.join(sourceDirectory, "assets/fonts/maple-mono");
const glyphsPath = path.join(fontDirectory, "glyphs.txt");
const manifest = JSON.parse(
  await readFile(path.join(fontDirectory, "manifest.json"), "utf8"),
);

const expected = await collectMapleFontGlyphs(sourceDirectory);
const committed = await readFile(glyphsPath, "utf8");

const expectedCharacters = new Set(expected);
const committedCharacters = new Set(committed);
const missing = [...expectedCharacters].filter(
  (character) => !committedCharacters.has(character),
);

if (missing.length > 0) {
  console.error("Maple Mono CN 字体子集缺少官网文案字符。");
  console.error(`缺少字符：${formatCharacters(missing)}`);
  console.error("请运行 npm run fonts:build 重新生成字体。");
  process.exit(1);
}

if (manifest.glyphsSha256 !== sha256Content(committed)) {
  console.error("Maple Mono CN 字符清单与生成清单不一致。");
  process.exit(1);
}

for (const [fileName, expectedHash] of Object.entries(manifest.files)) {
  const actualHash = await sha256(path.join(fontDirectory, fileName));
  if (actualHash !== expectedHash) {
    console.error(`Maple Mono CN 字体文件校验失败：${fileName}`);
    process.exit(1);
  }
}

console.log(
  `Maple Mono CN v${manifest.version} 字体子集覆盖 ${[...expected].length} 个字符，文件校验通过。`,
);

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function sha256Content(content) {
  return createHash("sha256").update(content).digest("hex");
}

function formatCharacters(characters) {
  return characters
    .slice(0, 40)
    .map((character) =>
      character.trim()
        ? character
        : `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
    )
    .join(" ");
}
