-- Milestone 13: messages.send_status / messages.sent_by_type move from free
-- text to PostgreSQL enums. The value sets mirror the shared-schemas
-- contracts (OutboundSendStatusSchema / OutboundSentByTypeSchema) that have
-- governed every write since Milestone 10, so the USING casts are clean.

create type message_send_status as enum ('queued', 'sent', 'failed', 'canceled');

create type message_sent_by_type as enum ('human', 'ai_auto', 'system');

alter table messages
  alter column send_status type message_send_status
  using send_status::message_send_status;

alter table messages
  alter column sent_by_type type message_sent_by_type
  using sent_by_type::message_sent_by_type;
