import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.extractors.base import Declaration
from scripts.lib import core


def _decl(name, hub=False):
    d = Declaration(name=name, namespace="app", kind="function", path="app.py", line=3)
    d._layer = "core"          # type: ignore[attr-defined]
    d._hub = hub               # type: ignore[attr-defined]
    return d


class TestToJsonShape(unittest.TestCase):
    LAYERS = [{"id": "core", "name": "Core", "order": 0, "summary": ""}]

    def test_hub_field_serialized(self):
        decls = [_decl("a", hub=True), _decl("b", hub=False)]
        out = core.to_json_shape(decls, edges=[], layers=self.LAYERS, project_meta={})
        classes = out["layers"][0]["classes"]
        hubs = {c["name"]: c["hub"] for c in classes}
        self.assertEqual(hubs, {"a": True, "b": False})

    def test_hub_defaults_false_when_unmarked(self):
        d = Declaration(name="x", namespace="app", kind="function", path="app.py", line=1)
        d._layer = "core"  # type: ignore[attr-defined]
        out = core.to_json_shape([d], edges=[], layers=self.LAYERS, project_meta={})
        self.assertFalse(out["layers"][0]["classes"][0]["hub"])

    def test_flows_passed_through(self):
        flows = [{"id": "flow:app.a", "name": "a", "description": "", "seed": "app.a",
                  "nodes": ["app.a"], "edges": [], "confidence": "high"}]
        out = core.to_json_shape([_decl("a")], edges=[], layers=self.LAYERS,
                                 project_meta={}, flows=flows)
        self.assertEqual(out["flows"], flows)

    def test_flows_defaults_to_empty_list(self):
        out = core.to_json_shape([_decl("a")], edges=[], layers=self.LAYERS, project_meta={})
        self.assertEqual(out["flows"], [])
