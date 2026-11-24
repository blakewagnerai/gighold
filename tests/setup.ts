import { vi } from "vitest";

// The `server-only` package throws when it is imported outside a React Server
// environment, which is what Vitest is. Replace it with an empty module so
// that lib/stripe.ts and lib/supabase.ts can be imported in tests.
// With a factory, "all imports will return its result"; calling vi.mock in a
// setupFiles entry applies it to every test file.
// Source: https://vitest.dev/api/vi.html#vi-mock
vi.mock("server-only", () => ({}));
