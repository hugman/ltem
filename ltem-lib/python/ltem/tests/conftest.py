import importlib.util
import json
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[4]
CASES = REPO / "conformance" / "cases" / "spec-examples.json"
SCHEMA = REPO / "ast" / "table.schema.json"


def load_examples():
    return json.loads(CASES.read_text(encoding="utf-8"))["examples"]


@pytest.fixture(scope="session")
def schema():
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def _load_runner():
    spec = importlib.util.spec_from_file_location("ltem_conformance_run", REPO / "conformance" / "tools" / "run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


normalize = _load_runner().normalize
