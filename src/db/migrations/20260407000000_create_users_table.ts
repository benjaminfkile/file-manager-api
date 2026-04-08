import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("first_name").notNullable();
    table.string("last_name").notNullable();
    table.string("username").unique().notNullable();
    table.string("api_key_hash").notNullable();
    table.string("api_key_prefix", 8).notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index("username", "idx_users_username");
    table.index("api_key_prefix", "idx_users_api_key_prefix");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("users");
}
