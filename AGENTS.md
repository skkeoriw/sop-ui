# SOP UI Agent 工作规则

适用于 `sop-ui` 仓库内的任何代码、样式、构建、部署和文档修改。

## 必须遵守

- 所有修改必须先在本机仓库完成，测试通过后再 `commit`、`push`。
- 如果一次任务还修改了其他仓库，例如 `agent-brain-plugins`、`auto-youtube-wiki-skill`、`cloudflare-youtube-pipeline`，每个有本轮改动的仓库都必须分别测试、commit、push，不能只提交其中一个。
- push 前必须运行 `git status --short`。已有的非本轮脏改动不能混入本次 commit；如果保留，最终回复必须明确列出这些未提交文件和原因。
- 最终回复必须按仓库列出：`repo@commit`、push 结果、测试/构建命令、部署/验证结果。若某个涉及仓库没有 push，必须说明阻塞原因。
- 禁止把 token、SSH 私钥、Cloudflare key、密码写进仓库。
- `sop-ui` 必须保持无状态：可以用浏览器 `localStorage` 保存用户选择，但不能保存 SOP 业务事实源。Runtime、Instance、Workflow、Run、Node 状态必须来自 SOP SPI 或 Control Plane API。

## 开发验证

常用本地验证：

```bash
cd /root/sop-ui/prototype
npm run build
```

涉及页面交互、布局、响应式或可视化时，应尽量用浏览器或 Playwright 验证关键页面。若无法运行浏览器，最终回复必须说明验证缺口。

## 部署约束

- 远程 UI 机器只允许 `git pull`、build、restart、查看日志和验证。
- 禁止在远程机器上手改代码。
- 部署后必须验证公网页面和相关 API 数据源。
