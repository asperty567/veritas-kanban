# Research / Revenue Workflow Intake for GitHub-Backed Veritas Work

Date: 2026-05-10
Owner persona: Scout
Source task: `task_20260506_hCpSaN`
Authority: Veritas is board truth; Mission Control is display/control; HermesAgent is the control plane; GitHub is the implementation/PR/review surface.

## Purpose

Use this intake when a research signal, customer insight, growth idea, revenue experiment, or SaaS/product opportunity needs to become executable Veritas work with durable GitHub-backed artifacts.

The goal is to turn loose opportunity signals into Andy-ready decisions and QAable delivery work without creating shadow truth in Linear, Mission Control-only tasks, chat threads, or non-GitHub artifact stores.

## Intake decision gate

Create a Veritas task only when the intake can answer all of these:

1. What is the signal?
2. Why does it matter now?
3. How can it make or protect money?
4. What is the fastest validation path?
5. What GitHub-backed artifact will exist when done?
6. What evidence will prove the task is ready for Done?

If any answer is missing, create a short research clarification task, not a build/execution task.

## Required Veritas task fields

Every research/revenue workflow task must include these fields in Details or subtasks before dispatch:

| Field                 | Required content                                                                                                              | Done-quality example                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Signal                | Observable trigger, customer quote, market move, support pain, competitor behavior, revenue leak, or internal capability gap. | `Three spa leads asked for post-treatment instructions in one week.`                                     |
| Why it matters        | Business impact, timing, and risk of doing nothing.                                                                           | `Repeated demand suggests an onboarding workflow that could increase Spa Scribe activation.`             |
| Money path            | Direct revenue, retention, upsell, lead conversion, cost reduction, or strategic SaaS learning.                               | `Package as Spa Scribe onboarding add-on; validate willingness to pay with 5 clinics.`                   |
| Validation speed      | Fastest credible test and target turnaround.                                                                                  | `48-hour concierge test using one markdown SOP and two clinic calls.`                                    |
| Effort                | Small / Medium / Large with owner count and main work surface.                                                                | `Small: one Scout research pass + one Aura clinic workflow review.`                                      |
| Source links          | Durable references, redacted where needed. Prefer GitHub issue/PR/doc links and public URLs.                                  | `GitHub issue #322; source call note path with customer names redacted.`                                 |
| Deliverable repo/path | Owned GitHub repo and exact file/PR/issue path expected.                                                                      | `asperty567/veritas-kanban/docs/ops/spa-scribe-treatment-intake.md`                                      |
| Dependencies          | Prior Veritas task IDs, GitHub issue/PR, customer approval, credentials, payment/vendor dependency, or none.                  | `Depends on task_... for canonical template; no external platform dependency.`                           |
| QA evidence required  | Review/test/check that proves output quality.                                                                                 | `Markdown review, link check, acceptance checklist, PR diff, stakeholder sign-off when customer-facing.` |
| Escalation rule       | What must go to Andy/Hermes instead of being guessed.                                                                         | `Escalate pricing, customer-facing commitments, credential/payment changes, or strategic product bets.`  |

## Task template

Copy this into the Veritas task body:

```markdown
Owner persona:
Project:
Repo/worktree:
GitHub issue/branch/PR:

Signal:
Why it matters:
Money path:
Validation speed:
Effort:
Source links:
Deliverable repo/path:
Dependencies:
Scope boundary:
Escalation rule:

Andy-ready decision output:

- Verdict:
- Options:
- Recommendation:
- Cost / effort:
- Expected upside:
- Next action:

Acceptance criteria:

- [ ] Intake includes signal, why it matters, money path, validation speed, effort, source links, and deliverable repo/path.
- [ ] Output is an Andy-ready concise decision or an executable brief with `doneWhen`.
- [ ] Evidence is GitHub-backed and linked from Veritas Progress.
- [ ] Dependencies are explicit and no unsupported platform/non-GitHub routing is required.
- [ ] QA evidence is posted before Done.

QA evidence required:

- Progress note with artifact path/PR/issue.
- Markdown/template review for docs tasks or focused tests for code tasks.
- Repo state verification: changed files are intentional; no blanket reset/revert/format.
```

## Source and evidence standard

1. Prefer durable sources: GitHub issues/PRs/docs, committed markdown, public URLs, exported research notes, customer-safe summaries.
2. Never store secrets, credentials, raw customer PII, payment data, or private tokens in the task, progress, PR, or docs. Redact as `[REDACTED]`.
3. Customer-facing claims require an explicit approval/QA gate before publication.
4. Revenue numbers must state source and confidence: observed, estimated, or assumption.
5. Screenshots or external research must be accompanied by a text summary so Veritas remains searchable.
6. If evidence lives outside GitHub temporarily, the task must name the bridge artifact that will be committed or linked before Done.

## GitHub-backed artifact rules

A task is not complete until Veritas Progress links or names at least one durable artifact:

- GitHub issue for intake/provenance.
- Branch/PR for implementation or doc changes.
- Repo path for markdown report, template, SOP, audit, experiment plan, or QA checklist.
- Test command or review checklist output when code is touched.

Do not route active work through Linear, OpenClaw runtime, chat-only state, ad hoc local files, or Mission Control-only mutations. Those may be historical context or display surfaces, not task truth.

## Workflow types to create first

| Workflow                    | Purpose                                                                                                         | First artifact                                       | Typical QA                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Opportunity scan            | Turn market/customer/social signal into a ranked money-path brief.                                              | `docs/research/<date>-<topic>-opportunity-scan.md`   | Source-link review + Andy-ready verdict.                                               |
| Revenue experiment          | Define a fast test for pricing, packaging, upsell, activation, or lead conversion.                              | `docs/experiments/<date>-<experiment>.md`            | Hypothesis, metric, stop/go threshold, owner, and review date.                         |
| Medik8 on-demand            | Convert Medik8 Cyprus work into a guarded Veritas task with territory, revenue, repo, dependency, and QA gates. | `docs/ops/medik8-on-demand-veritas-task-template.md` | Cyprus-only guardrail + revenue path + repo ownership + dependency list + QA evidence. |
| Customer pain intake        | Convert support/customer pain into a product or SOP task.                                                       | `docs/customer-insights/<date>-<pain>.md`            | Redacted source summary + acceptance criteria tied to measurable pain reduction.       |
| SaaS feature validation     | Convert repeated workflow pain into a prototype/spec task.                                                      | `docs/product/<feature>-validation.md`               | `doneWhen`, scope boundary, risk, and prototype/test evidence.                         |
| Competitive/revenue defense | Track competitor move or platform risk affecting revenue.                                                       | `docs/research/<date>-competitive-defense.md`        | Source citations + recommended defensive move.                                         |

## Andy-ready output format

Use this for final progress/completion summaries:

```markdown
Verdict: [Do / Do not / Hold / Needs decision]
Why: [one sentence tied to revenue/time/risk]
Money path: [direct route to revenue or savings]
Speed to validate: [hours/days/weeks]
Effort: [S/M/L + owner]
Evidence: [GitHub issue/PR/path + source links]
Recommendation: [single next move]
Escalation needed: [none or numbered options for Andy]
```

## Done gate

Move a research/revenue workflow task to Done only when:

- Required intake fields are complete.
- Progress contains the artifact path/issue/PR and summary of findings.
- Dependencies/subtasks/criteria are ticked only where proven.
- QA evidence is posted: review checklist for docs/research, focused tests for code, runtime smoke for automation.
- Repo state is verified and all dirty changes are intentional or reported.
- Any strategic/product/pricing/customer-facing judgment has been escalated with options instead of guessed.
