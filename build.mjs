import { copyFile, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot, publicFiles, readPublicConfig } from "./hosting.mjs";

const config = await readPublicConfig();
if (config.state !== "ready") {
  throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the project URL and an sb_publishable_ key.");
}

const root = await realpath(fileURLToPath(projectRoot));
const output = join(root, "dist");
const staging = await mkdtemp(join(root, ".dist-build-"));

async function removeBuildDirectory(directory) {
  const info = await lstat(directory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;

  if (!info.isDirectory() || info.isSymbolicLink() || dirname(await realpath(directory)) !== root) {
    throw new Error("Build output must be a regular directory inside the project.");
  }
  await rm(directory, { recursive: true });
}

try {
  for (const [destination, [source]] of publicFiles) {
    const target = join(staging, destination.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(source, projectRoot), target);
  }
  await writeFile(join(staging, "config.json"), `${JSON.stringify(config)}\n`);
  await removeBuildDirectory(output);
  await rename(staging, output);
} finally {
  await removeBuildDirectory(staging);
}

console.log(`Built ${publicFiles.size + 1} public files in dist.`);
