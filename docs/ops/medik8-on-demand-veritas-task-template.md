# Medik8 on-demand Veritas task template

Owner persona: Dan
Surface: Veritas task creation / refinement for Medik8 Cyprus work
Status: active guidance
Last updated: 2026-05-10

## Purpose

Use this template whenever a Medik8 on-demand request needs to become Veritas work. The task must be revenue-focused, Cyprus-only, repo-owned, dependency-aware, and QAable before any agent starts.

This is a template/guidance artifact only. It does not authorize customer-facing publishing, payments, credential work, external upstream pushes, or territory expansion.

## Non-negotiable guardrails

- Territory: Medik8 work is Cyprus-only. Do not propose Greece, UK, EU-wide, ROW, global distributor, or non-Cyprus expansion unless Andy explicitly overrides in the same task.
- Revenue focus: every task must state the money path: B2B clinic/salon sell-through, B2C Shopify conversion, retention, campaign execution, cost reduction, or validated SaaS learning.
- Ownership: push only to Scribe HQ / Andy / asperty567-owned repos or forks. Never push to external upstream repos. Never open external upstream PRs without explicit in-session Andy authorization.
- Board truth: Veritas is task truth. Mission Control is display/control only. HermesAgent is control plane. Legacy OpenClaw runtime must not be revived.
- Secrets: no credentials, tokens, cookies, customer private data, supplier credentials, or webhook secrets in task details, progress, docs, screenshots, or QA evidence. Redact as `[REDACTED]`.
- CEO escalation: strategic/product/judgment choices must be escalated with numbered options; do not guess.
- Customer-facing actions: do not publish, message customers, change prices, touch payments, or mutate credentials without explicit approval.

## Required task fields

Every Medik8 on-demand Veritas task should include:

| Field               | Required content                                                               | Pass example                                                             |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Owner/persona       | Named accountable persona, not Andy unless CEO-owned decision.                 | `Owner/persona: Dan`                                                     |
| Business line       | B2B, B2C Shopify, operations, campaign, support, or SaaS-learning.             | `Business line: B2C Shopify conversion`                                  |
| Territory guardrail | Explicit Cyprus-only statement and prohibited expansion.                       | `Scope is Cyprus-only; no Greece/ROW expansion.`                         |
| Revenue path        | Direct path to revenue, saved time, retention, or validated learning.          | `Improve product-page conversion for Cyprus traffic.`                    |
| Repo/workdir        | Exact owned repo/fork and worktree, or `docs-only/no repo` if true.            | `/Users/admin/Projects/veritas-kanban on asperty567 fork`                |
| Dependencies        | Upstream data, credentials, approvals, blocked systems, or source docs needed. | `Needs current Cyprus campaign asset list; no publishing approval.`      |
| Scope boundary      | What is intentionally out of scope.                                            | `No live Shopify edits; produce QAable recommendations only.`            |
| doneWhen            | Observable completion condition.                                               | `Template exists, guardrails present, QA evidence recorded.`             |
| QA evidence         | Exact checks expected before Done.                                             | `Read-back confirms Cyprus-only, repo ownership, dependencies, QA gate.` |

## Copy/paste task template

```markdown
Title: Dan: Medik8 on-demand — [specific outcome]

Owner/persona: Dan
Project: Medik8 Cyprus / [B2B, B2C Shopify, Campaign, Ops, Support, SaaS learning]
Priority: [low | medium | high]
Repo/workdir: [owned repo/fork path, or docs-only/no repo]

Goal:
[One sentence outcome tied to revenue, saved time, retention, or validated learning.]

Business context:

- Medik8 Cyprus is the current revenue pillar.
- Territory is Cyprus-only. Do not propose Greece, UK, EU-wide, ROW, or global expansion.
- Maximize current Medik8 revenue without over-investing in assets Andy does not fully own.

Revenue path:

- Primary money path: [B2B sell-through | B2C Shopify conversion | retention | campaign execution | support cost reduction | SaaS learning].
- Expected impact: [what should improve and how it will be observed].

Scope:
In scope:

- [smallest surgical work item]
- [required artifact path or board-visible output]

Out of scope:

- Non-Cyprus territory expansion.
- Customer-facing publishing/messages/pricing/payment/credential changes without explicit approval.
- External upstream pushes/PRs.
- Legacy OpenClaw runtime changes.

Dependencies:

- Data/source dependency: [none / exact source]
- Approval dependency: [none / Andy approval needed for customer-facing or strategic choice]
- Platform dependency: [none / Shopify / Nuelink / Pabbly / Mission Control display / HermesAgent]
- Repo dependency: [owned fork confirmed / no repo required]

Acceptance criteria:

- [ ] Cyprus-only territory guardrail is explicit.
- [ ] Revenue path is explicit and tied to the work output.
- [ ] Repo/workdir and ownership boundary are explicit.
- [ ] Dependencies and approvals are listed.
- [ ] Scope excludes publishing/payment/credential/customer-facing changes unless approved.
- [ ] QA evidence is appended before Done.

QA plan:

- Read back the changed artifact/task and verify the six acceptance criteria above.
- If code/config changed, run the focused test/build/smoke for that surface.
- If docs/template only, record changed path plus read-back/search evidence.
- Verify repo state: branch, owned fork, intentional changed files, no secrets.

Done when:
[Exact observable finish line. Example: `Veritas task template/guidance is present in docs/ops, includes Cyprus-only + revenue + repo + dependency + QA guardrails, and QA evidence is written back.`]
```

## Dispatch checklist before starting work

- [ ] Read the Veritas task details, progress, subtasks, dependencies, and acceptance criteria.
- [ ] Confirm territory remains Cyprus-only.
- [ ] Confirm the task has a money path and is not generic marketing busywork.
- [ ] Confirm repo/workdir is owned by Scribe HQ / Andy / asperty567, or mark it docs-only/no repo.
- [ ] Append a started Progress note naming repo, branch, worktree, and intended artifact.
- [ ] Identify approval requirements before touching customer-facing, payment, credential, pricing, or publishing surfaces.

## Done gate for Medik8 on-demand tasks

Move to Done only after all applicable evidence is present in Veritas:

- Progress evidence: what changed, where, and why it satisfies the request.
- Subtasks/criteria: ticked only when proven.
- QA evidence: exact read-back/search/test/smoke evidence, or explicit non-applicability for docs-only work.
- Repo-state evidence: branch, owned remote/fork, intentional changed files, and no secrets exposed.
- Strategic choices: escalated with options instead of guessed.

## Fast rejection examples

Reject or return to Pending/On Hold if the task asks for:

- Greece/ROW/global Medik8 expansion without explicit Andy authorization.
- Live customer messaging, publishing, pricing, payments, or credential changes without approval.
- Work in external upstream repos or PRs.
- Vague `do marketing` work with no revenue path.
- Done movement without QA Evidence.
