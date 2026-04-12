import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("public_share_links", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("token")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .string("resource_type", 10)
      .notNullable()
      .checkIn(["file", "folder"]);
    table.uuid("resource_id").notNullable();
    table
      .uuid("owner_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("expires_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["token"], "idx_public_share_links_token");
    table.index(["resource_type", "resource_id"], "idx_public_share_links_resource");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("public_share_links");
}
