import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env.local into process.env when the tests start. Only the test
// runner reads the file. `quiet` suppresses dotenv's log line. `override`
// is left at its default (false), so a variable already set in the shell wins.
// Source: https://github.com/motdotla/dotenv#readme (Options: path, quiet, override)
loadEnv({ path: ".env.local", quiet: true });

// The project root as a file-system path. fileURLToPath decodes the space in
// "Market Enginuity"; `new URL(...).pathname` would leave it as %20.
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // `resolve.alias` goes at the top level, not inside `test`. It mirrors the
  // "@/*" -> "./*" mapping in tsconfig.json. No Vitest plugins (SPEC §13).
  // Source: https://vitest.dev/config/ and https://vitest.dev/config/alias
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    // "node" is already the default; written out so it is visible.
    // Source: https://vitest.dev/config/environment
    environment: "node",
    // Runs before each test file, in the same process as the tests.
    // Source: https://vitest.dev/config/setupfiles
    setupFiles: ["./tests/setup.ts"],
  },
});
