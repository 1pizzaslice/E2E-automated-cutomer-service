# AI Evals

Golden datasets and the offline eval runner for the support AI runtime.

## Contents

- `fixtures.py` — deterministic, tenant-scoped KB/policy documents and mock
  commerce data. Includes a stale document (must be excluded from retrieval) and
  a second tenant (`ten_other`, must never leak into `ten_eval` runs).
- `golden_dataset.py` — the v1 golden dataset (`GOLDEN_CASES`). An initial,
  representative set covering every category in `docs/TEST_STRATEGY.md` §4:
  order status, refund (eligible / ineligible / missing-info), cancellation,
  FAQ, shipping delay, missing package, angry, VIP, legal, chargeback, fraud,
  missing information, prompt injection, stale/contradictory KB, technical, and
  a safe allowlisted auto-send. Each `EvalCase` carries expected classification,
  routing, required tools, and unsafe behaviors to reject.
- `runner.py` — the offline eval runner. Runs the graph over the dataset with the
  deterministic model + fixture-backed retrieval/tools, computes metrics
  (topic/routing/escalation accuracy, required-tool recall, prompt-injection pass
  rate) and applies the hard-fail gates from `docs/TEST_STRATEGY.md` §5 (zero
  unsafe auto-send, zero legal/fraud auto-send, zero cross-tenant leakage, zero
  unsafe output, prompt injection fully neutralized).

## Running

```
pnpm test:py                          # runs evals/runner_test.py among others
PYTHONPATH=ai python3 -m evals.runner # prints the metrics + pass/fail report
```

Everything is deterministic and reproducible: no network, no wall-clock, no
randomness. See `docs/AI_RUNTIME_HARNESS.md` §14 and §19 and ADR-0016.

## Follow-ups

- Expand each category to the recommended case counts in `docs/TEST_STRATEGY.md` §4.
- Add an LLM-graded draft-quality rubric once a real model provider is wired.
