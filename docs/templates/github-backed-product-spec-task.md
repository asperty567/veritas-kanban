# GitHub-backed Veritas Product/Spec Task Template

Use this template for product/spec work that must produce a durable GitHub-backed artifact before implementation starts. The task stays in Veritas as board truth; GitHub is the implementation/review surface; Mission Control is display/control only.

## Required front matter

```yaml
---
id: task_<YYYYMMDD>_<slug>
title: '<Persona>: <product/spec outcome>'
type: task
status: pending
priority: high
project: <Veritas project name>
agent: <owner-persona>
git:
  repo: 'https://github.com/<owned-org-or-user>/<repo>.git'
  baseBranch: main
  worktreePath: /absolute/path/to/worktree
github:
  repo: <owned-org-or-user>/<repo>
  issueNumber: <issue-number-or-null>
dependencies:
  - id: <blocking-task-id-or-github-issue>
    reason: <why this must resolve first>
    requiredBefore: <spec|implementation|qa|done>
subtasks:
  - id: <task-id>-repo
    title: Repo ownership and branch gate confirmed
    completed: false
    acceptanceCriteria:
      - Repo is owned by Scribe HQ / Andy / asperty567 or explicitly authorized in-session
      - Base branch and worktree are recorded
      - No external upstream push/PR is required
    criteriaChecked:
      - false
      - false
      - false
  - id: <task-id>-spec
    title: Product/spec artifact created
    completed: false
    acceptanceCriteria:
      - Problem, customer/user, outcome, scope, non-goals, risks, and dependencies are documented
      - Acceptance criteria and doneWhen are testable
      - Artifact path or GitHub issue/PR link is posted to Progress
    criteriaChecked:
      - false
      - false
      - false
  - id: <task-id>-chunks
    title: Chunked execution plan is QA-complete per chunk
    completed: false
    acceptanceCriteria:
      - Each implementation chunk has its own acceptance criteria
      - Each chunk names focused QA/test evidence required before the next chunk starts
      - Strategic/product judgment decisions are escalated with numbered options instead of guessed
    criteriaChecked:
      - false
      - false
      - false
  - id: <task-id>-qa
    title: QA evidence and Done gate passed
    completed: false
    acceptanceCriteria:
      - Focused QA/checks are recorded in Progress
      - Repo state is verified after work and intentional changes are listed
      - Done is set only after QA evidence exists and all required criteria are checked
    criteriaChecked:
      - false
      - false
      - false
autoCompleteOnSubtasks: false
---
```

## Task body template

Owner/persona: <owner>
Repo/worktree: <repo URL> at <absolute path>
Base branch: <branch>
GitHub issue/PR: <issue/PR URL or "not opened yet">

Authority and routing:

- Veritas is board truth.
- GitHub is the durable artifact, review, PR, and CI surface.
- Mission Control may display/control the task, but is not source of truth.
- Linear/OpenClaw are not active routing surfaces. Mention them only for historical provenance.
- Do not push to external upstream repos or open upstream PRs unless Andy explicitly authorized it in this session.

Problem:

- What user/customer/business pain or opportunity exists?
- Why does it matter now?
- What revenue, reliability, speed, or product outcome does it improve?

Desired outcome:

- doneWhen: <observable completion condition>
- Success metric or proof: <specific evidence>
- Primary user/customer: <who benefits>

Scope:

- In scope:
  - <smallest product/spec slice>
  - <expected artifact path(s)>
- Non-goals:
  - <explicitly excluded work>
  - <work requiring a separate task>

Dependencies and blockers:

- Required before spec: <dependency or none>
- Required before implementation: <dependency or none>
- Required before QA/Done: <dependency or none>
- Strategic/product judgment needed: <none or numbered options for escalation>

Acceptance criteria:

- [ ] Repo ownership, base branch, and worktree are recorded.
- [ ] Problem, desired outcome, user/customer, scope, non-goals, dependencies, and risk are explicit.
- [ ] Each deliverable path or GitHub issue/PR is linked in Progress.
- [ ] Work is chunked so every chunk can be independently QA-complete.
- [ ] QA evidence required for Done is named before work starts.
- [ ] No active Linear/OpenClaw dependency exists.

Chunk plan:

1. Spec/intake chunk
   - Deliverable: <artifact path>
   - QA evidence required: source review + acceptance criteria coverage check.
2. Implementation chunk, if approved
   - Deliverable: <branch/PR/path>
   - QA evidence required: focused tests/build/lint/runtime smoke as applicable.
3. Release/readback chunk, if approved
   - Deliverable: <PR/CI/deploy/readback link>
   - QA evidence required: CI/review/readback proof and repo state verification.

Test / QA plan:

- Docs/spec-only: verify required sections exist, links/paths resolve, no unsupported routing references, and no secrets.
- Code/config: run focused unit/type/build checks that cover touched surfaces.
- UI/runtime: record smoke route, screenshot summary, or API response evidence as applicable.
- Medium+ risk or code touched: queue cross-model/reviewer check before Done.

Risk:

- Product risk: <unknowns, user/customer judgment, adoption risk>
- Technical risk: <repo/platform/test risk>
- Operational risk: <board/control-plane/routing risk>
- Security/secrets risk: <none or mitigation; redact credentials as [REDACTED]>

Progress writeback checklist:

- [ ] Start note includes repo, branch, worktree, and owner/persona.
- [ ] Material findings/artifact links are appended as Progress.
- [ ] Subtasks and criteriaChecked are ticked only when evidence exists.
- [ ] QA Evidence section is appended before Done.
- [ ] Repo state verification is appended before Done.

QA Evidence:

- Checks run: <exact command/check or manual validation>
- Result: <pass/fail>
- Evidence: <artifact/link/output summary>
- Secrets review: <confirmed none or redacted>

Done gate:
Move to Done only when all are true:

- All blocking dependencies are resolved or explicitly waived by Link/Andy.
- All required subtasks are completed and criteriaChecked are true.
- Progress contains artifact path(s) or GitHub issue/PR link(s).
- QA Evidence is recorded with passing focused checks.
- Repo state is verified and only intentional changes remain.
- No unauthorized external upstream push/PR, customer-facing action, credential action, payment action, or strategic/product judgment guess occurred.
