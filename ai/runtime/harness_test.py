import unittest

from runtime import build_initial_decision


class RuntimeHarnessTest(unittest.TestCase):
    def test_defaults_to_human_approval(self) -> None:
        decision = build_initial_decision()

        self.assertEqual(decision.automation_mode, "human_approve")
        self.assertEqual(decision.risk_level, "low")
        self.assertIn("v1_default_human_approval", decision.reason_codes)

    def test_does_not_enable_auto_send_in_scaffold(self) -> None:
        decision = build_initial_decision(allow_auto_send=True)

        self.assertEqual(decision.automation_mode, "human_approve")
        self.assertIn("auto_send_not_enabled_in_scaffold", decision.reason_codes)


if __name__ == "__main__":
    unittest.main()

