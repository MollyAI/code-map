import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TestJsFlowParity(unittest.TestCase):
    """Cross-language golden-fixture parity: the viewer's JS synthesizeFlows
    (viewer/src/data/flows.js) must produce the same flows as the Python source
    of truth (scripts/lib/flows.py) on the same graph. analyze.py runs Phase 1
    on a tiny fixture, writing flows[] via flows.py; the node driver recomputes
    flows from the same JSON with the JS modules; the two are compared."""

    def test_js_synthesize_matches_python(self):
        if not shutil.which("node"):
            self.skipTest("node not available")
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "raw.json"
            subprocess.run(
                ["python3", str(ROOT / "scripts/analyze.py"),
                 "--root", str(ROOT / "tests/fixtures/mini"), "--out", str(out)],
                check=True, cwd=ROOT)
            data = json.loads(out.read_text())
            py_flows = data.get("flows", [])
            self.assertTrue(py_flows, "fixture must produce at least one flow")
            res = subprocess.run(
                ["node", str(ROOT / "tests/fixtures/_run_js_flows.mjs"), str(out)],
                check=True, capture_output=True, text=True, cwd=ROOT)
            js_flows = json.loads(res.stdout)

            def norm(fs):
                return sorted((f["seed"], tuple(sorted(f["nodes"]))) for f in fs)

            self.assertEqual(norm(py_flows), norm(js_flows))


if __name__ == "__main__":
    unittest.main()
