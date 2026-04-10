import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropIndex([], "idx_users_api_key_prefix");
    table.dropColumn("api_key_hash");
    table.dropColumn("api_key_prefix");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.string("api_key_hash").notNullable().defaultTo("");
    table.string("api_key_prefix", 8).notNullable().defaultTo("");
    table.index("api_key_prefix", "idx_users_api_key_prefix");
  });
}
