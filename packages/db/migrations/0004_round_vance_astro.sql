ALTER TYPE "public"."library_category" ADD VALUE 'audio';--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "duration" real;--> statement-breakpoint
ALTER TABLE "scene" ADD COLUMN "music" jsonb DEFAULT '{"tracks":[],"volume":0.6,"startedAt":null}'::jsonb NOT NULL;