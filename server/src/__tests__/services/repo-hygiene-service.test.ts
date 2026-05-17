import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@veritas-kanban/shared';
import { ConfigService } from '../../services/config-service.js';
import { RepoHygieneService } from '../../services/repo-hygiene-service.js';

const execFile = promisify(execFileCallback);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd, timeout: 10_000 });
}

async function createCleanRepo(root: string): Promise<string> {
  const repoDir = path.join(root, 'repo');
  const remoteDir = path.join(root, 'remote.git');
  await fs.mkdir(repoDir, { recursive: true });
  await git(root, ['init', '--bare', remoteDir]);
  await git(repoDir, ['init', '-b', 'main']);
  await git(repoDir, ['config', 'user.email', 'veritas@example.test']);
  await git(repoDir, ['config', 'user.name', 'Veritas Test']);
  await fs.writeFile(path.join(repoDir, 'README.md'), '# Test\n', 'utf-8');
  await git(repoDir, ['add', 'README.md']);
  await git(repoDir, ['commit', '-m', 'initial']);
  await git(repoDir, ['remote', 'add', 'origin', remoteDir]);
  await git(repoDir, ['push', '-u', 'origin', 'main']);
  return repoDir;
}

describe('RepoHygieneService', () => {
  let tempDir: string;
  let configService: ConfigService;
  let service: RepoHygieneService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-repo-hygiene-'));
    const configDir = path.join(tempDir, '.veritas-kanban');
    configService = new ConfigService({
      configDir,
      configFile: path.join(configDir, 'config.json'),
    });
    service = new RepoHygieneService({
      configService,
      stateFile: path.join(configDir, 'repo-hygiene-state.json'),
    });
  });

  afterEach(async () => {
    configService.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function saveConfig(config: AppConfig): Promise<void> {
    await configService.saveConfig(config);
  }

  it('reports a clean configured repo as healthy and non-blocking', async () => {
    const repoDir = await createCleanRepo(tempDir);
    await saveConfig({
      repos: [{ name: 'clean-repo', path: repoDir, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'claude-code',
    });

    const state = await service.scanAll();

    expect(state.summary).toMatchObject({ healthy: true, blockingRepos: 0, totalRepos: 1 });
    expect(state.repos[0]).toMatchObject({
      repoName: 'clean-repo',
      healthy: true,
      blocking: false,
      branch: 'main',
      dirty: false,
      hasUpstream: true,
      ahead: 0,
      behind: 0,
    });
  });

  it('blocks completion for dirty critical repos by default', async () => {
    const repoDir = await createCleanRepo(tempDir);
    await fs.writeFile(path.join(repoDir, 'dirty.txt'), 'dirty\n', 'utf-8');
    await saveConfig({
      repos: [{ name: 'dirty-repo', path: repoDir, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'claude-code',
    });

    const state = await service.scanAll();

    expect(state.summary.healthy).toBe(false);
    expect(state.summary.blockingRepos).toBe(1);
    expect(state.repos[0].blocking).toBe(true);
    expect(state.repos[0].issues.map((issue) => issue.code)).toContain('DIRTY_WORKTREE');
  });

  it('downgrades dirty repo issues to warnings when enforceOnDone is disabled', async () => {
    const repoDir = await createCleanRepo(tempDir);
    await fs.writeFile(path.join(repoDir, 'dirty.txt'), 'dirty\n', 'utf-8');
    await saveConfig({
      repos: [
        {
          name: 'warning-repo',
          path: repoDir,
          defaultBranch: 'main',
          hygiene: { enforceOnDone: false },
        },
      ],
      agents: [],
      defaultAgent: 'claude-code',
    });

    const state = await service.scanAll();

    expect(state.summary).toMatchObject({ healthy: true, blockingRepos: 0, warningRepos: 1 });
    expect(state.repos[0].blocking).toBe(false);
    expect(state.repos[0].issues[0].severity).toBe('warning');
  });

  it('blocks missing repo paths', async () => {
    await saveConfig({
      repos: [{ name: 'missing-repo', path: path.join(tempDir, 'missing'), defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'claude-code',
    });

    const state = await service.scanAll();

    expect(state.summary.blockingRepos).toBe(1);
    expect(state.repos[0].issues.map((issue) => issue.code)).toContain('PATH_MISSING');
  });

  it('blocks active local work on protected branches unless explicitly allowed', async () => {
    const repoDir = await createCleanRepo(tempDir);
    await fs.writeFile(path.join(repoDir, 'local-change.txt'), 'local commit\n', 'utf-8');
    await git(repoDir, ['add', 'local-change.txt']);
    await git(repoDir, ['commit', '-m', 'local protected branch work']);
    await saveConfig({
      repos: [{ name: 'protected-repo', path: repoDir, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'claude-code',
    });

    const state = await service.scanAll();

    expect(state.summary.blockingRepos).toBe(1);
    expect(state.repos[0]).toMatchObject({
      branch: 'main',
      protectedBranch: true,
      ahead: 1,
      blocking: true,
    });
    expect(state.repos[0].issues.map((issue) => issue.code)).toContain(
      'PROTECTED_BRANCH_ACTIVE_WORK'
    );
  });
});
