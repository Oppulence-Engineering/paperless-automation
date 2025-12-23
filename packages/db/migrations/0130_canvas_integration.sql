CREATE TABLE "service_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"service_name" text NOT NULL,
	"permissions" jsonb DEFAULT '["blocks:execute","users:provision"]' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 1000,
	"rate_limit_per_day" integer DEFAULT 100000,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
ALTER TABLE "service_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "state_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "block_type" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "block_version" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "caller_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "caller_user_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "caller_workspace_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "caller_workflow_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "caller_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "api_calls_made" integer;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "credits_consumed" numeric;--> statement-breakpoint
ALTER TABLE "service_api_keys" ADD CONSTRAINT "service_api_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_api_keys_service_active_idx" ON "service_api_keys" USING btree ("service_name","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "service_api_keys_key_hash_unique" ON "service_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "service_api_keys_key_prefix_idx" ON "service_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_caller_idx" ON "workflow_execution_logs" USING btree ("caller_id","caller_user_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_block_type_idx" ON "workflow_execution_logs" USING btree ("block_type");--> statement-breakpoint
CREATE POLICY "Service accounts can manage execution logs" ON "workflow_execution_logs" AS PERMISSIVE FOR ALL TO public USING (current_setting('request.headers', true)::json->>'x-service-key' IS NOT NULL);