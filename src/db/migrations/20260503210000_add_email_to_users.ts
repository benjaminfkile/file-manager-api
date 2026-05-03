import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS citext;`);

  // citext so the join against allowed_users.email (also citext) is
  // case-insensitive without per-query lower() wrappers.
  await knex.raw(`ALTER TABLE users ADD COLUMN email citext NULL;`);
  await knex.raw(`CREATE INDEX idx_users_email ON users (email);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropIndex("email", "idx_users_email");
    table.dropColumn("email");
  });
}
