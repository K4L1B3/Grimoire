CREATE TYPE "public"."library_category" AS ENUM('maps', 'props', 'characters', 'creatures', 'attachments');--> statement-breakpoint
CREATE TYPE "public"."page_visibility" AS ENUM('hidden', 'visible', 'editable');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('gm', 'player', 'observer');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actor" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"avatar_asset_id" text,
	"owner_ids" text[] DEFAULT '{}' NOT NULL,
	"kind" text DEFAULT 'character' NOT NULL,
	"folder_id" text
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"library" text,
	"folder_id" text,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mime" text NOT NULL,
	"storage_key" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board" (
	"page_id" text PRIMARY KEY NOT NULL,
	"elements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cover_asset_id" text,
	"owner_id" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"author_id" text NOT NULL,
	"actor_id" text,
	"text" text,
	"roll" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"to_user_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawing" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"points" jsonb NOT NULL,
	"color" text NOT NULL,
	"width" real NOT NULL,
	"layer" text DEFAULT 'tokens' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fog" (
	"scene_id" text NOT NULL,
	"user_id" text NOT NULL,
	"bits" "bytea" NOT NULL,
	CONSTRAINT "fog_scene_id_user_id_pk" PRIMARY KEY("scene_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "library_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"category" "library_category" NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"sort_order" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "light" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"bright" real NOT NULL,
	"dim" real NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "macro" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"formula" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" DEFAULT 'player' NOT NULL,
	"dice_color" text DEFAULT '#c9a24a' NOT NULL,
	"dice_3d" boolean DEFAULT true NOT NULL,
	CONSTRAINT "membership_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"parent_id" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" real DEFAULT 0 NOT NULL,
	"visibility" "page_visibility" DEFAULT 'hidden' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_link" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	CONSTRAINT "page_link_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "pin" (
	"id" text PRIMARY KEY NOT NULL,
	"map_id" text,
	"scene_id" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"icon" text,
	"image_asset_id" text,
	"label" text,
	"note" jsonb,
	"link_page_id" text,
	"visibility" text DEFAULT 'gm' NOT NULL,
	"visible_to" text[] DEFAULT '{}' NOT NULL,
	"hidden_by_fog" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pin_one_parent" CHECK (("pin"."map_id" is null) <> ("pin"."scene_id" is null))
);
--> statement-breakpoint
CREATE TABLE "scene" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"asset_id" text,
	"grid" jsonb DEFAULT '{"size":70,"offsetX":0,"offsetY":0,"color":"#ffffff33","unit":1.5,"diagonal":"1:1"}'::jsonb NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"dungeon" boolean DEFAULT false NOT NULL,
	"combat" jsonb,
	"sort_order" real DEFAULT 0 NOT NULL,
	"folder_id" text
);
--> statement-breakpoint
CREATE TABLE "secret_block" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"visible_to" text[] DEFAULT '{}' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sheet" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"actor_id" text,
	"alias" text,
	"owner_ids" text[] DEFAULT '{}' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_note" (
	"sheet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"data" jsonb DEFAULT '{"strokes":[],"texts":[]}'::jsonb NOT NULL,
	CONSTRAINT "sheet_note_sheet_id_user_id_pk" PRIMARY KEY("sheet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_template" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"pdf_asset_id" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"builtin" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_event" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"date" text NOT NULL,
	"sort_key" real DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"link_page_id" text
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"actor_id" text,
	"name" text DEFAULT '' NOT NULL,
	"image_asset_id" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"size" integer DEFAULT 1 NOT NULL,
	"bars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"layer" text DEFAULT 'tokens' NOT NULL,
	"vision" jsonb,
	"light" jsonb
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wall" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"points" jsonb NOT NULL,
	"kind" text DEFAULT 'wall' NOT NULL,
	"state" text
);
--> statement-breakpoint
CREATE TABLE "world_map" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"asset_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "y_doc" (
	"name" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing" ADD CONSTRAINT "drawing_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fog" ADD CONSTRAINT "fog_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fog" ADD CONSTRAINT "fog_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folder" ADD CONSTRAINT "library_folder_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "light" ADD CONSTRAINT "light_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro" ADD CONSTRAINT "macro_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro" ADD CONSTRAINT "macro_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_link" ADD CONSTRAINT "page_link_from_id_page_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_link" ADD CONSTRAINT "page_link_to_id_page_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_map_id_world_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."world_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_link_page_id_page_id_fk" FOREIGN KEY ("link_page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene" ADD CONSTRAINT "scene_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene" ADD CONSTRAINT "scene_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_block" ADD CONSTRAINT "secret_block_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_template_id_sheet_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sheet_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_note" ADD CONSTRAINT "sheet_note_sheet_id_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_note" ADD CONSTRAINT "sheet_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_template" ADD CONSTRAINT "sheet_template_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_template" ADD CONSTRAINT "sheet_template_pdf_asset_id_asset_id_fk" FOREIGN KEY ("pdf_asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_link_page_id_page_id_fk" FOREIGN KEY ("link_page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall" ADD CONSTRAINT "wall_scene_id_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scene"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_map" ADD CONSTRAINT "world_map_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_map" ADD CONSTRAINT "world_map_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_campaign_id_created_at_index" ON "chat_message" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "library_folder_campaign_id_category_index" ON "library_folder" USING btree ("campaign_id","category");--> statement-breakpoint
CREATE INDEX "page_campaign_id_parent_id_index" ON "page" USING btree ("campaign_id","parent_id");--> statement-breakpoint
CREATE INDEX "page_link_to_id_index" ON "page_link" USING btree ("to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_scene" ON "scene" USING btree ("campaign_id") WHERE "scene"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_actor_id_alias_index" ON "sheet" USING btree ("actor_id","alias");