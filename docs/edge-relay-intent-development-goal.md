# Edge Relay Intent Development Goal

## 目标

基于“Node 固定、Edge 可变”的原则，完成一版可持续执行的接续体系：

1. 节点能力（Node）只表达执行能力，不承担上下游业务语义。
2. 边接续（Edge）表达接续意图、字段绑定、解析规则和失败策略。
3. 连接构建与运行可解释：从连接判断到运行时输入都可追溯。
4. 引入“接续意图提示 + 运行时接续摘要”，提高跨节点编排可维护性。

## 术语统一

- `Node Contract`：节点能力定义（输入/输出能力、required、副作用、可接力能力）
- `Edge Contract`：边接续定义（意图、绑定、解析器、校验、容错）
- `Relay Intent`：Edge 的设计时语义（连接时生成）
- `Relay Context`：运行时解析后实际输入对象（运行时实体）
- `Relay Context Brief`：下发给 Node/Agent 的可读上下文简报
- `workflow_revision`：workflow 版本快照，保证同一次运行行为可重放

## 三角色开发模型（本次交付）

### 1) 架构角色

职责：
- 完成 Edge Contract 数据模型和校验规则。
- 明确 auto 与显式绑定的决策矩阵。
- 定义失败码与可恢复策略。

交付：
- `sop-contract.schema` 扩展草案
- 校验规则清单（pass / needs_review / blocked）

### 2) 实现角色

职责：
- 在 workflow 编辑器中把边级接续作为主要配置入口。
- 支持从上游产物到下游输入的映射向导，避免手写原始 JSON。
- 在运行时生成 `Relay Context Brief` 并带给 Node 执行入口。

交付：
- `sop-ui` 节点连接/边详情交互原型改造
- `agent-brain-plugins`（如适用）edge 解析与注入逻辑最小闭环
- `resolution_trace` 记录：字段来源、解析器、结果状态、错误点

### 3) 验收角色

职责：
- 编写 5 类核心场景验收清单（可手动触发）。
- 形成“为什么可连 / 为什么不通”报告文案。

交付：
- 连接可视化解释（UI）
- 运行时 trace + 连接异常定位条目

## Edge Contract 目标模型（最小闭环）

```yaml
edges:
  - id: e_youtube_fetch_to_tg_notify
    from: youtube-fetch
    to: tg-notify
    relay:
      intent:
        id: notify-title
        title: 将上游标题发送到 Telegram
      bindings:
        - target_input: message
          source:
            node: youtube-fetch
            output: metadata_file
            extractor:
              kind: json_path
              path: "$.title"
          required: true
          required_strategy: block
      resolver:
        strategy: explicit_first
        fallback: needs_review
      validation:
        required_ok: all
        on_missing_required: block
        on_type_mismatch: needs_review
```

说明：
- `Node` 层保持 `inputs/outputs` 不变（能力层）。
- `Edge` 层新增 `relay` 决定连接语义。
- `auto` 仅作为兜底策略，遇到歧义不能自动静默通过。

## 判定规则（连接预检）

- auto 映射唯一且类型兼容：`pass`
- auto 无候选：`blocked`
- auto 多候选：`needs_review`
- 有显式 `relay.bindings` 且校验通过：`pass`
- 有显式 `relay.bindings` 但 missing required：`blocked`
- `resolver` 失败但有替代：按 `fallback` 决定

## 运行时行为

1. Workflow 执行时使用该次 `workflow_revision` 的 Edge Contract 快照。
2. 对每条待运行边执行解析，生成 `Relay Context`。
3. 写入 `resolution_trace`（来源节点、来源字段、解析器、结果、耗时、失败原因）。
4. 将可读上下文以 `Relay Context Brief` 形式附到 Node 运行输入。
5. 失败时显示边级错误，不混淆 Node 内部执行错误。

## 验收用例（第一阶段）

1. `youtube-fetch -> tg-notify`
- 通过 metadata_file.title 成功映射到 message
- 同时保留 `index: auto` 场景，但无显式映射时要 `needs_review`

2. `youtube-fetch -> youtube-deep-research`
- `source_url` 映射可通过
- 缺失 `source_url` 时 required 阻断

3. `youtube-deep-research -> wiki-build`
- `analysis_file` 与 `transcript_file` 产生的 file 集可以作为文件类输入
- 连接报告可展示“为何可接续”

4. 运行 Trace 验证
- 每次 Node run 能看到 `Relay Context Brief`
- 能看到“解析器 + 来源 + 实际值预览”

5. 历史稳定性验证
- 修改边定义后，历史 run 使用旧 `workflow_revision` 不受影响
- 新 run 使用新边定义

## 当前交付边界（避免踩线）

- 不改现有 Stage C 模型提供链路（保留现有可运行能力）。
- 不改 existing API 命名风格到最小闭环内。
- Edge Contract 优先落在 `sop.yml`/`sop.yaml` 的 `edges[].relay`。

## 交付输出要求（每仓库）

- 修改文件列表（逐仓库）
- `repo@commit`
- `git push` 记录
- 构建/验证命令
- 部署验证链接和结论
