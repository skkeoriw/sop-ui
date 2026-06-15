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
3. 底层 API 类型可以暂时保留 runtime 字段，但用户可见文案逐步改成 Runtime Host。
4. Workflow Definition 和 Execution Run 必须拆开，不再把 execution 列表显示为 workflows。
5. Node Definition 和 Node Run State 必须拆开，不再把节点定义和某次执行状态混成一个对象。
6. GitHub repo、TG 通知配置、workspace path 归属 Instance，不归属 Runtime Host。
7. Runtime Host 页面只表达机器宿主、Hermes、SPI、Tunnel、Health、Instances，不承载业务 repo/TG 配置。
8. 支持 real/mock mode，现有数据缺字段时要有兼容空状态，不得导致页面报错。

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

后续接口应按查询粒度拆分：

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
