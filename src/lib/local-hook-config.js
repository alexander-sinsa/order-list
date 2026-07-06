import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const configDir = path.join(process.cwd(), "data");
const configPath = path.join(configDir, "hook-config.json");

export async function readLocalHookConfig() {
  try {
    const rawConfig = await readFile(configPath, "utf8");
    return JSON.parse(rawConfig);
  } catch (err) {
    if (err.code === "ENOENT") {
      return {};
    }

    console.error("Failed to read local hook config:", err);
    return {};
  }
}

export async function saveLocalHookConfig(config) {
  const existingConfig = await readLocalHookConfig();
  const nextConfig = {
    ...existingConfig,
    ...config,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return nextConfig;
}
