from __future__ import annotations

import unittest

from acquisition_worker.redaction import redact


class RedactionTests(unittest.TestCase):
    def test_sensitive_keys_and_values_are_removed(self) -> None:
        value = redact(
            {
                "cookie": "dashboard_session=private",
                "profile_path": "/private/browser/profile",
                "message": "authorization=secret user@example.com",
                "count": 4,
            }
        )
        self.assertEqual(value["cookie"], "[REDACTED]")
        self.assertEqual(value["profile_path"], "[REDACTED]")
        self.assertNotIn("secret", value["message"])
        self.assertNotIn("user@example.com", value["message"])
        self.assertEqual(value["count"], 4)


if __name__ == "__main__":
    unittest.main()
