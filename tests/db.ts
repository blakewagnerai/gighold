import { Client } from "pg";

/**
 * Runs `fn` inside a transaction that is always rolled back, so a database
 * test leaves nothing behind. The client is always closed, so the test
 * process can exit (CLAUDE.md rule 14).
 *
 * Postgres vs T-SQL: after any error inside a transaction, Postgres rejects
 * every further statement until ROLLBACK (or ROLLBACK TO SAVEPOINT). A test
 * that expects an error and then wants to keep querying needs a SAVEPOINT.
 */
export async function withRollback<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Name the variable, never its value.
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (names are in .env.example).",
    );
  }

  // The connection string is used exactly as given: no ssl or sslmode added.
  // Source: https://node-postgres.com/apis/client (new Client, connectionString)
  const client = new Client({ connectionString });
  try {
    // Source: https://node-postgres.com/apis/client#clientconnect
    await client.connect();
    // Source: https://node-postgres.com/apis/client#clientquery
    await client.query("BEGIN");
    try {
      return await fn(client);
    } finally {
      // Runs whether fn returned or threw.
      await client.query("ROLLBACK");
    }
  } finally {
    // Runs even if connect, BEGIN or ROLLBACK failed.
    // Source: https://node-postgres.com/apis/client#clientend
    await client.end();
  }
}
