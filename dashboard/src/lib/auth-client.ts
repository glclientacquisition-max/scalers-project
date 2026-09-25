import { createAuthClient } from "better-auth/react";

/** Super Admin client. Owner desk stays on Supabase Auth. */
export const adminAuthClient = createAuthClient({
  basePath: "/api/auth",
});
