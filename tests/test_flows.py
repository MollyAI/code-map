import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # repo root → scripts.lib importable

from scripts.lib.extractors.base import Declaration
from scripts.lib import flows


def _decl(name, ns="app", in_deg=0):
    d = Declaration(name=name, namespace=ns, kind="function", path=f"{ns}.py", line=1)
    d._in_degree = in_deg  # type: ignore[attr-defined]
    return d


class TestMarkHubs(unittest.TestCase):
    def test_top_percentile_by_in_degree_marked_hub(self):
        decls = [_decl(f"f{i}", in_deg=i) for i in range(1, 21)]  # in_degree 1..20, all nonzero
        hub_ids = flows.mark_hubs(decls, percentile=0.05)  # top 5% of 20 = 1 node
        self.assertEqual(hub_ids, {"app.f20"})
        self.assertTrue([d for d in decls if d.name == "f20"][0]._hub)
        self.assertFalse([d for d in decls if d.name == "f1"][0]._hub)

    def test_zero_in_degree_never_hub(self):
        decls = [_decl("a", in_deg=0), _decl("b", in_deg=0)]
        hub_ids = flows.mark_hubs(decls, percentile=0.5)
        self.assertEqual(hub_ids, set())
        self.assertFalse(decls[0]._hub)

    def test_small_repo_below_threshold_no_hubs(self):
        decls = [_decl(f"f{i}", in_deg=i) for i in range(1, 6)]  # 5 nonzero, top 5% = int(0.25)=0
        hub_ids = flows.mark_hubs(decls, percentile=0.05)
        self.assertEqual(hub_ids, set())

    def test_ties_broken_deterministically_by_name(self):
        decls = [_decl("zeta", in_deg=9), _decl("alpha", in_deg=9),
                 _decl("low", in_deg=1)]
        hub_ids = flows.mark_hubs(decls, percentile=0.34)  # int(3*0.34)=1 → one of the two 9s
        self.assertEqual(hub_ids, {"app.alpha"})  # tie → lexicographically smallest qualified_name
