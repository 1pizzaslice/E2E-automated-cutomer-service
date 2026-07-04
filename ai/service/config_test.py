import unittest

from service.config import SECRET_REF_PATTERN, load_service_config


def _env(**overrides) -> dict[str, str]:
    env = {"SUPPORT_AI_SERVICE_TOKEN": "svc-token"}
    env.update(overrides)
    return env


class DefaultsTest(unittest.TestCase):
    def test_local_defaults(self) -> None:
        config = load_service_config(_env())
        self.assertEqual(config.token, "svc-token")
        self.assertEqual(config.mode, "local")
        self.assertIsNone(config.api_base_url)
        self.assertIsNone(config.api_token)
        self.assertEqual(config.http_timeout_s, 5.0)
        self.assertEqual(config.environment, "local")

    def test_environment_override(self) -> None:
        config = load_service_config(_env(SUPPORT_ENVIRONMENT="staging"))
        self.assertEqual(config.environment, "staging")

    def test_api_token_resolved_when_present_in_local_mode(self) -> None:
        config = load_service_config(_env(SUPPORT_INTERNAL_API_TOKEN="int-token"))
        self.assertEqual(config.api_token, "int-token")


class SecretRefTest(unittest.TestCase):
    def test_ref_pattern_mirrors_integrations_secrets(self) -> None:
        for valid in ("A", "SUPPORT_AI_SERVICE_TOKEN", "X9_Y"):
            self.assertIsNotNone(SECRET_REF_PATTERN.match(valid))
        for invalid in ("", "lower_case", "9STARTS_WITH_DIGIT", "_UNDERSCORE", "HAS-DASH", "HAS SPACE"):
            self.assertIsNone(SECRET_REF_PATTERN.match(invalid))

    def test_custom_token_ref_resolves_named_env_var(self) -> None:
        env = {"SUPPORT_AI_SERVICE_TOKEN_REF": "MY_SERVICE_TOKEN", "MY_SERVICE_TOKEN": "abc"}
        config = load_service_config(env)
        self.assertEqual(config.token, "abc")

    def test_invalid_token_ref_format_fails(self) -> None:
        env = _env(SUPPORT_AI_SERVICE_TOKEN_REF="lower_case")
        with self.assertRaises(ValueError) as ctx:
            load_service_config(env)
        self.assertIn("SUPPORT_AI_SERVICE_TOKEN_REF", str(ctx.exception))

    def test_missing_token_value_fails(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            load_service_config({})
        self.assertIn("SUPPORT_AI_SERVICE_TOKEN", str(ctx.exception))


class ServiceModeTest(unittest.TestCase):
    def test_service_mode_requires_base_url_and_api_token(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            load_service_config(_env(SUPPORT_AI_SERVICE_MODE="service"))
        message = str(ctx.exception)
        self.assertIn("SUPPORT_API_BASE_URL", message)
        self.assertIn("SUPPORT_INTERNAL_API_TOKEN", message)

    def test_service_mode_with_full_configuration(self) -> None:
        env = _env(
            SUPPORT_AI_SERVICE_MODE="service",
            SUPPORT_API_BASE_URL="http://api.internal:3000/",
            SUPPORT_INTERNAL_API_TOKEN="int-token",
        )
        config = load_service_config(env)
        self.assertEqual(config.mode, "service")
        self.assertEqual(config.api_base_url, "http://api.internal:3000")  # trailing slash stripped
        self.assertEqual(config.api_token, "int-token")

    def test_custom_api_token_ref(self) -> None:
        env = _env(
            SUPPORT_AI_SERVICE_MODE="service",
            SUPPORT_API_BASE_URL="http://api.internal:3000",
            SUPPORT_API_TOKEN_REF="OTHER_API_TOKEN",
            OTHER_API_TOKEN="other-token",
        )
        config = load_service_config(env)
        self.assertEqual(config.api_token, "other-token")

    def test_invalid_mode_fails(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            load_service_config(_env(SUPPORT_AI_SERVICE_MODE="remote"))
        self.assertIn("SUPPORT_AI_SERVICE_MODE", str(ctx.exception))


class TimeoutTest(unittest.TestCase):
    def test_timeout_ms_converted_to_seconds(self) -> None:
        config = load_service_config(_env(SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS="2500"))
        self.assertEqual(config.http_timeout_s, 2.5)

    def test_non_integer_timeout_fails(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            load_service_config(_env(SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS="soon"))
        self.assertIn("SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS", str(ctx.exception))

    def test_non_positive_timeout_fails(self) -> None:
        for raw in ("0", "-100"):
            with self.assertRaises(ValueError):
                load_service_config(_env(SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS=raw))


class FailFastCollectionTest(unittest.TestCase):
    def test_all_problems_reported_in_one_error(self) -> None:
        env = {
            "SUPPORT_AI_SERVICE_MODE": "bogus",
            "SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS": "never",
        }
        with self.assertRaises(ValueError) as ctx:
            load_service_config(env)
        message = str(ctx.exception)
        # Missing token, bad mode, and bad timeout are all listed together.
        self.assertIn("SUPPORT_AI_SERVICE_TOKEN", message)
        self.assertIn("SUPPORT_AI_SERVICE_MODE", message)
        self.assertIn("SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS", message)


if __name__ == "__main__":
    unittest.main()
