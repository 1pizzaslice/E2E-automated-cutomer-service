import type {
  AiRunResponse,
  ApprovalEvidenceResponse,
  ApprovalResponse,
  ConversationResponse,
  MessageResponse,
  RoleName,
  SessionIdentityResponse,
  TicketResponse,
  ToolCallResponse,
} from "@support/shared-schemas";

const NOW = "2026-06-19T00:00:00.000Z";

/** Permission sets mirroring packages/api `ROLE_PERMISSIONS`, enough to gate on. */
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  support_agent: [
    "session:read",
    "approvals:read",
    "approvals:review",
    "ai_runs:read",
    "qa_reviews:read",
    "tickets:read",
  ],
  qa_reviewer: [
    "session:read",
    "approvals:read",
    "ai_runs:read",
    "qa_reviews:read",
    "qa_reviews:write",
    "tickets:read",
  ],
  client_viewer: ["session:read", "approvals:read", "tickets:read"],
};

export function identityFor(
  role: RoleName,
  overrides: Partial<SessionIdentityResponse> = {},
): SessionIdentityResponse {
  return {
    user_id: `usr_${role}`,
    tenant_id: "ten_1",
    email: `${role}@test.example`,
    roles: [role],
    permissions: [...(ROLE_PERMISSIONS[role] ?? ["session:read"])],
    ...overrides,
  };
}

export function approvalFixture(
  overrides: Partial<ApprovalResponse> = {},
): ApprovalResponse {
  return {
    approval_id: "apr_1",
    tenant_id: "ten_1",
    ticket_id: "tic_1",
    ai_run_id: "air_1",
    approval_type: "reply",
    status: "pending",
    requested_payload: { draft: "The original AI draft reply." },
    approved_payload: null,
    reviewer_user_id: null,
    review_notes: null,
    created_at: NOW,
    resolved_at: null,
    ...overrides,
  };
}

const ticket: TicketResponse = {
  ticket_id: "tic_1",
  tenant_id: "ten_1",
  conversation_id: "cnv_1",
  customer_id: "cus_1",
  status: "waiting_human",
  priority: "p2",
  topic: "shipping",
  subtopic: null,
  language: "en",
  sentiment: null,
  urgency_score: null,
  automation_mode: "human_approve",
  assigned_queue: null,
  assigned_user_id: null,
  sla_policy_id: null,
  policy_version_id: null,
  opened_at: NOW,
  first_response_due_at: null,
  next_response_due_at: null,
  resolution_due_at: null,
  resolved_at: null,
  closed_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const conversation: ConversationResponse = {
  conversation_id: "cnv_1",
  tenant_id: "ten_1",
  customer_id: "cus_1",
  channel_id: "email:support",
  external_thread_id: null,
  status: "open",
  last_message_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

const message: MessageResponse = {
  message_id: "msg_1",
  tenant_id: "ten_1",
  conversation_id: "cnv_1",
  ticket_id: "tic_1",
  channel_id: "email:support",
  direction: "inbound",
  body_text: "Where is my order #1234?",
  body_html_ref: null,
  attachments: [],
  external_message_id: null,
  external_thread_id: null,
  raw_payload_ref: null,
  created_by_type: "customer",
  created_by_user_id: null,
  provider_message_id: null,
  send_status: null,
  sent_by_type: null,
  ai_run_id: null,
  approval_id: null,
  sent_at: null,
  idempotency_key: null,
  created_at: NOW,
};

const aiRun: AiRunResponse = {
  ai_run_id: "air_1",
  tenant_id: "ten_1",
  ticket_id: "tic_1",
  conversation_id: "cnv_1",
  run_type: "full_graph",
  prompt_version: "support.v1",
  model_provider: "anthropic",
  model_id: "claude-sonnet-5",
  input_refs: {},
  retrieved_context_refs: { citations: [{ document_id: "kbd_1" }] },
  structured_output: { draft: "The original AI draft reply." },
  confidence: 0.82,
  risk_level: "low",
  automation_recommendation: "human_approve",
  guardrail_results: { injection: "pass" },
  status: "succeeded",
  latency_ms: 1200,
  input_tokens: 900,
  output_tokens: 120,
  cost_estimate: 0.01,
  trace_id: "trace-abc-123",
  created_at: NOW,
  completed_at: NOW,
};

const toolCall: ToolCallResponse = {
  tool_call_id: "tcl_1",
  tenant_id: "ten_1",
  ticket_id: "tic_1",
  ai_run_id: "air_1",
  tool_definition_id: "order_lookup",
  input: { order_id: "1234" },
  output: { status: "shipped" },
  status: "succeeded",
  side_effect_class: "read_only",
  idempotency_key: null,
  started_at: NOW,
  completed_at: NOW,
  error_code: null,
  error_message: null,
};

export function evidenceFixture(
  overrides: Partial<ApprovalEvidenceResponse> = {},
): ApprovalEvidenceResponse {
  return {
    approval: approvalFixture(),
    ticket,
    conversation,
    messages: [message],
    ai_run: aiRun,
    tool_calls: [toolCall],
    prior_approvals: [],
    ...overrides,
  };
}
