# SOP UI

**Active implementation: `prototype/`**

The official `src/` has been removed. All active development happens in `prototype/`.

## Active URL

```
https://sop-ui-prototype.chxyka.ccwu.cc/
```

Current public tunnel is served from this development host on local port 5191.
The old `165.245.182.250:5190` deployment is retired.

## Local Development

```bash
cd prototype
npm install
npm run dev
```

## Build & Deploy (current tunnel host)

```bash
cd /root/sop-ui
git pull
cd prototype
npm run build
node scripts/serve.mjs --host 127.0.0.1 --port 5191
```

The active backend Runtime used for real-mode validation is:

```text
runtime_id: runtime-152-32-214-95
host: 152.32.214.95
endpoint: https://runtime-152-32-214-95.chxyka.ccwu.cc
ssh_alias: sop-runtime-95
```

Do not store the root password in this repository. Use an interactive SSH
prompt or a temporary `SSHPASS` environment variable when operating the Runtime.

## SOP SPI

```
GET  /api/sop
GET  /api/sop/{instance}
GET  /api/sop/{instance}/runs
GET  /api/sop/{instance}/runs/{pipeline_id}
GET  /api/sop/{instance}/runs/{pipeline_id}/nodes/{node_id}
GET  /api/sop/{instance}/runs/{pipeline_id}/logs/{node_id}
GET  /api/sop/{instance}/nodes/{node_id}
POST /api/sop/{instance}/runs/{pipeline_id}/cancel
POST /api/sop/{instance}/runs/{pipeline_id}/nodes/{node_id}/retry
POST /api/sop/{instance}/runs/{pipeline_id}/nodes/{node_id}/cancel
```
