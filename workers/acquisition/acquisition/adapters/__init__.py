from .base import AcquisitionAdapter
from .fixture import FixtureHtmlAdapter
from .upwork import HumanActionRequired, UpworkSavedSearchAdapter

__all__ = [
    "AcquisitionAdapter",
    "FixtureHtmlAdapter",
    "HumanActionRequired",
    "UpworkSavedSearchAdapter",
]
