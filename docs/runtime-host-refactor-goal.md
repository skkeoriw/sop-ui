# Runtime Host Model Refactor Goal

目标：基于新的产品语义重构 SOP UI 的模型表达、页面交互和命名体系，统一 Machine、Runtime Host、Instance、Workflow、Execution、Node Definition、Node Run State 的边界。

## 背景

当前页面仍大量使用 Runtime 作为一级概念，但用户语义里“一个机器就是一个 runtime”，更准确的产品概念应为 Runtime Host：

- Machine：原始 SSH 机器资源，只描述 host、user、auth、role、可达性。
- Runtime Host：在一台 Machine 上部署完成的 SOP 运行宿主，包含 Hermes、SPI、Tunnel、公网域名、健康检查和运行能力。
- Instance：Runtime Host / Hermes 下的独立工作空间和业务上下文，拥有自己的 workspace path、GitHub repo、TG 通知配置、secrets/config overrides、artifact path、run history。
- Workflow Definition：Instance 加载 agent-brains 中 SOP 文件后形成的无状态流程定义。
- Node Definition：Workflow Definition 中的 SOP 阶段定义，对应 skill 或 agent executor。
- Execution / Run：某个 Workflow 在某个 Instance 下的一次执行记录。
- Node Run State：某次 Execution 中某个 Node 的状态、日志、产物、错误、耗时和 retry 信息。

## 总体原则

1. 不修改 create runtime、delete runtime、create instance、delete instance 的核心执行流程。
2. 不硬编码 IP、runtime id、machine id、instance id。
3. 底层 API 类型可以暂时保留 runtime 字段，但用户可见文案逐步收敛到 Runtime Host。
4. Workflow Definition 和 Execution Run 必须拆开，不再把 execution 列表显示为 workflows。
5. Node Definition 和 Node Run State 必须拆开，不再把节点定义和某次执行状态混成一个对象。
6. GitHub repo、TG 通知配置、workspace path 归属 Instance，不归属 Runtime Host。
7. Runtime Host 页面只表达机器宿主、Hermes、SPI、Tunnel、Health、Instances，不承载业务 repo/TG 配置。
8. 支持 real/mock mode，现有数据缺字段时要有兼容空状态，不得导致页面报错。

## Current-State Audit

这次改造不是从零拆接口。当前代码已经完成一版拆分，后续重点是修正语义、查询边界和页面消费方式。

### 表述纠偏

以下说法不能再作为准确现状使用：

- “接口还没有拆”：不准确。前端 provider 已经按 Control Plane、Runtime SPI、Machine、Settings、Execution、Node 等领域拆出调用边界；准确说法是后端接口还没有完全收敛为 summary/detail/page/search 的稳定产品语义。
- “接口已经完全拆完”：不准确。Runtime 列表已优先走 Control Plane registry，Instance / Workflow / Execution / Node 仍主要走各 Runtime SPI，部分能力还依赖旧路径 fallback。
- “Settings 需要通过某台 Runtime 读取”：不准确。Settings 当前由 SOP UI 直接调用 Control Plane Worker，再由 Worker 读写 D1；它是全局配置，不归属任何 Runtime Host。
- “Machine Node 等同 Runtime Host”：不准确。Machine Node 是原始 SSH 连接配置；Runtime Host 是在某台 Machine 上部署后的 Hermes + SPI + Tunnel 运行宿主。
- “Workflow 列表就是 Workflow”：不准确。当前页面里很多所谓 workflow 列表实际是某个 Workflow Definition 的 Execution Runs；后续文案和页面必须统一称为 Executions / Runs。
- “选择 Machine Node 需要改 workflow 核心逻辑”：不准确。选择 Machine Node 的第一阶段目标只是从 Control Plane D1 加载 SSH 入参，并按旧 workflow 参数提交 `ssh_command`、`private_key_b64`、`ssh_password`。
- “R2 静态原型上线等于 React 页面已改造”：不准确。R2 HTML 只是交互参考，线上 React 页面必须单独实现、构建和部署。

