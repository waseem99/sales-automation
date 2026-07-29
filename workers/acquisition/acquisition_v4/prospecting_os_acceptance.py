"""Legacy compatibility alias for the historical Prospecting OS module name.

Use ``acquisition_v4.sales_automation_acceptance`` for all new code, tests and
operator commands.
"""

from .sales_automation_acceptance import *  # noqa: F401,F403
from .sales_automation_acceptance import main


if __name__ == "__main__":
    raise SystemExit(main())
