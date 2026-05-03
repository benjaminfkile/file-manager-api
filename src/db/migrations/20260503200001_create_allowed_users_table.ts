import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS citext;`);

  await knex.schema.createTable("allowed_users", (table) => {
    table.specificType("email", "citext").primary();
    table.string("first_name").nullable();
    table.string("last_name").nullable();
    table.text("notes").nullable();
    table.timestamp("invited_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("used_at", { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("allowed_users");
}
