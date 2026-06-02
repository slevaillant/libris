import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) throw error;
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Logs server function errors to the terminal so they're visible during dev.
const fnErrorLogger = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof Response) {
        const body = await error.clone().text().catch(() => "(unreadable)");
        console.error("[serverFn error]", error.status, body);
      } else {
        console.error("[serverFn error]", error);
      }
      throw error;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth, fnErrorLogger],
}));
