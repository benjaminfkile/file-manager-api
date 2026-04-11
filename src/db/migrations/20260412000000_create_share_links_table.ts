import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("share_links", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("token", 128).notNullable().unique();
    table
      .uuid("file_id")
      .nullable()
      .references("id")
      .inTable("files")
      .onDelete("CASCADE");
    table
      .uuid("folder_id")
      .nullable()
      .references("id")
      .inTable("folders")
      .onDelete("CASCADE");
    table
      .uuid("created_by_user_id")
      .notNullable()
      .references("id")
      .inTable("users");
    table.timestamp("expires_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE share_links
    ADD CONSTRAINT share_links_resource_check
    CHECK (
      (file_id IS NOT NULL AND folder_id IS NULL) OR
      (file_id IS NULL AND folder_id IS NOT NULL)
    )
  `);

  await knex.schema.table("share_links", (table) => {
    table.index(["file_id", "created_by_user_id"]);
    table.index(["folder_id", "created_by_user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("share_links");
}
