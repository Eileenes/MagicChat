import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceExtensions = new Set([".astro", ".css", ".ts"]);
const supplementalCharacters =
  "\u00a0\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u3000\u3001\u3002\u300a\u300b\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f";

export async function collectMapleFontGlyphs(sourceDirectory) {
  let content = supplementalCharacters;

  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collect(entryPath);
      } else if (sourceExtensions.has(path.extname(entry.name))) {
        content += await readFile(entryPath, "utf8");
      }
    }
  }

  await collect(sourceDirectory);
  return [...new Set(content.normalize("NFC"))].sort().join("");
}
