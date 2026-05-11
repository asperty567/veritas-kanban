# Hermes ↔ Veritas router merge and activation plan

Source task: task_20260509_1ytBXQ — lane G integration coordinator.
Date: 2026-05-09.
Scope: coordinate lanes A-F into one ordered landing plan. This file contains no secrets and does not authorize upstream pushes.

## Current lane map

| Lane | Task                                                      | Expected patch area                                                                           | Observed state                                                                                                                                                                                     | Integration status                                                                                                |
| ---- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A    | task_20260509_g6JbjG — Veritas task selector/claim API    | `server/src/services/task-service.ts`, `server/src/routes/tasks.ts`, shared task types, tests | Selector/claim code and `server/src/__tests__/task-router-claim.test.ts` are present. API routes observed: `GET /api/tasks/runnable`, `POST /api/tasks/claim`.                                     | Land first; it is the source-of-truth claim primitive.                                                            |
| B    | task_20260509_1z0lXV — Hermes dispatcher adapter          | `cli/src/commands/hermes-dispatcher.ts`, CLI wiring, tests                                    | Dispatcher code and `cli/__tests__/hermes-dispatcher.test.ts` are present. Defaults preserve `openai-codex:gpt-5.5`; prompt says HermesAgent canonical and no OpenClaw runtime.                    | Land after A; depends on Veritas pending/claim/writeback APIs.                                                    |
| C    | task_20260509_F2yR9U — progress/subtask/writeback QA gate | `server/src/routes/tasks.ts`, progress service, task schema, tests                            | Writeback route observed: `POST /api/tasks/:id/writeback`; it appends progress, checks criteria/subtasks, and refuses `done` without QA evidence or existing passed QA gate.                       | Land with A or immediately after A; B should use this route instead of comments-only completion where possible.   |
| D    | task_20260509_U2i7PT — live smoke and MC wrapper          | Mission Control integration and live smoke docs                                               | No lane-specific implementation artifact found in this pass. MC Veritas bridge artifact observed at `/Users/admin/Projects/mission-control-production/app/components/veritas-board-optimistic.ts`. | Hold activation until D supplies live smoke evidence against `http://127.0.0.1:3001` and `http://127.0.0.1:3099`. |
| E    | task_20260509_mae4GN — UI status visibility               | `web/src/components/task/TaskCard.tsx`, card tests                                            | TaskCard now distinguishes `Auto route`, concrete profile assignment, and concrete running attempt; tests observed in `web/src/__tests__/TaskCard.test.tsx`.                                       | Land after shared/server task fields from A/C are stable.                                                         |
| F    | task_20260509_4JmHSn — runtime monitor/escalation         | server/CLI monitor or operational script                                                      | No lane-specific implementation artifact found in this pass.                                                                                                                                       | Hold activation until F supplies monitor behavior and escalation proof.                                           |

## Ordered integration plan

1. Freeze the model/provider contract.
   - Required target: `openai-codex:gpt-5.5`.
   - Do not accept any patch that falls back to another provider/model.
   - Do not re-enable OpenClaw runtime. Legacy names are compatibility labels only.

2. Land server data-contract changes first.
   - Merge shared task type additions for `attempt`, `claim`, `attempts`, `qaGate`, `subtasks.criteriaChecked`, and any routing metadata.
   - Merge `TaskService.selectRunnableTasks` and `TaskService.claimRunnableTask`.
   - Merge API endpoints:
     - `GET /api/tasks/runnable`
     - `POST /api/tasks/claim`
     - `GET/PUT/POST /api/tasks/:id/progress`
     - `POST /api/tasks/:id/writeback`
   - QA gate: unit tests for priority order, blocked/done exclusion, parent-with-open-subtask exclusion, active lease exclusion, expired lease reclaim, and idempotent same-session claim.

3. Land writeback semantics before dispatcher activation.
   - Dispatcher completion must append progress evidence and tick criteria/subtasks through Veritas, not just return stdout.
   - `done` must remain blocked unless QA evidence exists.
   - QA gate: writeback tests for append progress, criteria update, subtask completion, and refusal to complete without QA.

4. Land Hermes dispatcher adapter.
   - Dispatcher must call HermesAgent CLI only, with `--provider openai-codex --model gpt-5.5`.
   - It may read `/api/agents/pending` for compatibility, but Veritas claim/writeback should be canonical for router-owned tasks.
   - It must redact sensitive output before evidence writeback.
   - QA gate: dispatcher tests proving default route, explicit route passthrough, dry-run has no writes, process spawn uses Hermes, and completion writes evidence.

