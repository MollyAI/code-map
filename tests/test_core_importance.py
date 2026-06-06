"""Unit tests for importance weighting (scripts/lib/core.py:build_graph).

Regression guard for the out-degree blind spot: pure data/model sinks (high
fan-in, zero fan-out) used to crush behavioral driver classes (high fan-out) so
hard that orchestrators/services/compilers never reached a layer's `core`. The
weighting must give fan-out a meaningful (though still-secondary) share.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from lib.core import build_graph  # noqa: E402
from lib.extractors.base import Declaration  # noqa: E402


class ImportanceWeightingTest(unittest.TestCase):
    def test_in_and_out_weights(self):
        # One edge Alpha -> Beta. With a single edge, max_in == max_out == 1, so
        # both log-normalized degrees are 1.0; each node's importance collapses to
        # exactly its single non-zero weight. This pins the weights directly.
        alpha = Declaration(name="Alpha", namespace="m", kind="class",
                            path="m.py", line=1, refs=["Beta"])  # pure driver
        beta = Declaration(name="Beta", namespace="m", kind="class",
                           path="m.py", line=2)                  # pure sink
        build_graph([alpha, beta])
        self.assertAlmostEqual(beta._importance, 0.55)   # fan-in weight
        self.assertAlmostEqual(alpha._importance, 0.35)  # fan-out weight

    def test_driver_outranks_low_degree_leaf(self):
        # A high fan-out orchestrator must outrank a barely-referenced leaf.
        driver = Declaration(name="Orchestrator", namespace="m", kind="class",
                             path="m.py", line=1,
                             refs=["L1", "L2", "L3", "L4", "L5"])
        leaves = [Declaration(name=f"L{i}", namespace="m", kind="class",
                              path="m.py", line=10 + i) for i in range(1, 6)]
        # one extra decl weakly referenced once, no outgoing edges
        weak = Declaration(name="Weakling", namespace="m", kind="class",
                           path="m.py", line=100, refs=["L1"])
        build_graph([driver, weak] + leaves)
        self.assertGreater(driver._importance, weak._importance)


if __name__ == "__main__":
    unittest.main()
