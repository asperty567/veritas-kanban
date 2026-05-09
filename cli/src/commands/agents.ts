import { Command } from 'commander';
import chalk from 'chalk';
import { api, createApiClient } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import type { Task } from '../utils/types.js';
import { DEFAULT_VERITAS_API_BASE, dispatchPendingToHermes } from './hermes-dispatcher.js';

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

  // Get pending agent requests (for Veritas to process)
  program
    .command('agents:pending')
    .description('List pending agent requests waiting for Hermes to process')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const pending = await api<
          {
            taskId: string;
            attemptId: string;
            prompt: string;
            requestedAt: string;
            callbackUrl: string;
          }[]
        >('/api/agents/pending');

        if (options.json) {
          console.log(JSON.stringify(pending, null, 2));
        } else if (pending.length === 0) {
          console.log(chalk.dim('No pending agent requests'));
        } else {
          console.log(chalk.bold(`\n🤖 ${pending.length} Pending Agent Request(s)\n`));

          pending.forEach(
            (req: {
              taskId: string;
              attemptId: string;
              prompt: string;
              requestedAt: string;
              callbackUrl: string;
            }) => {
              console.log(chalk.cyan(`Task: ${req.taskId}`));
              console.log(chalk.dim(`  Attempt: ${req.attemptId}`));
              console.log(chalk.dim(`  Requested: ${new Date(req.requestedAt).toLocaleString()}`));
              console.log(chalk.dim(`  Callback: ${req.callbackUrl}`));
              console.log();

              // Print first few lines of prompt
              const promptLines = req.prompt.split('\n').slice(0, 10);
              console.log(chalk.dim('─'.repeat(50)));
              promptLines.forEach((line: string) => console.log(chalk.dim(`  ${line}`)));
              if (req.prompt.split('\n').length > 10) {
                console.log(chalk.dim('  ...'));
              }
              console.log(chalk.dim('─'.repeat(50)));
              console.log();
            }
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Dispatch pending agent requests through HermesAgent CLI sessions
  program
    .command('agents:dispatch')
    .description('Dispatch pending Veritas agent requests through Hermes CLI')
    .option('--source <source>', 'api, files, automation, or all', 'api')
    .option(
      '--requests-dir <path>',
      'Directory containing .veritas-kanban agent request JSON files'
    )
    .option('--hermes <command>', 'Hermes CLI command/path', 'hermes')
    .option('--toolsets <toolsets>', 'Comma-separated Hermes toolsets', 'terminal,file,web')
    .option('--provider <provider>', 'Hermes inference provider', 'openai-codex')
    .option('--model <model>', 'Hermes inference model', 'gpt-5.5')
    .option(
      '--api-base <url>',
      'Veritas API base URL',
      process.env.VK_API_URL || DEFAULT_VERITAS_API_BASE
    )
    .option('--limit <n>', 'Maximum requests to dispatch', (value) => Number.parseInt(value, 10))
    .option('--timeout-ms <n>', 'Per-session timeout in milliseconds', (value) =>
      Number.parseInt(value, 10)
    )
    .option('--dry-run', 'List dispatchable requests and append no completion callback')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        if (!['api', 'files', 'automation', 'all'].includes(options.source)) {
          console.error(chalk.red('Error: --source must be api, files, automation, or all'));
          process.exit(1);
        }

        const apiBase = options.apiBase || process.env.VK_API_URL || DEFAULT_VERITAS_API_BASE;
        const results = await dispatchPendingToHermes(createApiClient(apiBase), {
          source: options.source,
          requestsDir: options.requestsDir,
          hermesCommand: options.hermes,
          toolsets: options.toolsets,
          provider: options.provider,
          model: options.model,
          limit: options.limit,
          timeoutMs: options.timeoutMs,
          dryRun: Boolean(options.dryRun),
          apiBase,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          console.log(chalk.dim('No dispatchable Hermes agent requests'));
        } else {
          console.log(chalk.bold(`\n🤖 Hermes Dispatch Result(s): ${results.length}\n`));
          for (const result of results) {
            const color =
              result.status === 'complete'
                ? chalk.green
                : result.status === 'failed'
                  ? chalk.red
                  : chalk.yellow;
            console.log(
              color(`${result.status.toUpperCase()}: ${result.taskId} (${result.attemptId})`)
            );
            if (result.summary) console.log(chalk.dim(`  ${result.summary.split('\n')[0]}`));
            if (result.error) console.log(chalk.dim(`  ${result.error.split('\n')[0]}`));
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
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
