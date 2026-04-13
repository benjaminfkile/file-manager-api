import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("share_links", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("token")
      .notNullable()
      .unique()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("item_type", 10).notNullable(); // 'file' or 'folder'
    table.uuid("item_id").notNullable();
    table
      .uuid("owner_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("expires_at", { useTz: true }).nullable();
    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(["token"]);
    table.index(["item_type", "item_id", "owner_user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("share_links");
}
