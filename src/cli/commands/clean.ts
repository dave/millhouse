import ora from 'ora';
import {
  detectLeftoverState,
  cleanupAllState,
  displayLeftoverState,
} from '../cleanup.js';

export async function cleanCommand(): Promise<void> {
  const spinner = ora('Checking for leftover state...').start();

  const leftoverState = await detectLeftoverState();

  if (!leftoverState.hasLeftovers) {
    spinner.succeed('Nothing to clean up');
    return;
  }

  spinner.stop();
  displayLeftoverState(leftoverState);

  const cleanSpinner = ora('Cleaning up...').start();
  await cleanupAllState();
  cleanSpinner.succeed('Cleaned up all millhouse state');
}
