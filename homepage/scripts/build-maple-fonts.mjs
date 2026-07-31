import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { collectMapleFontGlyphs } from "./maple-font-glyphs.mjs";

const mapleVersion = "7.9";
const archiveChecksum =
  "cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d";
const archiveURL = `https://github.com/subframe7536/maple-font/releases/download/v${mapleVersion}/MapleMono-CN.zip`;
const fontWeights = ["Regular", "SemiBold", "Bold"];
const fontFlavors = ["woff2", "woff"];
const homepageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDirectory = path.join(homepageDirectory, "src");
const outputDirectory = path.join(sourceDirectory, "assets/fonts/maple-mono");
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "maple-font-homepage-"),
);
const archivePath = path.join(temporaryDirectory, "MapleMono-CN.zip");
const extractedDirectory = path.join(temporaryDirectory, "extracted");
const glyphsPath = path.join(outputDirectory, "glyphs.txt");

try {
  await mkdir(extractedDirectory);
  await mkdir(outputDirectory, { recursive: true });

  if (process.env.MAPLE_FONT_ARCHIVE) {
    await copyFile(process.env.MAPLE_FONT_ARCHIVE, archivePath);
  } else {
    console.log(`下载 ${archiveURL}`);
    run("curl", [
      "-fL",
      "--http1.1",
      "--continue-at",
      "-",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "30",
      archiveURL,
      "-o",
      archivePath,
    ]);
  }

  const checksum = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  if (checksum !== archiveChecksum) {
    throw new Error(`Maple Mono CN 校验失败：${checksum}`);
  }

  run("unzip", [
    "-jo",
    archivePath,
    ...fontWeights.map((weight) => `MapleMono-CN-${weight}.ttf`),
    "LICENSE.txt",
    "-d",
    extractedDirectory,
  ]);

  const glyphs = await collectMapleFontGlyphs(sourceDirectory);
  await writeFile(glyphsPath, glyphs, "utf8");
  await copyFile(
    path.join(extractedDirectory, "LICENSE.txt"),
    path.join(outputDirectory, "LICENSE.txt"),
  );

  for (const weight of fontWeights) {
    const inputPath = path.join(
      extractedDirectory,
      `MapleMono-CN-${weight}.ttf`,
    );

    for (const flavor of fontFlavors) {
      run("pyftsubset", [
        inputPath,
        `--output-file=${path.join(outputDirectory, fontFileName(weight, flavor))}`,
        `--flavor=${flavor}`,
        `--text-file=${glyphsPath}`,
        "--unicodes=U+0000-00FF",
        "--layout-features=*",
        "--glyph-names",
        "--symbol-cmap",
        "--legacy-cmap",
        "--notdef-glyph",
        "--notdef-outline",
        "--recommended-glyphs",
        "--name-IDs=*",
        "--name-legacy",
        "--name-languages=*",
        "--no-hinting",
      ]);
    }
  }

  const fontHashes = {};
  for (const weight of fontWeights) {
    for (const flavor of fontFlavors) {
      const fileName = fontFileName(weight, flavor);
      fontHashes[fileName] = await sha256(path.join(outputDirectory, fileName));
    }
  }
  await writeFile(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        archiveSha256: archiveChecksum,
        files: fontHashes,
        glyphsSha256: sha256Content(glyphs),
        version: mapleVersion,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `Maple Mono CN v${mapleVersion} 已生成，共 ${[...glyphs].length} 个字符。`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function fontFileName(weight, flavor) {
  return `maple-mono-cn-${weight.toLowerCase()}-v${mapleVersion}.${flavor}`;
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function sha256Content(content) {
  return createHash("sha256").update(content).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败，退出码 ${result.status}`);
  }
}
