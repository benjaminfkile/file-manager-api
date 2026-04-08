import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("folder_shares", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("folder_id")
      .notNullable()
      .references("id")
      .inTable("folders")
      .onDelete("CASCADE");
    table
      .uuid("owner_user_id")
      .notNullable()
      .references("id")
      .inTable("users");
    table
      .uuid("shared_with_user_id")
      .notNullable()
      .references("id")
      .inTable("users");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["folder_id", "shared_with_user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("folder_shares");
}
