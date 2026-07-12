# horz Design Review — What We Read, What We Rejected, And Why

**Status:** decision record. It adds no work and changes no code. Its only job is to stop these questions being re-opened from scratch every few months.

**Date:** 2026-07-12. **Reviewed:** the 13-document design-of-record in the sibling `horz/backend/` repository (`00-adr.md` … `12-open-questions-and-risks.md`), against this codebase at Milestone 23.

---

## 1. What horz is, and what this repo is

**horz is the vision, and it stands:** run seven back-office domains for other companies end-to-end — 01 Customer Service, 02 Legal, 03 HR, 04 Marketing, 05 Analytics, 06 Company Brain, 07 Tax — so a customer buys the whole back office from one vendor. **Customer service is domain 1.** That is what this repository is.

**The horz ADR's _architecture_ is a different thing from the horz _vision_, and it is not binding.** It was written before any domain existed. This repository is the first domain actually built, which means it knows things the design-of-record could not.

Read `horz/backend/` as a well-argued proposal from someone who had not yet shipped domain 1. Take its ideas on their merits. It is not a spec this repo is behind on.

---

## 2. The one thing we explicitly reject: "one agent-core, 49 config instantiations"

horz's central architectural claim (`00-adr.md` §2 row 2, `03-agent-architecture.md` §1.0):

> "There is exactly **one** sub-agent in horz. `01.3` Actioned Replies and `07.1` Federal Return are the _same_ Temporal workflow definition and the _same_ `agent-core` library, differing only in three checked-in inputs: a playbook, a tool set, and a set of registry rows." … "If you find yourself writing a bespoke loop for a new agent, you have made a mistake."

Where "49" comes from: 7 domains × ~7 sub-agents each. It is arithmetic from that document's own taxonomy, not a target. (Its own template section is titled "adding the 50th agent.")

**We do the opposite: full-fledged domain agents.** A tax filing and a support triage are genuinely different animals — different context needs, failure modes, latency budgets, and humans in the loop. Forcing them through one pipeline shape yields an abstraction that fits none of them well.

**Nothing in this repository builds toward 49 sub-agents, and nothing should.**

## 3. We also reject horz's pipeline on cost, and keep ours

|                       | LLM calls per item | Models                                                        |
| --------------------- | ------------------ | ------------------------------------------------------------- |
| **This repo**         | **2**              | classify + compose, both `claude-sonnet-5`                    |
| horz (`00-adr.md` §4) | **3**              | classify (Haiku) → draft (**Opus**) → LLM supervisor (Sonnet) |

horz adds a third call whose only job is to have a model grade the draft, and moves drafting up to the most expensive model. Our guardrails do that job in **deterministic Python** (`ai/runtime/nodes.py`, ADR-0016 (4), ADR-0023 (2): _the real model classifies and drafts, it never governs_).

Ours is both cheaper **and** safer: a deterministic guardrail cannot be argued out of its verdict by a prompt injection, and a missed detection degrades to human-approval rather than to auto-send. An LLM judge has neither property.

**Do not adopt horz's LLM-supervisor pass.** If a supervisor signal is ever wanted, add it as _advisory_ — never as the thing that decides.

---

## 4. What IS worth sharing across domains: platform primitives, not pipeline shape

The reusable thing was never the pipeline. It is the platform. And we already have most of it — it just happens to be wearing support's clothes.

**Domain-agnostic and genuinely reusable today:** `tenants`, `users`, `roles`, `user_roles`, `tenant_policies`, `policy_versions`, `integrations`, `tool_definitions`, `tool_calls`, `ai_runs`, `approvals`, `audit_events`, `qa_reviews`, `idempotency_keys`, `kb_documents`, `kb_chunks`.

**Correctly support-specific:** `tickets`, `conversations`, `messages`, `channels`, `customers`, `sla_policies`, `assignments`, `ticket_events`.

**The AI runtime seam is already right.** `ai/runtime/graph.py` is a generic engine; `ai/runtime/nodes.py` + `support_graph.py` are the domain wiring. Domain 2 is new nodes on the same engine. Nothing to do here.

## 5. Where domain 2 will hit a wall — named precisely, and deliberately not fixed

```
approvals.ticket_id       NOT NULL, FK -> tickets
ai_runs.ticket_id         NOT NULL, FK -> tickets
ai_runs.conversation_id   NOT NULL, FK -> conversations
```

The two most reusable primitives in the system — **the human-approval record and the AI provenance record** — are structurally welded to the support domain. A legal redline would have to invent a fake ticket and a fake conversation to use the approval console.

It is a small wall (two tables: nullable columns plus a polymorphic subject reference), but it is invisible today and it is the first thing domain 2 hits.

