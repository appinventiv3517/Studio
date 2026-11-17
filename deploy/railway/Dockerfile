# The database: a SQLite server (libSQL / sqld) for Railway. Add a Volume mounted at /var/lib/sqld so data survives restarts.
FROM ghcr.io/tursodatabase/libsql-server:latest
ENV SQLD_NODE=primary \
    SQLD_DB_PATH=/var/lib/sqld/data.sqld \
    SQLD_HTTP_LISTEN_ADDR=[::]:8080
# SQLD_AUTH_JWT_KEY is set in Railway's Variables tab (from `npm run db:make-key`).
EXPOSE 8080
