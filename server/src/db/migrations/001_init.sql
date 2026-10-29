-- Initial schema. See architecture.md §4 for the model and decision.md D5 for why drafts are separate from messages.

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    text NOT NULL,
  external_id text NOT NULL,              -- customer.id from the webhook payload
  name        text NOT NULL,
  phone       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, external_id)
);

CREATE TABLE conversations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid NOT NULL REFERENCES customers(id),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at      timestamptz NOT NULL,
  last_message_preview text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Each customer has exactly one open conversation, enforced by the database even under concurrent webhooks.
CREATE UNIQUE INDEX conversations_one_open_per_customer ON conversations (customer_id) WHERE status = 'open';
CREATE INDEX conversations_by_activity ON conversations (last_message_at DESC);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender          text NOT NULL CHECK (sender IN ('customer', 'agent')),
  text            text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  external_id     text UNIQUE,              -- message.id from the payload; null for agent replies
  agent_id        uuid REFERENCES agents(id), -- who approved it, for agent replies
  sent_at         timestamptz NOT NULL,     -- payload timestamp, or server time
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((sender = 'agent') = (agent_id IS NOT NULL))
);

CREATE INDEX messages_by_conversation ON messages (conversation_id, sent_at, created_at);

CREATE TABLE drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id),
  message_id          uuid NOT NULL UNIQUE REFERENCES messages(id), -- the customer message it answers
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'ready', 'failed', 'approved', 'superseded')),
  text                text,
  needs_attention     boolean NOT NULL DEFAULT false,
  reason              text,                -- the model's short note for the agent
  model               text,
  kb_version          text,
  attempts            int NOT NULL DEFAULT 0,
  last_error          text,
  approved_message_id uuid REFERENCES messages(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- At most one live draft per conversation (decision D15).
CREATE UNIQUE INDEX drafts_one_live_per_conversation ON drafts (conversation_id)
  WHERE status IN ('pending', 'ready', 'failed');
-- What the sweeper scans for.
CREATE INDEX drafts_retryable ON drafts (updated_at) WHERE status IN ('pending', 'failed');

CREATE TABLE webhook_events (
  event_id    text PRIMARY KEY,             -- idempotency key
  source      text NOT NULL CHECK (source IN ('webhook', 'customer_view')),
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase exposes the public schema through its REST API using the anon key. Turning on RLS with no
-- policies blocks that path entirely; our server connects as the table owner, which bypasses RLS.
ALTER TABLE agents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
