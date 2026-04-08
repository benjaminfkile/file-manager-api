import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("folders", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .uuid("parent_folder_id")
      .nullable()
      .references("id")
      .inTable("folders")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.boolean("is_deleted").notNullable().defaultTo(false);
    table.timestamp("deleted_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["user_id", "parent_folder_id"], "idx_folders_user_parent");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("folders");
}
