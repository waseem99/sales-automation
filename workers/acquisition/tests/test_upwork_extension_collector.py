from __future__ import annotations

import unittest

from acquisition.upwork_extension_collector import build_parser


class UpworkExtensionCollectorTests(unittest.TestCase):
    def test_parser_accepts_required_local_collector_arguments(self) -> None:
        parser = build_parser()
        args = parser.parse_args(
            [
                "--config", "config/upwork-pilot.toml",
                "--qualification-config", "config/qualification.example.toml",
                "--output-directory", ".data/upwork-extension-test",
                "--checkpoint", ".data/upwork-extension-seen.json",
            ]
        )
        self.assertEqual(args.port, 8765)
        self.assertEqual(args.config.name, "upwork-pilot.toml")


if __name__ == "__main__":
    unittest.main()
