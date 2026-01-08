# SDK Test Suite

This package exercises the published `@worldfork/sdk` against mocked requests, a real WorldFork Core Server, and TypeScript/OpenAPI contracts.

## Run everything

```bash
npm run sdk:test
```

## Run individual layers

```bash
npm -w packages/sdk-tests run test:unit
npm -w packages/sdk-tests run test:integration
npm -w packages/sdk-tests run test:contract
npm -w packages/sdk-tests run typecheck
```

## Integration test server configuration

By default the integration tests will try to import a server factory from common locations. If that fails, they fall back to `npm run dev` in the repo root.

Override behavior with environment variables:

- `WORLD_CORE_SERVER_URL`: use an existing server (tests will not start/stop the server).
- `WORLD_CORE_SERVER_CMD`: a custom command to start the server, e.g. `WORLD_CORE_SERVER_CMD="npm run dev"`.
- `WORLD_CORE_SERVER_PORT`: port to use when starting via command.

The integration tests use a temporary SQLite database by setting `DATABASE_URL` to an isolated file under your OS temp directory.
