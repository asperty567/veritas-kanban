import fs from 'fs/promises';
import path from 'path';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import type {
  RepoConfig,
  RepoHygieneIssue,
  RepoHygienePolicy,
  RepoHygieneRepoStatus,
  RepoHygieneState,
} from '@veritas-kanban/shared';
import { getRuntimeDir } from '../utils/paths.js';
import { ConfigService, getConfigService } from './config-service.js';

const execFileAsync = promisify(execFileCallback);
const DEFAULT_STATE_FILE = path.join(getRuntimeDir(), 'repo-hygiene-state.json');
const GIT_TIMEOUT_MS = 5_000;

export interface RepoHygieneServiceOptions {
  configService?: ConfigService;
  stateFile?: string;
}

interface GitCommandResult {
  stdout: string;
}

function expandHome(repoPath: string): string {
  return repoPath.replace(/^~/, process.env.HOME || '');
}

function countPorcelain(status: string): {
  dirty: boolean;
  untrackedCount: number;
  modifiedCount: number;
} {
  const lines = status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const untrackedCount = lines.filter((line) => line.startsWith('??')).length;
  return {
    dirty: lines.length > 0,
    untrackedCount,
    modifiedCount: Math.max(0, lines.length - untrackedCount),
  };
}

function normalizeCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function protectedBranchesFor(repo: RepoConfig, policy: RepoHygienePolicy): string[] {
  const configured: Array<string | undefined> = policy.protectedBranches ?? [
    repo.defaultBranch,
    'main',
    'master',
    'production',
  ];
  return Array.from(new Set(configured.filter((branch): branch is string => Boolean(branch))));
}

export class RepoHygieneService {
  private configService: ConfigService;
  private stateFile: string;

  constructor(options: RepoHygieneServiceOptions = {}) {
    this.configService = options.configService || getConfigService();
    this.stateFile = options.stateFile || DEFAULT_STATE_FILE;
  }

  async getLatestState(): Promise<RepoHygieneState | null> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8');
      return JSON.parse(content) as RepoHygieneState;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async scanAll(): Promise<RepoHygieneState> {
    const config = await this.configService.getConfig();
    const repos = await Promise.all(config.repos.map((repo) => this.scanRepo(repo)));
    const scannedAt = new Date().toISOString();
    const blockingRepos = repos.filter((repo) => repo.blocking).length;
    const warningRepos = repos.filter(
      (repo) => !repo.blocking && repo.issues.some((issue) => issue.severity === 'warning')
    ).length;
    const state: RepoHygieneState = {
      scannedAt,
      summary: {
        healthy: blockingRepos === 0,
        blockingRepos,
        warningRepos,
        totalRepos: repos.length,
      },
      repos,
    };
    await this.saveState(state);
    return state;
  }

  async getOrScanLatest(): Promise<RepoHygieneState> {
    const latest = await this.getLatestState();
    return latest || this.scanAll();
  }

  getBlockingReposForDone(state: RepoHygieneState): RepoHygieneRepoStatus[] {
    return state.repos.filter((repo) => repo.blocking);
  }

