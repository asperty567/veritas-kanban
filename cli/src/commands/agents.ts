import { Command } from 'commander';
import chalk from 'chalk';
import { api, createApiClient } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import type { Task } from '../utils/types.js';

export function registerAgentCommands(program: Command): void {
  // Start agent on task
  program
    .command('start <id>')
    .description('Start an agent on a task')
    .option(
      '-a, --agent <agent>',
      'Agent to use (claude-code, amp, copilot, gemini)',
      'claude-code'
    )
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        if (task.type !== 'code') {
          console.error(chalk.red('Can only start agents on code tasks'));
          process.exit(1);
        }

        if (!task.git?.worktreePath) {
          console.error(chalk.red('Task needs a worktree first. Create one via the UI.'));
          process.exit(1);
        }

        const result = await api<{ attemptId: string }>(`/api/agents/${task.id}/start`, {
          method: 'POST',
          body: JSON.stringify({ agent: options.agent }),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Agent started: ${options.agent}`));
          console.log(chalk.dim(`Attempt ID: ${result.attemptId}`));
          console.log(chalk.dim(`Working in: ${task.git.worktreePath}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Stop agent
  program
    .command('stop <id>')
    .description('Stop a running agent')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        await api(`/api/agents/${task.id}/stop`, { method: 'POST' });

        if (options.json) {
          console.log(JSON.stringify({ stopped: true }));
        } else {
          console.log(chalk.yellow('✓ Agent stopped'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Legacy pending/request-file dispatcher retired. Veritas runnable/claim APIs are the only queue.
  program
    .command('agents:pending')
    .description('Retired: request-file pending queue is disabled')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const payload = {
        ok: false,
        retired: true,
        sourceOfTruth: 'veritas-runnable-claim',
        controlPlane: 'hermes-agent',
        error:
          'agents:pending is retired. Use Veritas runnable/claim APIs and HermesAgent /v1/runs; do not poll /api/agents/pending.',
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.error(chalk.red(payload.error));
      }
      process.exitCode = 1;
    });

  program
    .command('agents:dispatch')
    .description('Retired: CLI request-file dispatcher is disabled')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const payload = {
        ok: false,
        retired: true,
        sourceOfTruth: 'veritas-runnable-claim',
        controlPlane: 'hermes-agent',
        error:
          'agents:dispatch is retired. Dispatch must claim runnable Veritas tasks and start HermesAgent /v1/runs; local files/automation queues are disabled.',
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.error(chalk.red(payload.error));
      }
      process.exitCode = 1;
    });

  // Complete an agent request (called by Hermes after sub-agent finishes)
  program
    .command('agents:complete <taskId>')
    .description('Mark an agent request as complete')
    .option('-s, --success', 'Mark as successful (default)')
    .option('-f, --failed', 'Mark as failed')
    .option('-m, --summary <text>', 'Summary of what was done')
    .option('-e, --error <text>', 'Error message (if failed)')
    .action(async (taskId, options) => {
      try {
        const success = !options.failed;
        const body = {
          success,
          summary: options.summary,
          error: options.error,
        };

        await api(`/api/agents/${taskId}/complete`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (success) {
          console.log(chalk.green(`✓ Task ${taskId} marked as complete`));
        } else {
          console.log(chalk.yellow(`⚠ Task ${taskId} marked as failed`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Get agent status for a task
  program
    .command('agents:status <taskId>')
    .description('Get agent status for a task')
    .option('--json', 'Output as JSON')
    .action(async (taskId, options) => {
      try {
        const status = await api<{
          running: boolean;
          taskId?: string;
          attemptId?: string;
          agent?: string;
          status?: string;
          startedAt?: string;
        }>(`/api/agents/${taskId}/status`);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else if (!status.running) {
          console.log(chalk.dim('No agent running for this task'));
        } else {
          console.log(chalk.yellow(`🤖 Agent Running`));
          console.log(`  Task: ${status.taskId}`);
          console.log(`  Attempt: ${status.attemptId}`);
          console.log(`  Agent: ${status.agent}`);
          console.log(
            `  Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : 'unknown'}`
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
