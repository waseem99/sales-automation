from __future__ import annotations

"""Acquisition V5 adapter.

The stable V4 collector remains the implementation of persistence, deduplication,
review output, health, CORS and durable Prospect Desk synchronization. This
module extends its source registry and qualification router for campaign-driven
Sales Navigator cold prospects without changing V4 source behavior.
"""

from . import runtime as _runtime
from .qualification_router import qualify_record

_runtime.qualify_record = qualify_record
_runtime.ALLOWED_SOURCE_ORIGINS["sales_navigator"] = {
    "https://www.linkedin.com",
    "https://linkedin.com",
    "https://sales.linkedin.com",
}

CollectorServer = _runtime.CollectorServer
CollectorHandler = _runtime.CollectorHandler
CollectorState = _runtime.CollectorState
create_server = _runtime.create_server

__all__ = ["CollectorServer", "CollectorHandler", "CollectorState", "create_server"]
