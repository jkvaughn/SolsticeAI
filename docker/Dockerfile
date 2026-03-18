# =============================================================================
# CODA Backend — Hono/Deno Server
# =============================================================================
# Containerizes the existing Supabase Edge Function server for Azure Container Apps.
# =============================================================================

FROM denoland/deno:1.44.0

WORKDIR /app

# Copy server source files
COPY supabase/functions/server/ .

# Cache dependencies by running a dry import
RUN deno cache index.tsx

# Set port — Deno.serve() reads from PORT env var
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD deno eval "const r = await fetch('http://localhost:8080/make-server-49d15288/health'); if (!r.ok) Deno.exit(1);"

# Run the server — Deno.serve uses PORT env var automatically
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "index.tsx"]