5. Land UI visibility.
   - Board cards must show routing vs execution separately:
     - `Auto route` means not a concrete running executor.
     - `Profile: <name>` means assigned profile but not running.
     - `<name> running` means concrete attempt in progress.
   - QA gate: TaskCard tests for `Auto route`, concrete profile assignment, and concrete running attempt.

6. Land monitor/escalation after dispatcher semantics are stable.
   - Monitor should detect pending requests, expired leases, failed dispatcher attempts, silent running attempts, and stale `in-progress` without fresh evidence.
   - Escalation output must name task id, agent/profile, model, age, and last evidence timestamp without printing secrets.
   - QA gate: focused tests or deterministic dry-run fixture for each monitor class.

7. Live activation only after explicit restart/rebuild approval.
   - Required restarts/rebuilds are side-effecting. Do not restart MC, Veritas API, or HermesAgent without explicit approval from the operator/Andy in the active session.
   - Activation sequence after approval:
     1. Build/test Veritas server/shared/CLI/web packages.
     2. Restart Veritas API on `http://127.0.0.1:3099`.
     3. Restart or refresh MC surface on `http://127.0.0.1:3001` if D changed MC code.
     4. Run one dry-run dispatcher smoke.
     5. Run one real claim/writeback smoke on a disposable test task.
     6. Verify board UI reflects route/profile/attempt state.

## Conflict points

1. Task ownership conflict.
   - Swarm brief assigns this lane to Hermes profile `hermes`; current task frontmatter observed `agent: hawk`.
   - Fix through Veritas API before final activation so task ownership matches the assigned executor.

2. API/storage split.
   - Board protocol requires API writes. Runtime task files live under `server/.veritas-kanban/` and must not be treated as committable product state.
   - Any direct storage edit is only an emergency fallback and should be mirrored through API by a caller with HTTP access.

3. Dispatcher write path.
   - Existing dispatcher evidence path uses task comments/subtasks and `/api/agents/:taskId/complete`.
   - C introduces `/api/tasks/:id/writeback`; final dispatcher should prefer the writeback contract for progress/criteria/QA gate consistency, while keeping legacy completion callback only as compatibility.

4. Claim vs pending request sources.
   - A creates router-runnable task selection/claim.
   - B loads `/api/agents/pending`, file requests, and automation pending tasks.
   - Merge decision: Veritas task claim is canonical for router work; pending request endpoints remain compatibility ingress.

5. Mission Control truth boundary.
   - MC must display/trigger Veritas truth, not become a second board source of truth.
   - MC changes must call Veritas API or render Veritas state; avoid duplicating task status in MC storage.

6. UI shared-type dependency.
   - E depends on task `attempt`/`claim` fields being available in shared types and API summary responses.
   - Land shared/server field exposure before web build.

7. Runtime-generated files.
   - Files under `server/storage` and runtime board files under `server/.veritas-kanban/` are generated operational state; do not commit them.

8. Upstream guardrail.
   - Use only the owned fork/working branch. Do not push or open a PR against `BradGroux/veritas-kanban` unless Andy explicitly authorizes it in the active session.

## Verification gates before Done

Minimum focused checks before marking any lane or the integrated router Done:

- Server selector/claim: `server/src/__tests__/task-router-claim.test.ts`
- Server writeback/progress: focused tests covering `/api/tasks/:id/writeback`
- CLI dispatcher: `cli/__tests__/hermes-dispatcher.test.ts`
- Web status: `web/src/__tests__/TaskCard.test.tsx`
- Type/build gate: shared types consumed by server, CLI, and web without TypeScript errors
- Live smoke after restart approval:
  - Veritas API responds on `http://127.0.0.1:3099`
  - MC responds on `http://127.0.0.1:3001`
  - disposable task can be claimed by Hermes route `openai-codex:gpt-5.5`
  - progress/writeback evidence appears on the Veritas task
  - task is not moved Done without QA evidence

## Rollback path

1. Disable dispatcher scheduling first; leave Veritas API running for board visibility.
2. Stop claim consumption by setting dispatcher limit to zero or dry-run mode.
3. Revert/disable Hermes dispatcher adapter patch while preserving server claim/writeback endpoints if they are already used by the UI.
4. If UI misrepresents running state, revert only TaskCard status-label patch; server truth remains intact.
5. If writeback endpoint corrupts task state, stop using `/api/tasks/:id/writeback` and fall back to manual progress/comment updates through existing APIs while preserving task files for audit.
6. Never delete generated task/progress storage during rollback without explicit approval.

## Merge recommendation

Do not activate the router yet. Merge readiness is partial: A, B, C, and E have visible implementation/test artifacts; D and F still need live smoke/monitor evidence. The safe next move is to review A+C together, then B, then E, while D/F produce activation proofs. Final Done requires QA evidence from focused tests plus live smoke after explicit restart approval.
