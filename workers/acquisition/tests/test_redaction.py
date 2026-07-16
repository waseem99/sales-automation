from unittest import TestCase

from acquisition.redaction import redact_mapping, sanitize_log_text


class RedactionTest(TestCase):
    def test_sensitive_mapping_fields_are_removed(self) -> None:
        value = redact_mapping({"token": "abc", "nested": {"cookie": "session=private", "safe": 3}})
        self.assertEqual(value["token"], "<redacted>")
        self.assertEqual(value["nested"]["cookie"], "<redacted>")
        self.assertEqual(value["nested"]["safe"], 3)

    def test_log_tokens_are_removed(self) -> None:
        text = sanitize_log_text("Authorization: Bearer private-token cookie=session-value")
        self.assertNotIn("private-token", text)
        self.assertNotIn("session-value", text)
