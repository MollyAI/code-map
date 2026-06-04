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


class TestTraceFlow(unittest.TestCase):
    def _adj(self, pairs):
        adj = {}
        for a, b in pairs:
            adj.setdefault(a, []).append(b)
        return adj

    def test_linear_chain(self):
        adj = self._adj([("a", "b"), ("b", "c")])
        nodes, edges = flows.trace_flow("a", adj, set(), max_depth=6)
        self.assertEqual(nodes, ["a", "b", "c"])
        self.assertEqual(edges, [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}])

    def test_hub_is_a_leaf_not_expanded(self):
        adj = self._adj([("a", "hub"), ("hub", "x"), ("hub", "y")])
        nodes, edges = flows.trace_flow("a", adj, {"hub"}, max_depth=6)
        self.assertEqual(nodes, ["a", "hub"])          # hub shown
        self.assertEqual(edges, [{"from": "a", "to": "hub"}])  # but not expanded
        self.assertNotIn("x", nodes)

    def test_seed_that_is_a_hub_still_expands(self):
        adj = self._adj([("hub", "x"), ("hub", "y")])
        nodes, _ = flows.trace_flow("hub", adj, {"hub"}, max_depth=6)
        self.assertEqual(set(nodes), {"hub", "x", "y"})  # leaf rule never applies to the root

    def test_depth_cap(self):
        adj = self._adj([("a", "b"), ("b", "c"), ("c", "d")])
        nodes, _ = flows.trace_flow("a", adj, set(), max_depth=2)
        self.assertEqual(nodes, ["a", "b", "c"])  # depth 0,1,2 kept; d at depth 3 dropped

    def test_cycle_terminates_and_omits_back_edge(self):
        adj = self._adj([("a", "b"), ("b", "a")])
        nodes, edges = flows.trace_flow("a", adj, set(), max_depth=6)
        self.assertEqual(nodes, ["a", "b"])
        self.assertEqual(edges, [{"from": "a", "to": "b"}])  # b→a omitted (a already placed)

    def test_diamond_keeps_first_path_only(self):
        adj = self._adj([("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")])
        nodes, edges = flows.trace_flow("a", adj, set(), max_depth=6)
        self.assertEqual(set(nodes), {"a", "b", "c", "d"})
        # d entered once (via b, the first-seen path); the c→d join edge is omitted
        self.assertIn({"from": "b", "to": "d"}, edges)
        self.assertNotIn({"from": "c", "to": "d"}, edges)


class TestBuildFlows(unittest.TestCase):
    def _decls(self, names):
        out = []
        for n in names:
            d = Declaration(name=n, namespace="app", kind="function", path="app.py", line=1)
            out.append(d)
        return out

    def test_one_flow_per_seed_with_pruned_membership(self):
        decls = self._decls(["main", "setup", "render", "log"])
        edges = [
            {"from": "app.main", "to": "app.setup", "kind": "uses"},
            {"from": "app.setup", "to": "app.render", "kind": "uses"},
            {"from": "app.render", "to": "app.log", "kind": "uses"},
            {"from": "app.setup", "to": "app.log", "kind": "uses"},
        ]
        hub_ids = {"app.log"}
        result = flows.build_flows(["app.main"], decls, edges, hub_ids, max_depth=6)
        self.assertEqual(len(result), 1)
        f = result[0]
        self.assertEqual(f["id"], "flow:app.main")
        self.assertEqual(f["name"], "main")
        self.assertEqual(f["seed"], "app.main")
        self.assertEqual(f["confidence"], "high")
        self.assertEqual(f["description"], "")
        self.assertEqual(set(f["nodes"]), {"app.main", "app.setup", "app.render", "app.log"})
        # log is a hub leaf: reached once, never expanded
        self.assertIn("app.log", f["nodes"])

    def test_extends_edges_ignored(self):
        decls = self._decls(["main", "Base"])
        edges = [{"from": "app.main", "to": "app.Base", "kind": "extends"}]
        result = flows.build_flows(["app.main"], decls, edges, set(), max_depth=6)
        self.assertEqual(result[0]["nodes"], ["app.main"])  # extends not traversed

    def test_unknown_seed_skipped(self):
        decls = self._decls(["main"])
        result = flows.build_flows(["app.ghost"], decls, [], set(), max_depth=6)
        self.assertEqual(result, [])

    def test_entry_point_with_no_outgoing_edges_emits_single_node_flow(self):
        decls = self._decls(["main"])
        result = flows.build_flows(["app.main"], decls, [], set(), max_depth=6)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["nodes"], ["app.main"])
        self.assertEqual(result[0]["edges"], [])
