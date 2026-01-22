import chalk from 'chalk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SetupOptions {
  global?: boolean;
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  try {
    // Find the commands directory in the package
    const packageRoot = path.resolve(__dirname, '..', '..', '..');
    const sourceDir = path.join(packageRoot, 'commands');

    // Determine target directory
    const targetDir = options.global
      ? path.join(os.homedir(), '.claude', 'commands')
      : path.join(process.cwd(), '.claude', 'commands');

    // Check if source directory exists
    try {
      await fs.access(sourceDir);
    } catch {
      console.error(chalk.red(`Commands directory not found: ${sourceDir}`));
      process.exit(1);
    }

    // Create target directory if needed
    await fs.mkdir(targetDir, { recursive: true });

    // Copy all command files
    const files = await fs.readdir(sourceDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      console.log(chalk.yellow('No command files found to install.'));
      return;
    }

    let installed = 0;
    for (const file of mdFiles) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      // Check if file already exists
      try {
        await fs.access(targetPath);
        console.log(chalk.yellow(`  Skipping ${file} (already exists)`));
        continue;
      } catch {
        // File doesn't exist, proceed with copy
      }

      await fs.copyFile(sourcePath, targetPath);
      console.log(chalk.green(`  Installed ${file}`));
      installed++;
    }

    const location = options.global ? 'globally' : `in ${targetDir}`;
    if (installed > 0) {
      console.log(chalk.green(`\n✓ Installed ${installed} command(s) ${location}`));
    } else {
      console.log(chalk.yellow(`\nNo new commands to install ${location}`));
    }

    console.log(`
${chalk.bold('Slash commands (in Claude Code):')}
  /millhouse plan [file]       Refine a plan (omit file to use current plan)
  /millhouse issues [file]     Create GitHub issues (omit file to use current plan)

${chalk.bold('Then run from terminal:')}
  millhouse run [file]         Execute plan (omit file to use latest plan)
  millhouse run issues [N]     Execute GitHub issues (omit N to run all)
  millhouse status             Show run status
`);
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}
