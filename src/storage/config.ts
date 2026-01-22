import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigSchema, type Config } from '../types.js';

const CONFIG_FILES = ['.millhouserc.json', '.millhouserc', 'millhouse.config.json'];

export async function loadConfig(basePath: string = process.cwd()): Promise<Config> {
  // Try each config file name
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(basePath, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return ConfigSchema.parse(parsed);
    } catch {
      // Try next file
    }
  }

  // Return defaults if no config file found
  return ConfigSchema.parse({});
}

export async function saveConfig(config: Config, basePath: string = process.cwd()): Promise<void> {
  const filePath = path.join(basePath, CONFIG_FILES[0]);
  await fs.writeFile(filePath, JSON.stringify(config, null, 2));
}
