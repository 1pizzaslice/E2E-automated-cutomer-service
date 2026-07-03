import unittest
from types import SimpleNamespace

from runtime.graph import END, GraphConfigError, StateGraph


class GraphEngineTest(unittest.TestCase):
    def test_linear_flow_runs_in_order(self) -> None:
        graph = StateGraph()
        graph.add_node("a", lambda s: s.trail.append("a"))
        graph.add_node("b", lambda s: s.trail.append("b"))
        graph.set_entry_point("a")
        graph.add_edge("a", "b")
        graph.add_edge("b", END)

        state = SimpleNamespace(trail=[])
        graph.compile().invoke(state)
        self.assertEqual(state.trail, ["a", "b"])

    def test_conditional_edges_route_by_key(self) -> None:
        graph = StateGraph()
        graph.add_node("start", lambda s: s.trail.append("start"))
        graph.add_node("left", lambda s: s.trail.append("left"))
        graph.add_node("right", lambda s: s.trail.append("right"))
        graph.set_entry_point("start")
        graph.add_conditional_edges("start", lambda s: s.branch, {"l": "left", "r": "right"})
        graph.add_edge("left", END)
        graph.add_edge("right", END)
        compiled = graph.compile()

        left_state = SimpleNamespace(trail=[], branch="l")
        compiled.invoke(left_state)
        self.assertEqual(left_state.trail, ["start", "left"])

        right_state = SimpleNamespace(trail=[], branch="r")
        compiled.invoke(right_state)
        self.assertEqual(right_state.trail, ["start", "right"])

    def test_unknown_conditional_key_raises(self) -> None:
        graph = StateGraph()
        graph.add_node("start", lambda s: None)
        graph.add_node("only", lambda s: None)
        graph.set_entry_point("start")
        graph.add_conditional_edges("start", lambda s: "missing", {"known": "only"})
        graph.add_edge("only", END)
        with self.assertRaises(GraphConfigError):
            graph.compile().invoke(SimpleNamespace())

    def test_cycle_is_bounded(self) -> None:
        graph = StateGraph(max_steps=5)
        graph.add_node("loop", lambda s: None)
        graph.set_entry_point("loop")
        graph.add_edge("loop", "loop")
        with self.assertRaises(GraphConfigError):
            graph.compile().invoke(SimpleNamespace())

    def test_missing_entry_point_raises(self) -> None:
        graph = StateGraph()
        graph.add_node("a", lambda s: None)
        graph.add_edge("a", END)
        with self.assertRaises(GraphConfigError):
            graph.compile()

    def test_node_without_outgoing_edge_raises(self) -> None:
        graph = StateGraph()
        graph.add_node("a", lambda s: None)
        graph.set_entry_point("a")
        with self.assertRaises(GraphConfigError):
            graph.compile()


if __name__ == "__main__":
    unittest.main()
