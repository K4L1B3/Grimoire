ALTER TYPE "public"."library_category" ADD VALUE 'notes';--> statement-breakpoint
CREATE TABLE "note_placement" (
	"user_id" text NOT NULL,
	"page_id" text NOT NULL,
	"folder_id" text,
	CONSTRAINT "note_placement_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "library_folder" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "in_notes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "note_placement" ADD CONSTRAINT "note_placement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_placement" ADD CONSTRAINT "note_placement_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folder" ADD CONSTRAINT "library_folder_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Nota da wiki é só leitura para o jogador: "editável" só sobra em quadro e linha do tempo.
UPDATE "page" SET "visibility" = 'visible' WHERE "visibility" = 'editable' AND "kind" NOT IN ('board', 'timeline');
