# ============================================================
# CODA Backend — Hono/Deno server for Azure Container Apps
# ============================================================
# Uses Deno's built-in npm: and jsr: specifiers — no package.json needed.
# All dependencies are resolved and cached at build time.

FROM denoland/deno:1.44.0

WORKDIR /app

# Copy server source files
COPY supabase/functions/server/ .

# Cache dependencies by running a dry-run (type-check + download)
RUN deno cache index.tsx

# Deno.serve() defaults to port 8000
EXPOSE 8000

# Run with minimal permissions needed by the server
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "index.tsx"]
