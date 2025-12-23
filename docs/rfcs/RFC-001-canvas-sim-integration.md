# RFC-001: Canvas API Integration with Sim Studio

| Field | Value |
|-------|-------|
| **RFC Number** | 001 |
| **Title** | Canvas API Integration with Sim Studio |
| **Author** | Oppulence Engineering |
| **Status** | Draft |
| **Created** | 2024-12-22 |
| **Last Updated** | 2024-12-22 |

---

## Table of Contents

1. [Summary](#1-summary)
2. [Motivation](#2-motivation)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Background](#4-background)
5. [Detailed Design](#5-detailed-design)
6. [API Specifications](#6-api-specifications)
7. [Database Schema](#7-database-schema)
8. [Security Considerations](#8-security-considerations)
9. [Migration Strategy](#9-migration-strategy)
10. [Testing Strategy](#10-testing-strategy)
11. [Rollout Plan](#11-rollout-plan)
12. [Open Questions](#12-open-questions)
13. [Appendix](#13-appendix)

---

## 1. Summary

This RFC proposes an integration architecture between **Oppulence Canvas API** (a domain-specific financial workflow system) and **Sim Studio** (a general-purpose AI workflow builder). The integration enables:

1. **User Provisioning**: When users sign up on Canvas, corresponding accounts are created in Sim Studio via API.
2. **Block Execution API**: Canvas workflows can execute any of Sim Studio's 140+ blocks (Gmail, Slack, AI agents, etc.) via HTTP API.
3. **Unified Workflow Experience**: Canvas's domain-specific workflows (dunning, settlements) leverage Sim Studio's extensive integration ecosystem.

---

## 2. Motivation

### 2.1 Current State

- **Canvas API**: Handles financial operations (invoicing, dunning, settlements) with a domain-specific workflow engine supporting 5 node types: `trigger`, `wait`, `action`, `decision`, `terminal`.
- **Sim Studio**: General-purpose workflow builder with 140+ integration blocks (email, messaging, AI, databases, APIs).

### 2.2 Problem Statement

1. **Duplication of Effort**: Canvas needs email notifications, Slack alerts, and AI-powered analysis—all capabilities Sim Studio already provides.
2. **Limited Integration Options**: Canvas workflows are constrained to native actions; adding new integrations requires significant development.
3. **Separate User Bases**: Users maintain separate accounts in both systems, creating friction.

### 2.3 Desired Outcome

A unified system where:
- Users authenticate once (via Canvas)
- Canvas workflows leverage Sim Studio's entire block ecosystem
- Platform pays for AI/API calls (no user API key management)
- Both systems evolve independently while maintaining integration

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Priority |
|----|------|----------|
| G1 | Automatic user provisioning from Canvas to Sim Studio | P0 |
| G2 | API endpoint for Canvas to execute any Sim block | P0 |
| G3 | Service-to-service authentication between systems | P0 |
| G4 | User context preservation across system boundary | P1 |
| G5 | Execution logging and observability | P1 |
| G6 | Rate limiting and quota management | P2 |
| G7 | Billing attribution per user/workspace | P2 |

### 3.2 Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Merging databases into single Supabase project | Maintains system independence |
| NG2 | Users directly logging into Sim Studio | Canvas is the primary interface |
| NG3 | Real-time streaming between systems | Initial implementation uses request/response |
| NG4 | Migrating Canvas workflow engine to Sim | Future consideration, not MVP |

---

## 4. Background

### 4.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CANVAS API                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │  User Signup    │  │ Workflow Engine │  │  Domain Logic       │ │
│  │  (Supabase A)   │  │ (5 node types)  │  │  (Dunning, etc.)    │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────────┘ │
│           │                    │                                    │
│           │  On signup         │  On action node                    │
│           ▼                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              HTTP API Calls to Sim Studio                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SIM STUDIO                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │  User Provision │  │ Block Execution │  │  Block Registry     │ │
│  │  API            │  │ API             │  │  (140+ blocks)      │ │
│  │  (Supabase B)   │  │                 │  │                     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Supabase Configuration

| System | Supabase Project | Purpose |
|--------|------------------|---------|
| Canvas API | `oppulence-canvas` | User auth, invoices, customers, workflows |
| Sim Studio | `oppulence-sim` | User mirror, workflow state, block configs |

### 4.3 Current Workflow Comparison

| Aspect | Canvas API | Sim Studio |
|--------|------------|------------|
| **Node Types** | 5 (trigger, wait, action, decision, terminal) | 140+ blocks |
| **Domain Focus** | Financial (dunning, settlements) | General purpose |
| **Execution Model** | Linear with branching | DAG with parallel/loops |
| **Data Hydration** | Database entities (invoices) | Input parameters |
| **Streaming** | No | Yes |

---

## 5. Detailed Design

### 5.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NEW COMPONENTS IN SIM STUDIO                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  1. User Provisioning Service                                 │  │
│  │     - POST /api/v1/users/provision                           │  │
│  │     - Creates user in Sim Supabase                           │  │
│  │     - Stores canvas_user_id ↔ sim_user_id mapping            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  2. Block Execution Service                                   │  │
│  │     - POST /api/v1/blocks/execute                            │  │
│  │     - GET  /api/v1/blocks (list available blocks)            │  │
│  │     - GET  /api/v1/blocks/:type/schema                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  3. Service Authentication Middleware                         │  │
│  │     - Validates X-Service-Key header                         │  │
│  │     - Extracts X-Canvas-User-Id for user context             │  │
│  │     - Rate limiting per service/user                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  4. User Link Repository                                      │  │
│  │     - Uses existing `account` table with providerId='canvas' │  │
│  │     - Maps Canvas user IDs to Sim user IDs                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 User Provisioning Flow

```
Sequence: User Signup → Sim Provisioning

┌────────┐     ┌────────────┐     ┌────────────┐     ┌──────────────┐
│  User  │     │  Canvas    │     │  Sim API   │     │ Sim Supabase │
└───┬────┘     └─────┬──────┘     └─────┬──────┘     └──────┬───────┘
    │                │                  │                   │
    │ 1. Sign up     │                  │                   │
    │───────────────>│                  │                   │
    │                │                  │                   │
    │                │ 2. Create user   │                   │
    │                │  in Canvas       │                   │
    │                │  Supabase        │                   │
    │                │                  │                   │
    │                │ 3. POST /api/v1/users/provision      │
    │                │  {                │                   │
    │                │    canvasUserId,  │                   │
    │                │    email,         │                   │
    │                │    name,          │                   │
    │                │    workspaceId    │                   │
    │                │  }               │                   │
    │                │─────────────────>│                   │
    │                │                  │                   │
    │                │                  │ 4. admin.createUser()
    │                │                  │──────────────────>│
    │                │                  │                   │
    │                │                  │<──────────────────│
    │                │                  │  sim_user_id      │
    │                │                  │                   │
    │                │                  │ 5. INSERT INTO    │
    │                │                  │    account (providerId='canvas')
    │                │                  │                   │
    │                │<─────────────────│                   │
    │                │  { simUserId }   │                   │
    │                │                  │                   │
    │<───────────────│                  │                   │
    │  Signup complete                  │                   │
    │                │                  │                   │
```

### 5.3 Block Execution Flow

```
Sequence: Canvas Workflow → Block Execution

┌──────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────┐
│ Canvas       │     │  Sim API   │     │ Block        │     │ External │
│ Workflow     │     │            │     │ Executor     │     │ Service  │
└──────┬───────┘     └─────┬──────┘     └──────┬───────┘     └────┬─────┘
       │                   │                   │                  │
       │ 1. Action node:   │                   │                  │
       │    "Send Email"   │                   │                  │
       │                   │                   │                  │
       │ 2. POST /api/v1/blocks/execute        │                  │
       │    Headers:       │                   │                  │
       │      X-Service-Key: ***               │                  │
       │      X-Canvas-User-Id: canvas-123     │                  │
       │    Body:          │                   │                  │
       │    {              │                   │                  │
       │      blockType: "gmail",              │                  │
       │      params: {    │                   │                  │
       │        to: "...", │                   │                  │
       │        subject: "..",                 │                  │
       │        body: "..."│                   │                  │
       │      }            │                   │                  │
       │    }              │                   │                  │
       │──────────────────>│                   │                  │
       │                   │                   │                  │
       │                   │ 3. Validate service key              │
       │                   │ 4. Lookup sim_user_id                │
       │                   │ 5. Load user credentials             │
       │                   │                   │                  │
       │                   │ 6. Execute block  │                  │
       │                   │──────────────────>│                  │
       │                   │                   │                  │
       │                   │                   │ 7. Call Gmail API│
       │                   │                   │─────────────────>│
       │                   │                   │                  │
       │                   │                   │<─────────────────│
       │                   │                   │  Email sent      │
       │                   │                   │                  │
       │                   │<──────────────────│                  │
       │                   │  BlockOutput      │                  │
       │                   │                   │                  │
       │<──────────────────│                   │                  │
       │  {                │                   │                  │
       │    success: true, │                   │                  │
       │    output: {...}  │                   │                  │
       │  }                │                   │                  │
       │                   │                   │                  │
```

### 5.4 Error Handling

| Error Scenario | HTTP Status | Response | Canvas Handling |
|----------------|-------------|----------|-----------------|
| Invalid service key | 401 | `{ error: "Unauthorized" }` | Fail workflow |
| User not provisioned | 404 | `{ error: "User not found", code: "USER_NOT_PROVISIONED" }` | Trigger provisioning, retry |
| Block type not found | 400 | `{ error: "Unknown block type", code: "INVALID_BLOCK_TYPE" }` | Fail workflow |
| Missing credentials | 400 | `{ error: "Credentials required", code: "MISSING_CREDENTIALS" }` | Notify user |
| Block execution failed | 500 | `{ error: "...", code: "EXECUTION_FAILED" }` | Retry or fail |
| Rate limit exceeded | 429 | `{ error: "Rate limit exceeded", retryAfter: 60 }` | Backoff and retry |

---

## 6. API Specifications

### 6.1 User Provisioning API

#### `POST /api/v1/users/provision`

Creates a new user in Sim Studio linked to a Canvas user.

**Request Headers:**
```
Content-Type: application/json
X-Service-Key: <service-api-key>
X-Request-Id: <optional-request-id>
```

**Request Body:**
```json
{
  "canvasUserId": "string (required) - UUID of Canvas user",
  "email": "string (required) - User email address",
  "name": "string (optional) - Display name",
  "workspaceId": "string (optional) - Canvas workspace ID",
  "metadata": {
    "plan": "string (optional) - Subscription plan",
    "source": "string (optional) - Signup source"
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "simUserId": "uuid",
    "canvasUserId": "uuid",
    "email": "string",
    "createdAt": "ISO8601 timestamp",
    "linkId": "uuid"
  }
}
```

**Response (409 Conflict - Already Exists):**
```json
{
  "success": true,
  "data": {
    "simUserId": "uuid",
    "canvasUserId": "uuid",
    "email": "string",
    "createdAt": "ISO8601 timestamp",
    "linkId": "uuid",
    "alreadyExisted": true
  }
}
```

---

### 6.2 Block Listing API

#### `GET /api/v1/blocks`

Returns list of available blocks.

**Request Headers:**
```
X-Service-Key: <service-api-key>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| category | string | Filter by category (e.g., "email", "ai", "messaging") |
| search | string | Search block names/descriptions |
| limit | number | Pagination limit (default: 50, max: 100) |
| offset | number | Pagination offset |

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "blocks": [
      {
        "type": "gmail",
        "name": "Gmail",
        "description": "Send emails via Gmail",
        "category": "email",
        "version": "1.0.0",
        "requiresCredentials": true,
        "credentialTypes": ["google_oauth"],
        "params": {
          "to": { "type": "string", "required": true },
          "subject": { "type": "string", "required": true },
          "body": { "type": "string", "required": true },
          "cc": { "type": "string", "required": false },
          "bcc": { "type": "string", "required": false }
        }
      }
    ],
    "total": 142,
    "limit": 50,
    "offset": 0
  }
}
```

---

### 6.3 Block Schema API

#### `GET /api/v1/blocks/:type/schema`

Returns detailed schema for a specific block.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "type": "gmail",
    "name": "Gmail",
    "description": "Send emails via Gmail",
    "category": "email",
    "version": "1.0.0",
    "requiresCredentials": true,
    "credentialTypes": ["google_oauth"],
    "inputSchema": {
      "type": "object",
      "required": ["to", "subject", "body"],
      "properties": {
        "to": {
          "type": "string",
          "description": "Recipient email address",
          "format": "email"
        },
        "subject": {
          "type": "string",
          "description": "Email subject line",
          "maxLength": 998
        },
        "body": {
          "type": "string",
          "description": "Email body (HTML supported)"
        },
        "cc": {
          "type": "string",
          "description": "CC recipients (comma-separated)"
        },
        "bcc": {
          "type": "string",
          "description": "BCC recipients (comma-separated)"
        },
        "attachments": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "url": { "type": "string", "format": "uri" },
              "mimeType": { "type": "string" }
            }
          }
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "messageId": { "type": "string" },
        "threadId": { "type": "string" },
        "labelIds": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

---

### 6.4 Block Execution API

#### `POST /api/v1/blocks/execute`

Executes a block with the provided parameters.

**Request Headers:**
```
Content-Type: application/json
X-Service-Key: <service-api-key>
X-Canvas-User-Id: <canvas-user-uuid>
X-Canvas-Workspace-Id: <optional-workspace-uuid>
X-Request-Id: <optional-request-id>
X-Idempotency-Key: <optional-idempotency-key>
```

**Request Body:**
```json
{
  "blockType": "string (required) - Block type identifier",
  "params": {
    "key": "value - Block-specific parameters"
  },
  "context": {
    "workflowId": "string (optional) - Canvas workflow ID",
    "executionId": "string (optional) - Canvas execution ID",
    "nodeId": "string (optional) - Canvas node ID"
  },
  "options": {
    "timeout": "number (optional) - Timeout in ms (default: 30000)",
    "retryOnFailure": "boolean (optional) - Auto-retry on transient failures"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "blockType": "gmail",
    "status": "completed",
    "output": {
      "messageId": "...",
      "threadId": "..."
    },
    "timing": {
      "startedAt": "ISO8601",
      "completedAt": "ISO8601",
      "durationMs": 1234
    },
    "usage": {
      "tokensUsed": null,
      "apiCallsMade": 1,
      "creditsConsumed": 0.01
    }
  }
}
```

**Response (202 Accepted - Long-running):**
```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "blockType": "agent",
    "status": "running",
    "pollUrl": "/api/v1/executions/uuid/status",
    "estimatedCompletionMs": 30000
  }
}
```

---

### 6.5 Execution Status API (for long-running blocks)

#### `GET /api/v1/executions/:executionId/status`

**Response (200 OK - Still Running):**
```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "status": "running",
    "progress": 0.65,
    "currentStep": "Processing with AI agent...",
    "pollUrl": "/api/v1/executions/uuid/status"
  }
}
```

**Response (200 OK - Completed):**
```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "status": "completed",
    "output": { ... },
    "timing": { ... },
    "usage": { ... }
  }
}
```

---

## 7. Database Schema

### 7.1 Existing Tables to Leverage

#### 7.1.1 User Linking via `account` Table

The existing `account` table in Sim Studio already supports external identity provider linking.
We use it for Canvas user linking with `providerId = 'canvas'`:

```sql
-- Existing account table structure (packages/db/schema.ts lines 67-98)
-- No migration needed - just insert with providerId='canvas'

-- Example Canvas user link:
INSERT INTO account (
  id,
  account_id,      -- Canvas user ID (external identifier)
  provider_id,     -- 'canvas'
  user_id,         -- Sim user ID (references user.id)
  access_token,    -- Optional: Canvas API token if needed
  refresh_token,   -- Optional: Refresh token if applicable
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'canvas-user-uuid',
  'canvas',
  'sim-user-uuid',
  NULL,
  NULL,
  NOW(),
  NOW()
);

-- Lookup query for user provisioning:
SELECT user_id as sim_user_id
FROM account
WHERE provider_id = 'canvas' AND account_id = $1;
```

### 7.2 New Tables

#### 7.2.1 Service API Keys

Service-to-service authentication requires different semantics than user API keys:
- Not tied to human users
- Supports scoped permissions
- Different rate limits
- No personal workspace context

```sql
CREATE TABLE service_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Key identification
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(64) NOT NULL, -- SHA-256 of the key
  key_prefix VARCHAR(8) NOT NULL, -- First 8 chars for identification

  -- Service info
  service_name VARCHAR(50) NOT NULL,

  -- Permissions
  permissions JSONB NOT NULL DEFAULT '["blocks:execute", "users:provision"]',

  -- Rate limiting
  rate_limit_per_minute INTEGER DEFAULT 1000,
  rate_limit_per_day INTEGER DEFAULT 100000,

  -- Validity
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,

  -- Constraints
  UNIQUE(key_hash)
);

```

### 7.3 Extending Existing Tables

#### 7.3.1 Extend `workflow_execution_logs` for Block Execution

The existing `workflow_execution_logs` table (packages/db/schema.ts lines 288-342) can be extended
to support standalone block executions from Canvas by:

1. Making `workflow_id` nullable (for block-only executions)
2. Adding Canvas-specific context fields

```sql
-- Migration to extend workflow_execution_logs for block executions

-- Step 1: Make workflow_id nullable for standalone block executions
ALTER TABLE workflow_execution_logs
  ALTER COLUMN workflow_id DROP NOT NULL;

-- Step 2: Add block execution context columns
ALTER TABLE workflow_execution_logs
  ADD COLUMN block_type VARCHAR(50),
  ADD COLUMN block_version VARCHAR(20),
  ADD COLUMN caller_id VARCHAR(100),          -- 'canvas' or other external systems
  ADD COLUMN caller_user_id UUID,             -- Canvas user ID
  ADD COLUMN caller_workspace_id UUID,        -- Canvas workspace ID
  ADD COLUMN caller_workflow_id UUID,         -- Canvas workflow ID
  ADD COLUMN caller_node_id VARCHAR(100),     -- Canvas node ID
  ADD COLUMN api_calls_made INTEGER,
  ADD COLUMN credits_consumed DECIMAL(10, 4);

-- Step 3: Add index for block execution queries
CREATE INDEX idx_execution_logs_caller
  ON workflow_execution_logs(caller_id, caller_user_id)
  WHERE caller_id IS NOT NULL;

CREATE INDEX idx_execution_logs_block_type
  ON workflow_execution_logs(block_type)
  WHERE block_type IS NOT NULL;
```

**Usage Examples:**

```sql
-- Log a block execution from Canvas
INSERT INTO workflow_execution_logs (
  id,
  workflow_id,           -- NULL for standalone block execution
  state_snapshot_id,     -- Can be NULL or a reference
  trigger,               -- 'api'
  duration,
  status,
  block_type,            -- 'gmail', 'slack', etc.
  caller_id,             -- 'canvas'
  caller_user_id,        -- Canvas user UUID
  caller_workflow_id,    -- Canvas workflow UUID
  caller_node_id,        -- Canvas node ID
  created_at
) VALUES (
  gen_random_uuid(),
  NULL,
  'standalone-block-exec',
  'api',
  1234,
  'completed',
  'gmail',
  'canvas',
  'canvas-user-uuid',
  'canvas-workflow-uuid',
  'action-node-1',
  NOW()
);

-- Query block executions by Canvas user
SELECT * FROM workflow_execution_logs
WHERE caller_id = 'canvas' AND caller_user_id = $1
ORDER BY created_at DESC;
```

### 7.4 Row Level Security Policies

```sql
-- service_api_keys: Admin-only access (managed via migrations)
ALTER TABLE service_api_keys ENABLE ROW LEVEL SECURITY;

-- No direct user access - managed programmatically by backend

-- workflow_execution_logs: Existing RLS + service account access
-- The table already has RLS; add policy for service accounts:
CREATE POLICY "Service accounts can manage execution logs"
  ON workflow_execution_logs
  FOR ALL
  USING (
    current_setting('request.headers', true)::json->>'x-service-key' IS NOT NULL
  );
```

---

## 8. Security Considerations

### 8.1 Authentication & Authorization

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Service-to-Service** | API Key | SHA-256 hashed, rotatable, with permissions |
| **User Context** | Header Passthrough | `X-Canvas-User-Id` trusted from authenticated service |
| **Rate Limiting** | Per-service + Per-user | Prevents abuse |
| **IP Allowlisting** | Optional | Canvas API server IPs only |

### 8.2 API Key Management

```typescript
// Key generation (admin only)
function generateServiceApiKey(): { key: string; keyHash: string; prefix: string } {
  const key = `sim_svc_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 16);
  return { key, keyHash, prefix };
}

// Key validation (on every request)
async function validateServiceKey(providedKey: string): Promise<ServiceApiKey | null> {
  const keyHash = crypto.createHash('sha256').update(providedKey).digest('hex');
  const keyRecord = await db.query(
    'SELECT * FROM service_api_keys WHERE key_hash = $1 AND is_active = true',
    [keyHash]
  );

  if (!keyRecord || (keyRecord.expires_at && keyRecord.expires_at < new Date())) {
    return null;
  }

  // Update last_used_at
  await db.query(
    'UPDATE service_api_keys SET last_used_at = NOW() WHERE id = $1',
    [keyRecord.id]
  );

  return keyRecord;
}
```

### 8.3 Credential Isolation

- User credentials (OAuth tokens, API keys) stored per-user in Sim Studio
- Canvas cannot access raw credentials
- Block execution uses credentials on behalf of linked user
- Credentials encrypted at rest using per-user encryption keys

### 8.4 Audit Logging

All API calls logged with:
- Request ID / Trace ID
- Service key used (prefix only)
- Canvas user ID
- Block type and parameters (sanitized)
- Response status and timing
- IP address and user agent

---

## 9. Migration Strategy

### 9.1 Phase 1: Infrastructure

| Task | Owner | Dependencies |
|------|-------|--------------|
| Create `service_api_keys` table | Sim Backend | None |
| Extend `workflow_execution_logs` table | Sim Backend | None |
| Implement service key validation middleware | Sim Backend | Tables |
| Generate initial Canvas service key | DevOps | Middleware |

### 9.2 Phase 2: User Provisioning

| Task | Owner | Dependencies |
|------|-------|--------------|
| Implement `POST /api/v1/users/provision` | Sim Backend | Phase 1 |
| Add webhook on Canvas user signup | Canvas Backend | Sim endpoint |
| Backfill existing Canvas users | DevOps | Both endpoints |
| Add error handling and retries | Both | Initial impl |

### 9.3 Phase 3: Block Execution

| Task | Owner | Dependencies |
|------|-------|--------------|
| Implement `GET /api/v1/blocks` | Sim Backend | None |
| Implement `GET /api/v1/blocks/:type/schema` | Sim Backend | None |
| Implement `POST /api/v1/blocks/execute` | Sim Backend | Phase 2 |
| Create Canvas SDK for Sim API | Canvas Backend | Sim endpoints |
| Integrate SDK into Canvas workflow engine | Canvas Backend | SDK |

### 9.4 Phase 4: Production Hardening

| Task | Owner | Dependencies |
|------|-------|--------------|
| Add rate limiting | Sim Backend | Phase 3 |
| Add comprehensive logging | Both | Phase 3 |
| Performance testing | QA | All phases |
| Security audit | Security | All phases |
| Documentation | All | All phases |

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
describe('UserProvisioningService', () => {
  it('should create new user and link', async () => {
    const result = await provisionUser({
      canvasUserId: 'canvas-123',
      email: 'test@example.com',
      name: 'Test User'
    });

    expect(result.simUserId).toBeDefined();
    expect(result.canvasUserId).toBe('canvas-123');
  });

  it('should return existing link if user already provisioned', async () => {
    // First call
    const first = await provisionUser({ canvasUserId: 'canvas-123', email: 'test@example.com' });
    // Second call
    const second = await provisionUser({ canvasUserId: 'canvas-123', email: 'test@example.com' });

    expect(second.simUserId).toBe(first.simUserId);
    expect(second.alreadyExisted).toBe(true);
  });
});

describe('BlockExecutionService', () => {
  it('should execute gmail block successfully', async () => {
    const result = await executeBlock({
      blockType: 'gmail',
      params: { to: 'test@example.com', subject: 'Test', body: 'Hello' },
      userId: 'sim-user-123'
    });

    expect(result.success).toBe(true);
    expect(result.output.messageId).toBeDefined();
  });

  it('should fail for unknown block type', async () => {
    await expect(executeBlock({
      blockType: 'nonexistent',
      params: {},
      userId: 'sim-user-123'
    })).rejects.toThrow('Unknown block type');
  });
});
```

### 10.2 Integration Tests

```typescript
describe('Canvas → Sim Integration', () => {
  it('should provision user from Canvas signup', async () => {
    // Simulate Canvas signup webhook
    const response = await request(simApp)
      .post('/api/v1/users/provision')
      .set('X-Service-Key', CANVAS_SERVICE_KEY)
      .send({
        canvasUserId: 'new-canvas-user',
        email: 'newuser@example.com'
      });

    expect(response.status).toBe(201);

    // Verify user exists in Sim Supabase
    const simUser = await simSupabase.auth.admin.getUserById(response.body.data.simUserId);
    expect(simUser.data.user.email).toBe('newuser@example.com');
  });

  it('should execute block with Canvas user context', async () => {
    // Provision user first
    await provisionTestUser('canvas-user-1');

    // Execute block
    const response = await request(simApp)
      .post('/api/v1/blocks/execute')
      .set('X-Service-Key', CANVAS_SERVICE_KEY)
      .set('X-Canvas-User-Id', 'canvas-user-1')
      .send({
        blockType: 'gmail',
        params: { to: 'test@example.com', subject: 'Integration Test', body: 'Hello' }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

### 10.3 Load Testing

```yaml
# k6 load test configuration
scenarios:
  block_execution:
    executor: 'ramping-vus'
    startVUs: 10
    stages:
      - duration: '1m', target: 50
      - duration: '3m', target: 50
      - duration: '1m', target: 100
      - duration: '5m', target: 100
      - duration: '1m', target: 0

thresholds:
  http_req_duration: ['p(95)<500', 'p(99)<1000']
  http_req_failed: ['rate<0.01']
```

---

## 11. Rollout Plan

### 11.1 Rollout Stages

| Stage | Audience | Duration | Success Criteria |
|-------|----------|----------|------------------|
| **Alpha** | Internal team only | 1 week | No critical bugs |
| **Beta** | 5% of Canvas users | 2 weeks | Error rate < 0.1% |
| **GA** | All Canvas users | Ongoing | Error rate < 0.01% |

### 11.2 Feature Flags

```typescript
const FEATURE_FLAGS = {
  // User provisioning
  'sim-integration.user-provisioning': {
    enabled: true,
    rolloutPercentage: 100
  },

  // Block execution
  'sim-integration.block-execution': {
    enabled: true,
    rolloutPercentage: 5, // Start with 5%
    allowlist: ['internal-workspace-id']
  }
};
```

### 11.3 Rollback Plan

1. **Immediate**: Disable feature flag
2. **Short-term**: Route Canvas workflows to native actions
3. **Long-term**: Investigate and fix issues

---

## 12. Open Questions

| ID | Question | Status | Decision |
|----|----------|--------|----------|
| Q1 | Should we support streaming for AI blocks? | Open | TBD |
| Q2 | How to handle credential rotation across systems? | Open | TBD |
| Q3 | Should Canvas workflows be migratable to Sim? | Deferred | Future RFC |
| Q4 | How to bill AI usage per Canvas workspace? | Open | TBD |
| Q5 | Support for custom/private blocks? | Deferred | Future RFC |

---

## 13. Appendix

### 13.1 Block Categories

| Category | Example Blocks | Count |
|----------|---------------|-------|
| Email | Gmail, Outlook, SendGrid | 5 |
| Messaging | Slack, Discord, Telegram | 8 |
| AI/LLM | OpenAI, Anthropic, Gemini | 12 |
| Database | Supabase, PostgreSQL, MongoDB | 10 |
| CRM | Salesforce, HubSpot | 6 |
| Payments | Stripe, PayPal | 4 |
| Storage | S3, Google Drive, Dropbox | 8 |
| ... | ... | ... |
| **Total** | | **140+** |

### 13.2 Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `UNAUTHORIZED` | Invalid or missing service key | 401 |
| `USER_NOT_PROVISIONED` | Canvas user not linked to Sim | 404 |
| `INVALID_BLOCK_TYPE` | Unknown block type | 400 |
| `MISSING_CREDENTIALS` | User hasn't connected required service | 400 |
| `INVALID_PARAMS` | Block parameters validation failed | 400 |
| `EXECUTION_FAILED` | Block execution error | 500 |
| `RATE_LIMITED` | Too many requests | 429 |
| `TIMEOUT` | Execution exceeded timeout | 504 |

### 13.3 Glossary

| Term | Definition |
|------|------------|
| **Canvas** | Oppulence Canvas API - financial workflow system |
| **Sim** | Sim Studio - general-purpose workflow builder |
| **Block** | A single execution unit in Sim (e.g., "Gmail", "Slack") |
| **Provisioning** | Creating a Sim user linked to a Canvas user |
| **Service Key** | API key for service-to-service authentication |

---

## Changelog

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2024-12-22 | Oppulence Engineering | Initial draft |
| 0.2 | 2024-12-22 | Oppulence Engineering | Revised database approach: use existing `account` table for user linking, extend `workflow_execution_logs` for block execution logs, keep new `service_api_keys` table |
