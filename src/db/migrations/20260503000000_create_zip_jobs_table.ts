import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("zip_jobs", (table) => {
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
    table.uuid("folder_id").notNullable();
    table.string("zip_hash").notNullable();
    table.string("s3_key").notNullable();
    table.string("status").notNullable().defaultTo("pending");
    table.text("error").nullable();
    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp("completed_at", { useTz: true }).nullable();

    table.index(["user_id", "folder_id"]);
    table.index(["zip_hash"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("zip_jobs");
}
