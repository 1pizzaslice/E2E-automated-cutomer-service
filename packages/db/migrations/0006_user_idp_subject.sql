-- Milestone 16: map IdP-issued JWT subjects onto platform users
-- (BACKEND_SPEC section 3.1). `idp_subject` holds the immutable subject
-- (`sub` claim) of the hosted-IdP identity (Clerk user id for the pilot).
-- Tokens carry identity only; roles stay DB-sourced via user_roles. The
-- column is nullable: users without an IdP identity simply cannot sign in
-- while production JWT auth is on (fail closed). Rollback: drop the index
-- and column; no data depends on them.
alter table users
  add column if not exists idp_subject text;

create unique index if not exists users_idp_subject_idx
  on users (idp_subject)
  where idp_subject is not null;