### 已存在的 Runtime SPI 接口消费

`prototype/src/data/sop-provider.ts` 已经优先调用 `/api/sop/v1/...`，失败后 fallback 到旧 `/api/sop/...`：

- `listInstances` -> `/api/sop/v1/instances`
- `getDag` -> `/api/sop/v1/instances/:instance_id/workflow`
- `listRuns` -> `/api/sop/v1/instances/:instance_id/workflow/runs`
- `getRun` -> `/api/sop/v1/instances/:instance_id/workflow/runs/:run_id`
- `getRunEvents` -> `/api/sop/v1/instances/:instance_id/workflow/runs/:run_id/events`
- `getRunArtifacts` -> `/api/sop/v1/instances/:instance_id/workflow/runs/:run_id/artifacts`
- `getNode` -> `/api/sop/v1/instances/:instance_id/workflow/runs/:run_id/nodes/:node_id`
- `getNodeLog`、`listNodes`、`listNodeModules`、`node-drafts` 仍按 runtime SPI 旧路径兼容。

### 已存在的 Control Plane 接口消费

`prototype/src/data/control-plane-provider.ts` 和 `sop-control-plane/src/index.js` 已经提供：

- `settings` / `settings/resolve`
- `machines`
- `machines/:id`
- `machines/:id/resolve`
- `machines/:id/test`
- `machine-check-jobs`
- executor claim / complete
- `runtimes` registry

Settings 和 Machines 已经走 Control Plane + D1，不应再描述为需要新建的能力。

### 当前不一致点

- Runtime 页面曾默认加载 workflow DAG、runs、node registry，导致 Runtime Host 首屏被深层业务执行数据拖慢。
- Runtime 关系区曾把 Execution Runs 展示在 `Workflows` 列里，造成 Workflow Definition 和 Execution Run 混淆。
- Node Detail 曾出现在 Runtime Host 首页，给用户造成 Node 是 Runtime 一级资源的错觉。
- Machines 页面已有 role/auth 筛选控件，但 provider 之前没有把 `role` / `auth_type` 参数带给 Control Plane。

### 本阶段修正边界

- Runtime Host 首屏只加载 runtimes、instances summary、health/Hermes 手动检查，不主动加载 DAG/runs/nodes。
- Runtime 关系区只展示 Host -> Instance -> Workflow Definition -> Latest Execution 的摘要链路。
- Workflow Definition、Execution Run、Node Run State 的完整详情继续留在 Instance / Workflow / Nodes 页面按需加载。
- Machines 筛选参数必须真实传递给 Control Plane。

## 页面交互改造

### 1. 左侧菜单与文案

- Runtime 菜单改为 Runtime Hosts 或 Hosts。
- Runtime Overview 改为 Runtime Host Overview。
- Runtime Detail 改为 Host Detail。
- Runtime Health 改为 Host Health。
- Runtime Management 改为 Host Provisioning / Host Operations。
- Machines 保持为机器节点管理，表示未必已部署 SOP Runtime Host 的原始 SSH 节点。

### 2. Runtime Host 页面

页面主语应是“宿主运行能力”，而不是 workflow 或业务 repo。

必须展示：

- Host identity：runtime_host_id、machine_id、machine host、user、local port。
- Hermes：public webhook、local process、model config inheritance status。
- SPI：public endpoint、health、instances API。
- Tunnel：SPI host、Hermes host、tunnel status。
- Instances：当前 Runtime Host 下的 Instance 列表。

关系浏览器改成：

```text
Runtime Host
  -> Instances
  -> Selected Instance Profile
  -> Workflow Binding
  -> Executions
  -> Node Run States
```

不要再显示 `Instances / Workflows / Nodes` 这种容易误解的结构。

### 3. Instance 页面

