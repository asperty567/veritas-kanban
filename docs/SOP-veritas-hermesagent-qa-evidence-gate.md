# SOP: Veritas/HermesAgent Mandatory QA Evidence Gate

Purpose: every Veritas/HermesAgent production task must carry explicit work evidence, QA evidence, review evidence where required, and repo-state evidence before it can move to `done`.

Authority:

- Veritas is task truth for status, subtasks, acceptance criteria, progress, QA evidence, and completion.
- Mission Control may display/proxy Veritas truth but must not be treated as the source of task truth.
- HermesAgent/Gateway is the control plane for active routing.
- Linear is historical/external only unless explicitly re-authorized.
- Legacy OpenClaw runtime, `.openclaw`, and `:18789` are not active routing paths for Veritas/HermesAgent cutover work.
- GitHub is the implementation, PR, and review surface. Push only to owned repos/forks.

## Mandatory Done gate

A task may move to `done` only when all applicable items below are recorded in Veritas Progress or in a linked GitHub PR/CI artifact:

1. Work evidence
   - repo, branch, and worktree used
   - files changed or artifact path/URL
   - concise summary of what changed and why it satisfies scope
   - acceptance criteria/subtasks checked only when proven

2. Test evidence
   - exact focused command(s) run, or explicit reason tests are not applicable
   - pass/fail result
   - regression test reference for bug fixes or production code changes
   - TDD evidence for production code changes unless the task explicitly exempts it

3. Review evidence
   - GitHub PR URL for production changes
   - reviewer verdict for medium/high-risk changes
   - cross-model or independent reviewer required for application code, infra, scripts, auth, billing, deployment, data, compliance, or control-plane behavior
   - no self-approval for medium/high-risk production work

4. CI evidence
   - CI run URL/status for PR-backed work, or explicit reason CI is not available/applicable
   - failing CI blocks `done` unless the failure is unrelated and documented with evidence

5. Runtime/browser smoke evidence, where applicable
   - API route smoke for server/control-plane changes
   - browser/UI smoke for user-visible UI changes
   - webhook/agent/dispatcher dry-run for orchestration changes
   - no restart of Mission Control `:3001` without explicit approval

6. Repo-state evidence
   - branch name and owned repo/fork confirmed
   - dirty worktree changes are intentional and listed
   - no blanket reset/revert/format used
   - no secrets printed or persisted; secrets must be redacted as `[REDACTED]`

## Evidence by task class

| Task class                 | Minimum evidence before Done                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Docs/template/audit only   | changed doc/template path, read-back or link check, acceptance criteria mapping, repo-state note                    |
| Production code            | failing/added test or stated TDD exemption, implementation diff, focused tests, review gate, PR, CI                 |
| API/server/control-plane   | route/service test, writeback/progress evidence if task lifecycle changes, runtime smoke if server is live-approved |
| UI/browser                 | component/unit test, browser smoke or screenshot-free textual smoke result, accessibility check where relevant      |
| Infra/deploy/cron          | dry-run, config validation, rollback note, approval note for destructive/customer-facing operations                 |
| Data/migration             | backup/rollback evidence, dry-run or fixture proof, no secret/PII leak, reviewer gate                               |
| Strategic/product judgment | decision options escalated; do not guess or mark done as implementation work                                        |

## Required Veritas writeback shape

Use the Veritas task API as the primary write path. Raw storage edits are emergency fallback only.

```json
POST /api/tasks/<taskId>/writeback
{
  "progress": {
    "section": "Progress",
    "content": "Repo/branch/worktree, artifact paths, and work evidence."
  },
  "criteria": [
    { "subtaskId": "<subtaskId>", "criteriaIndex": 0, "checked": true }
  ],
  "subtasks": [
    { "subtaskId": "<subtaskId>", "completed": true }
  ],
  "qa": {
    "evidence": "Exact tests/review/runtime/CI/repo-state evidence. If a class is not applicable, say why.",
    "passedBy": "<owner-or-reviewer>"
  },
  "complete": true
}
```

Rules:

- If `complete=true`, `qa.evidence` is required unless the task already has a passed QA gate.
- Do not set `complete=true` while any required subtask or acceptance criterion remains unproven.
- If QA is incomplete, write progress and leave the task `in-progress`, `pending`, or `on hold` with the explicit next dependency.
- Never delete a task to escape a bad state.

## Medium/high-risk reviewer gate

Reviewer gate is mandatory when any of these are true:

- task priority is high
- production code, infra, scripts, auth, billing, deploy, data, compliance, agent routing, board mutation, or writeback behavior changed
- customer/payment/credential-facing behavior changed
- rollback would be hard or data could be lost

Reviewer evidence must include:

- reviewer identity/model/persona
- reviewed branch/PR or artifact path
- exact checks run or inspected
- verdict: `approved` or `changes requested`

## Owner checklist

Before starting:

- [ ] Read task Details, Progress, Observations, subtasks, and acceptance criteria.
- [ ] Confirm owned repo/fork, branch, and worktree.
- [ ] Append a Veritas Progress note that work started.

Before requesting review:

- [ ] Work evidence is in Progress or PR.
- [ ] Tests/smoke checks ran or are explicitly not applicable.
- [ ] Dirty repo changes are intentional and listed.

Before Done:

- [ ] All applicable subtasks and criteria are checked.
- [ ] QA Evidence exists and maps to task class.
- [ ] Reviewer gate passed for medium/high-risk work.
- [ ] PR/CI evidence exists for production changes, or non-applicability is explicit.
- [ ] Repo state verified and no secrets exposed.
