import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templateCache = new Map<string, string>();

/**
 * Load a prompt template from the templates directory.
 * Caches templates after first load.
 */
export async function loadTemplate(templateName: string): Promise<string> {
  // Check cache first
  const cached = templateCache.get(templateName);
  if (cached) {
    return cached;
  }

  // Try to load from templates directory
  const templatePaths = [
    path.join(process.cwd(), 'prompts', templateName),
    path.join(__dirname, '..', '..', 'prompts', templateName),
  ];

  for (const templatePath of templatePaths) {
    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      templateCache.set(templateName, content);
      return content;
    } catch {
      // Try next path
    }
  }

  throw new Error(
    `Could not find template: ${templateName}. Searched: ${templatePaths.join(', ')}`
  );
}