Instance 是业务执行隔离边界，应成为 repo/TG/workspace 的主页面。

必须展示：

- instance_id、title、status、sop_type。
- workspace path、artifact path、run history path。
- GitHub repo、branch、token source/masked status。
- TG notification config、chat/channel、enabled status。
- Workflow Binding：workflow id、name、version、definition source、definition path、node count。
- Executions：支持分页、搜索、状态过滤。
- Latest failure：最近失败 execution 和 failed node。

### 4. Workflow 页面

Workflow 页面需要把 definition 和 execution 分区。

页面结构：

```text
Workflow Definition
  - source: agent-brains/sop.yaml
  - version / hash
  - nodes
  - input/output contracts

Selected Execution
  - run id
  - status
  - progress
  - started/finished/duration

Node Run States
  - selected node state
  - logs / outputs / artifacts / error / retry
```

Execution 列表命名必须为 Executions / Runs，不得叫 Workflows。

### 5. Nodes 页面

Nodes 页面拆成两层：

- Node Definition Catalog：来自 SOP 文件，展示 skill、executor、inputs、outputs、retry policy。
- Node Run State Inspector：只有选中某个 execution 后才展示该 node 在这次 execution 中的状态。

### 6. Machines 页面

Machines 表示原始 SSH 节点，不等于 Runtime Host。

必须展示：

- auth type、host、user、role、last check。
- test SSH。
- duplicate/edit/delete。
- “Create Runtime Host from this machine” 入口可以后续加入，但不能把 Machine 直接等同 Runtime Host。

## 数据模型调整建议

前端领域模型建议新增或规范以下概念：

```text
MachineConfig
RuntimeHost
HermesService
SpiService
TunnelRoute
InstanceProfile
WorkflowDefinition
WorkflowBinding
ExecutionRun
NodeDefinition
NodeRunState
```

映射规则：

- 现有 Runtime 可先映射为 RuntimeHost。
- Instance.workflowBinding 映射为 WorkflowBinding。
- DAG.nodes 映射为 NodeDefinition。
- Run 映射为 ExecutionRun。
- Run.nodeStates / Run.nodes 映射为 NodeRunState。

## 接口设计方向

接口已经拆过一版。后续不是重建接口，而是把现有接口补齐为更稳定的 summary/detail/page/search 语义；底层兼容旧路径时，前端仍优先使用 `/api/sop/v1/...`。

长期目标路径可以收敛为：

- `GET /runtime-hosts`
- `GET /runtime-hosts/:hostId`
- `GET /runtime-hosts/:hostId/instances`
- `GET /runtime-hosts/:hostId/instances/:instanceId`
- `GET /runtime-hosts/:hostId/instances/:instanceId/workflow-binding`
- `GET /runtime-hosts/:hostId/instances/:instanceId/executions`
- `GET /runtime-hosts/:hostId/instances/:instanceId/executions/:runId`
- `GET /runtime-hosts/:hostId/instances/:instanceId/workflow/nodes`
- `GET /runtime-hosts/:hostId/instances/:instanceId/executions/:runId/nodes/:nodeId`

要求支持：

- pagination
- search
- status filter
- sort/order
- projection/summary/detail

## 验收标准

1. 页面文案不再把 execution runs 叫 workflows。
2. Runtime Host 页面能清楚看出一台机器上的 Hermes/SPI/Tunnel/Instances。
3. Instance 页面能清楚看出 repo、TG、workspace、workflow binding 属于 Instance。
4. Workflow 页面能清楚区分 Workflow Definition 和 Execution Run。
5. Node 页面能清楚区分 Node Definition 和 Node Run State。
6. 真实数据缺字段时页面显示空状态，不报错。
7. `npm run build` 通过。
8. Playwright 验证桌面和移动端无横向滚动、无明显文字重叠、控制台无错误。
9. 部署到 `https://sop-ui-prototype.chxyka.ccwu.cc/` 后验证真实 runtime 页面。
