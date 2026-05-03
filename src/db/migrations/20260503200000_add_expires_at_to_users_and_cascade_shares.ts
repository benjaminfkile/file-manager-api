import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.timestamp("expires_at", { useTz: true }).nullable();
    table.index("expires_at", "idx_users_expires_at");
  });

  // Replace plain FKs on share tables with ON DELETE CASCADE so deleting a user
  // wipes every row that references them as owner or recipient.
  await knex.raw(`
    ALTER TABLE file_shares
      DROP CONSTRAINT IF EXISTS file_shares_owner_user_id_foreign,
      DROP CONSTRAINT IF EXISTS file_shares_shared_with_user_id_foreign;
    ALTER TABLE file_shares
      ADD CONSTRAINT file_shares_owner_user_id_foreign
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
      ADD CONSTRAINT file_shares_shared_with_user_id_foreign
        FOREIGN KEY (shared_with_user_id) REFERENCES users (id) ON DELETE CASCADE;
  `);

  await knex.raw(`
    ALTER TABLE folder_shares
      DROP CONSTRAINT IF EXISTS folder_shares_owner_user_id_foreign,
      DROP CONSTRAINT IF EXISTS folder_shares_shared_with_user_id_foreign;
    ALTER TABLE folder_shares
      ADD CONSTRAINT folder_shares_owner_user_id_foreign
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
      ADD CONSTRAINT folder_shares_shared_with_user_id_foreign
        FOREIGN KEY (shared_with_user_id) REFERENCES users (id) ON DELETE CASCADE;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE folder_shares
      DROP CONSTRAINT IF EXISTS folder_shares_owner_user_id_foreign,
      DROP CONSTRAINT IF EXISTS folder_shares_shared_with_user_id_foreign;
    ALTER TABLE folder_shares
      ADD CONSTRAINT folder_shares_owner_user_id_foreign
        FOREIGN KEY (owner_user_id) REFERENCES users (id),
      ADD CONSTRAINT folder_shares_shared_with_user_id_foreign
        FOREIGN KEY (shared_with_user_id) REFERENCES users (id);
  `);

  await knex.raw(`
    ALTER TABLE file_shares
      DROP CONSTRAINT IF EXISTS file_shares_owner_user_id_foreign,
      DROP CONSTRAINT IF EXISTS file_shares_shared_with_user_id_foreign;
    ALTER TABLE file_shares
      ADD CONSTRAINT file_shares_owner_user_id_foreign
        FOREIGN KEY (owner_user_id) REFERENCES users (id),
      ADD CONSTRAINT file_shares_shared_with_user_id_foreign
        FOREIGN KEY (shared_with_user_id) REFERENCES users (id);
  `);

  await knex.schema.alterTable("users", (table) => {
    table.dropIndex("expires_at", "idx_users_expires_at");
    table.dropColumn("expires_at");
  });
}
