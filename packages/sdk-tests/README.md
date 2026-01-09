# SDK 测试套件

这个包用于验证已发布的 `@worldfork/sdk`，覆盖三类测试：单元测试（mock 请求）、集成测试（真实 WorldFork Core Server）、TypeScript/OpenAPI 契约。

## 运行全部测试

```bash
WORLD_CORE_SERVER_URL=http://127.0.0.1:3000 npm run sdk:test
```

## 分别运行

```bash
WORLD_CORE_SERVER_URL=http://127.0.0.1:3000 npm -w packages/sdk-tests run test:unit
WORLD_CORE_SERVER_URL=http://127.0.0.1:3000 npm -w packages/sdk-tests run test:integration
WORLD_CORE_SERVER_URL=http://127.0.0.1:3000 npm -w packages/sdk-tests run test:contract
npm -w packages/sdk-tests run typecheck
```

## 集成测试服务配置

默认情况下，集成测试会尝试从常见路径加载服务工厂；失败后会回退到仓库根目录的 `npm run dev`。

可用环境变量：

- `WORLD_CORE_SERVER_URL`：使用已启动的服务（测试不会启动/停止服务）。
- `WORLD_CORE_SERVER_CMD`：自定义启动命令，例如 `WORLD_CORE_SERVER_CMD="npm run dev"`。
- `WORLD_CORE_SERVER_PORT`：通过命令启动时使用的端口。

集成测试会设置 `DATABASE_URL` 指向系统临时目录的独立 SQLite 文件。

## OpenAPI 契约来源

契约测试读取 core 仓库中的 OpenAPI 文档：

```
../World-Fork-Core/openapi/openapi.json
```

请确保该文件存在，可在 core 仓库执行：

```
npm run openapi:export
```
