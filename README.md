# SOP UI

**Active implementation: `prototype/`**

The official `src/` has been removed. All active development happens in `prototype/`.

## Active URL

```
https://sop-ui-prototype.chxyka.ccwu.cc/
```

Served on port 5190 on the 165 machine.

## Local Development

```bash
cd prototype
npm install
npm run dev
```

## Build & Deploy (on 165)

```bash
git pull
cd prototype && npm run build
node scripts/serve.mjs --host 0.0.0.0 --port 5190
```

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
