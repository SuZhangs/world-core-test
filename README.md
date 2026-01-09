# world-core-test

世界观核心测试仓库，用于运行 SDK 测试（单元/集成/契约）。

## 快速运行

```bash
npm run openapi:export
npm run sdk:test
```

### Published SDK 验证

```bash
npm run sdk:test:published
```

该命令会在临时目录中安装 `@worldfork/sdk`（版本来自 `WORLDFORK_SDK_VERSION`，默认 `latest`），
启动本仓库 server 并运行最小闭环 + 冲突 merge 流程。结果会落盘到 `artifacts/`。

### 覆盖率

```bash
npm run sdk:coverage
```

## Artifacts

所有集成测试录制、published SDK 运行日志与覆盖率都会写到 `artifacts/`。其中：

- `integration-*.json`：每个集成用例的关键数据（ids、diff、merge preview/apply、最终 unit、commit parents）。
- `published-run-*.json`：published SDK 运行全过程。
- `coverage/`：Vitest coverage 输出。
- `summary.txt`：快速索引每次录制文件。

## Known limitations

- 若 `/fields/a~1b`、`/fields/x~0y` 等 JSON Pointer 转义路径未按规范输出，
  相关测试会失败并在 artifacts 中记录 diff 详情，用于定位 OpenAPI/后端差异。
