import unittest

try:  # the service extra (fastapi + httpx) may not be installed
    import fastapi.testclient  # noqa: F401  (presence check only)

    _HAS_FASTAPI = True
except ModuleNotFoundError:
    _HAS_FASTAPI = False


@unittest.skipUnless(_HAS_FASTAPI, "fastapi/httpx not installed (uv sync --extra service)")
class EvalParityTest(unittest.TestCase):
    def test_service_path_results_are_byte_identical_for_every_golden_case(self) -> None:
        from service.eval_parity import run_parity

        mismatches = run_parity()
        self.assertEqual(mismatches, [], msg="\n".join(mismatches))

    def test_eval_hard_fail_gates_pass_through_service_path(self) -> None:
        from service.eval_parity import run_service_eval

        report = run_service_eval()
        self.assertTrue(
            report.passed,
            msg="Service-path eval violated hard-fail gates:\n" + report.format(),
        )
        self.assertEqual(report.counts["runtime_failures"], 0)


class InvokeDefaultBehaviorTest(unittest.TestCase):
    """The run_eval(invoke=...) seam must not disturb the default in-process path
    (evals/runner_test.py covers the full report; this pins the seam contract)."""

    def test_run_eval_without_invoke_still_passes_gates(self) -> None:
        from evals.golden_dataset import GOLDEN_CASES
        from evals.runner import run_eval

        report = run_eval(cases=GOLDEN_CASES[:3])
        self.assertEqual(report.total, 3)
        self.assertEqual(report.counts["runtime_failures"], 0)


if __name__ == "__main__":
    unittest.main()
