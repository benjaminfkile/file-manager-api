import fs from "fs";
import path from "path";
import type { Knex } from "knex";

/**
 * Custom knex MigrationSource that records and compares migrations by their
 * basename only (no `.ts` / `.js` extension).
 *
 * Why: this repo runs migrations from two places that share the same
 * `knex_migrations` table:
 *   - the dev CLI via ts-node against `src/db/migrations/*.ts`
 *   - the API at boot via compiled `dist/src/db/migrations/*.js`
 *
 * When each path uses its native extension, every run invalidates the table
 * for the other path ("directory is corrupt" or worse, attempts to re-run all
 * migrations). Using basenames everywhere removes the conflict — the same
 * row in `knex_migrations` matches both `foo.ts` and `foo.js`.
 */
export class ExtensionAgnosticMigrationSource
  implements Knex.MigrationSource<string>
{
  constructor(private readonly migrationDirectory: string) {}

  async getMigrations(): Promise<string[]> {
    const files = fs.readdirSync(this.migrationDirectory);
    return files
      .filter((file) => /\.(ts|js)$/.test(file))
      .filter((file) => !file.endsWith(".d.ts"))
      .map((file) => path.basename(file, path.extname(file)))
      .sort();
  }

  getMigrationName(migration: string): string {
    return migration;
  }

  async getMigration(migration: string): Promise<Knex.Migration> {
    const files = fs.readdirSync(this.migrationDirectory);
    const file = files.find(
      (f) =>
        path.basename(f, path.extname(f)) === migration &&
        /\.(ts|js)$/.test(f) &&
        !f.endsWith(".d.ts")
    );
    if (!file) {
      throw new Error(`Migration "${migration}" not found in ${this.migrationDirectory}`);
    }
    const fullPath = path.join(this.migrationDirectory, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(fullPath);
  }
}
