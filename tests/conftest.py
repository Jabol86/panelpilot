"""Dołącza integrację z tego repo do pakietu custom_components używanego przez testy HA."""

from pathlib import Path

import pytest

OURS = str(Path(__file__).parent.parent / "custom_components")


@pytest.fixture(autouse=True)
def _our_components():
    import custom_components

    if OURS not in list(custom_components.__path__):
        custom_components.__path__ = [*custom_components.__path__, OURS]