  private async saveState(state: RepoHygieneState): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  private async scanRepo(repo: RepoConfig): Promise<RepoHygieneRepoStatus> {
    const scannedAt = new Date().toISOString();
    const repoPath = expandHome(repo.path);
    const policy = repo.hygiene || {};
    const enabled = policy.enabled !== false;
    const blockingSeverity = policy.critical !== false && policy.enforceOnDone !== false;
    const expectedBranch = policy.expectedBranch ?? null;
    const protectedBranches = protectedBranchesFor(repo, policy);
    const issues: RepoHygieneIssue[] = [];

    const statusBase = (): Omit<RepoHygieneRepoStatus, 'healthy' | 'blocking' | 'issues'> => ({
      repoName: repo.name,
      path: repo.path,
      branch: null,
      expectedBranch,
      protectedBranch: false,
      protectedBranches,
      dirty: false,
      untrackedCount: 0,
      modifiedCount: 0,
      ahead: 0,
      behind: 0,
      detachedHead: false,
      hasUpstream: false,
      scannedAt,
    });

    const severity = (): RepoHygieneIssue['severity'] =>
      blockingSeverity ? 'blocking' : 'warning';
    const addIssue = (code: string, message: string): void => {
      issues.push({ code, severity: severity(), message });
    };

    if (!enabled) {
      issues.push({
        code: 'REPO_HYGIENE_DISABLED',
        severity: 'warning',
        message: `Repo hygiene scanning is disabled for ${repo.name}`,
      });
      return this.finalizeStatus({ ...statusBase(), issues });
    }

    try {
      await fs.access(repoPath);
    } catch {
      addIssue('PATH_MISSING', `Repository path does not exist: ${repo.path}`);
      return this.finalizeStatus({ ...statusBase(), issues });
    }

    const isRepo = await this.git(repoPath, ['rev-parse', '--is-inside-work-tree']).catch(
      () => null
    );
    if (!isRepo || isRepo.stdout.trim() !== 'true') {
      addIssue('NOT_GIT_REPO', `Path is not a git worktree: ${repo.path}`);
      return this.finalizeStatus({ ...statusBase(), issues });
    }

    const branchResult = await this.git(repoPath, ['branch', '--show-current']).catch(() => ({
      stdout: '',
    }));
    const branch = branchResult.stdout.trim() || null;
    const detachedHead = !branch;
    const protectedBranch = Boolean(branch && protectedBranches.includes(branch));

    const porcelain = await this.git(repoPath, [
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);
    const counts = countPorcelain(porcelain.stdout);

    let hasUpstream = false;
    let ahead = 0;
    let behind = 0;
    const upstream = await this.git(repoPath, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}',
    ]).catch(() => null);
    if (upstream && upstream.stdout.trim()) {
      hasUpstream = true;
      const divergence = await this.git(repoPath, [
        'rev-list',
        '--left-right',
        '--count',
        'HEAD...@{u}',
      ]).catch(() => null);
      if (divergence) {
        const [aheadRaw = '0', behindRaw = '0'] = divergence.stdout.trim().split(/\s+/);
        ahead = normalizeCount(aheadRaw);
        behind = normalizeCount(behindRaw);
      }
    }

    if (detachedHead && !policy.allowDetachedHead) {
      addIssue('DETACHED_HEAD', `${repo.name} is in detached HEAD state`);
    }
    if (branch && expectedBranch && branch !== expectedBranch) {
      addIssue('BRANCH_MISMATCH', `${repo.name} is on ${branch}; expected ${expectedBranch}`);
    }
    if (protectedBranch && !policy.allowProtectedBranch && (counts.dirty || ahead > 0)) {
      addIssue(
        'PROTECTED_BRANCH_ACTIVE_WORK',
        `${repo.name} has active local work on protected branch ${branch}. Use a task branch/worktree or clean the repo before Done.`
      );
    }
    if (counts.dirty && !policy.allowDirty) {
      addIssue(
        'DIRTY_WORKTREE',
        `${repo.name} has ${counts.modifiedCount} modified and ${counts.untrackedCount} untracked files`
      );
    }
    if (!hasUpstream && !policy.allowNoUpstream) {
      addIssue('MISSING_UPSTREAM', `${repo.name} has no upstream tracking branch`);
    }
    if (ahead > 0 && !policy.allowAhead) {
      addIssue('AHEAD_OF_UPSTREAM', `${repo.name} is ${ahead} commit(s) ahead of upstream`);
    }
    if (behind > 0 && !policy.allowBehind) {
      addIssue('BEHIND_UPSTREAM', `${repo.name} is ${behind} commit(s) behind upstream`);
    }

    return this.finalizeStatus({
      ...statusBase(),
      branch,
      protectedBranch,
      dirty: counts.dirty,
      untrackedCount: counts.untrackedCount,
      modifiedCount: counts.modifiedCount,
      ahead,
      behind,
      detachedHead,
      hasUpstream,
      issues,
    });
  }

  private finalizeStatus(
    status: Omit<RepoHygieneRepoStatus, 'healthy' | 'blocking'>
  ): RepoHygieneRepoStatus {
    const blocking = status.issues.some((issue) => issue.severity === 'blocking');
    return {
      ...status,
      healthy: status.issues.length === 0,
      blocking,
    };
  }

  private async git(cwd: string, args: string[]): Promise<GitCommandResult> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return { stdout };
  }
}

let repoHygieneInstance: RepoHygieneService | null = null;

export function getRepoHygieneService(): RepoHygieneService {
  if (!repoHygieneInstance) {
    repoHygieneInstance = new RepoHygieneService();
  }
  return repoHygieneInstance;
}
