import { generateId, type BetterAuthPlugin, type Session, type User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { verifyAdminAccess } from "@/lib/adminOperators";

const SESSION_MS = 60 * 60 * 24 * 14;

export function adminAccessCode(): BetterAuthPlugin {
  return {
    id: "admin-access-code",
    endpoints: {
      signInAccessCode: createAuthEndpoint(
        "/sign-in/access-code",
        {
          method: "POST",
          body: z.object({
            username: z.string().min(2).max(32),
            accessCode: z.string().min(1).max(200),
          }),
        },
        async (ctx) => {
          const operator = verifyAdminAccess(ctx.body.username, ctx.body.accessCode);
          if (!operator) {
            throw new APIError("UNAUTHORIZED", { message: "INVALID_ACCESS" });
          }

          const now = new Date();
          const user: User = {
            id: `admin:${operator.username}`,
            name: operator.username,
            email: `${operator.username}@admin.scalers.internal`,
            emailVerified: true,
            image: null,
            createdAt: now,
            updatedAt: now,
          };
          const session: Session = {
            id: generateId(),
            token: generateId(),
            userId: user.id,
            expiresAt: new Date(now.getTime() + SESSION_MS),
            createdAt: now,
            updatedAt: now,
            ipAddress: ctx.request ? (ctx.request.headers.get("x-forwarded-for") || "").split(",")[0].trim() : "",
            userAgent: ctx.request?.headers.get("user-agent") || "",
          };

          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            user: {
              id: user.id,
              name: user.name,
              username: operator.username,
            },
          });
        }
      ),
    },
  };
}
