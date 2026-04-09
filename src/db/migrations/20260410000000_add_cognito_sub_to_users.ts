import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.string("cognito_sub").nullable();
    table.index("cognito_sub", "idx_users_cognito_sub");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropIndex("cognito_sub", "idx_users_cognito_sub");
    table.dropColumn("cognito_sub");
  });
}
