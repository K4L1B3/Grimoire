ALTER TABLE "scene" ALTER COLUMN "music" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "audio_group" text;
--> statement-breakpoint
UPDATE "scene" SET "music" = '{}';
