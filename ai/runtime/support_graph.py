"""Wire the v1 support graph (harness section 6).

Node order:

    normalize -> classifier -> retrieval_planner -> retrieval -> policy
      -> tool_planner -> tool_execution
      -> (conditional) composer | guardrail
      -> guardrail -> escalation -> finalize -> END

The single conditional edge after ``tool_execution`` skips drafting for hard
human-only cases (legal/chargeback/fraud/safety/injection): a human writes those
replies, so no AI draft is produced.
"""

from __future__ import annotations

from .deps import GraphDependencies
from .graph import END, StateGraph, _CompiledGraph
from . import nodes


def build_support_graph(deps: GraphDependencies) -> _CompiledGraph:
    graph = StateGraph()
    graph.add_node("normalize", lambda s: nodes.normalize_node(s, deps))
    graph.add_node("classifier", lambda s: nodes.classifier_node(s, deps))
    graph.add_node("retrieval_planner", lambda s: nodes.retrieval_planner_node(s, deps))
    graph.add_node("retrieval", lambda s: nodes.retrieval_node(s, deps))
    graph.add_node("policy", lambda s: nodes.policy_node(s, deps))
    graph.add_node("tool_planner", lambda s: nodes.tool_planner_node(s, deps))
    graph.add_node("tool_execution", lambda s: nodes.tool_execution_node(s, deps))
    graph.add_node("composer", lambda s: nodes.composer_node(s, deps))
    graph.add_node("guardrail", lambda s: nodes.guardrail_node(s, deps))
    graph.add_node("escalation", lambda s: nodes.escalation_node(s, deps))
    graph.add_node("finalize", lambda s: nodes.finalize_node(s, deps))

    graph.set_entry_point("normalize")
    graph.add_edge("normalize", "classifier")
    graph.add_edge("classifier", "retrieval_planner")
    graph.add_edge("retrieval_planner", "retrieval")
    graph.add_edge("retrieval", "policy")
    graph.add_edge("policy", "tool_planner")
    graph.add_edge("tool_planner", "tool_execution")
    graph.add_conditional_edges(
        "tool_execution",
        nodes.route_after_tools,
        {"compose": "composer", "skip": "guardrail"},
    )
    graph.add_edge("composer", "guardrail")
    graph.add_edge("guardrail", "escalation")
    graph.add_edge("escalation", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()