**Recorded, deliberately NOT fixed.** Building a generic `subject_ref` now, for a domain we have not started, guessing at what Legal actually needs, is the same mistake horz made — just smaller. Let domain 2 drive the shape. We will be right instead of clever.

## 6. The Company Brain is the moat, and it is correctly deferred

Ask the hard question: **why would anyone buy all seven domains from us rather than best-of-breed?** Gorgias will beat us at support. Harvey will beat us at legal. Pilot will beat us at books. "As good as each of them, seven times over" loses on every axis.

The only defensible answer: **because the seven know each other.** Support knows the refund policy Legal wrote. Tax knows the entity Legal incorporated. HR knows the headcount Analytics reported. That shared substrate _is_ the product — it is why Rippling won with one employee graph rather than seven good apps, a point horz's own competitor teardown makes (_"Rippling — the closest analog to Company Brain — mine this one hardest"_).

That substrate is horz's **Company Brain**, and there is no seam for it anywhere in this codebase.

**Do not build it now.** It cannot be designed from one domain; we would be guessing, and we would guess wrong. It becomes designable the moment domain 2 exists and we can _observe_ what actually needs sharing.

**Trigger to build: the start of domain 2.**

### What domain 1 owes the future Brain

Keep producing facts worth reading later — structured, cited, append-only artifacts. We are most of the way there (`ai_runs.structured_output`, `retrieved_context_refs`, `audit_events`, resolved tickets with evidence, the KB). Two known gaps degrade them as future Brain inputs, and they are the same two that would strengthen the pilot's story to a buyer:

- **Citations are carried but not required.** `Draft.validate()` (`ai/runtime/schemas.py`) checks text, risk level and confidence — an **empty-citation draft passes**. Hallucinated refs _are_ dropped (`ai/runtime/llm.py` `normalize_model_output`), so citations cannot be fabricated; they can simply be absent. A fact with no provenance is worthless to a Brain.
- **The audit log is not tamper-evident.** `audit_events` is a plain table with no hash chain, and migration `0002_tenant_rls.sql` grants the app role `UPDATE`/`DELETE` on it. Append-only is convention plus the absence of a write path, not a constraint.

**Both are open. Neither was actioned in this pass.**

---

## 7. Ideas from horz worth keeping on the shelf

Not adopted now; genuinely useful when the domains they serve arrive.

- **A `SIGNER-REGISTRY`.** horz maps each irreversible action to the _licensed role_ that must sign it (CPA/EA for a tax filing, an attorney for a legal filing). Today our approvals carry roles (`support_agent`, `qa_reviewer`) but no notion of "this action requires a licensed CPA". Domains 02/03/07 are _defined_ by that distinction. Worth building the day the first licensed signer appears — not before.
- **"The gate is a tool boundary, not a prompt."** Already true here, though by a stronger route: **no write-capable tool exists at all** (ADR-0010). Every tool is `defineReadOnlyTool`; `refund_eligibility` evaluates and cannot act. The barrier holds by absence rather than by authorization. When the first write tool lands, horz's gate-class registry is the right pattern to reach for.
- **Calibrated confidence.** horz insists on calibration (weekly ECE, versioned curve) and never routing on a model's raw self-report. Ours is raw self-report with a hard floor of 0.6 (`ai/runtime/nodes.py`). It is **inert today** — v1 requires human approval unconditionally, so nothing routes on it. It becomes load-bearing the moment the SOPS §17 auto-send ladder is climbed, and RLHF models are overconfident exactly when they are wrong. **Calibrate before auto-send, or do not ship auto-send.**

## 8. Where this repo is ahead of the design-of-record

Worth stating, so nobody "corrects" these toward horz:

- **Channels.** horz devotes exactly one sentence in 340KB to WhatsApp and never mentions DNS, email sending, Mailgun/SES/SMTP, or webhook ingress. We have real adapters, HMAC signature verification, inbound dedupe, threading, and the Meta subscription handshake.
- **Auth.** horz names no IdP at all. We have Clerk JWT/JWKS with DB-sourced roles and server-side tenant membership (ADR-0024).
- **Deterministic governance.** Covered above (§3).
- **No write tools at all.** Covered above (§7).

---

## 9. What to do with `horz/backend/`

Keep it. Read it for the **vision** and for the ideas in §7. Do not treat its stack table as a backlog — several of its rows (LiteLLM gateway, Firecracker + Envoy egress injection, Temporal Cloud, Redpanda, OpenTofu, per-tenant MCP servers) are scale-appropriate for 50 tenants and actively wrong for a single-VM pilot with no signed customer.

When a horz idea looks compelling, the question is not "does the ADR say so" but **"which of our actual problems does this solve today?"**
