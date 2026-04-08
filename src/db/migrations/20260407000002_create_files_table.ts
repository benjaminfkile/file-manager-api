import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("files", (table) => {
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
      .uuid("folder_id")
      .nullable()
      .references("id")
      .inTable("folders")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("s3_key").notNullable().unique();
    table.bigInteger("size_bytes").notNullable();
    table.string("mime_type").notNullable();
    table.boolean("is_deleted").notNullable().defaultTo(false);
    table.timestamp("deleted_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["user_id", "folder_id"], "idx_files_user_folder");
    table.index(["user_id", "is_deleted"], "idx_files_user_deleted");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("files");
}
