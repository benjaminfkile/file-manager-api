import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("upload_sessions", (table) => {
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
    table.string("s3_key").notNullable();
    table.string("s3_upload_id").notNullable();
    table.string("filename").notNullable();
    table.string("mime_type").notNullable();
    table.bigInteger("size_bytes").notNullable();
    table
      .uuid("folder_id")
      .nullable()
      .references("id")
      .inTable("folders")
      .onDelete("SET NULL");
    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("upload_sessions");
}
