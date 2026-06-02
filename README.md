# SOP UI

Standalone SOP workflow console.

`sop-ui` is a frontend platform for SOP DAG runtimes. It does not execute SOP
stages. It calls a runtime endpoint through the SOP SPI:

```text
GET  /api/sop
GET  /api/sop/{sop_id}
GET  /api/sop/{sop_id}/dag
POST /api/sop/{sop_id}/runs
GET  /api/sop/{sop_id}/runs
GET  /api/sop/{sop_id}/runs/{pipeline_id}
GET  /api/sop/{sop_id}/runs/{pipeline_id}/nodes/{node_id}
GET  /api/sop/{sop_id}/runs/{pipeline_id}/logs/{node_id}
```

Default runtime endpoint:

```text
https://youtube-wiki.chxyka.ccwu.cc
```

You can override it with a query parameter:

```text
https://<sop-ui-endpoint>/?endpoint=https://youtube-wiki.chxyka.ccwu.cc
```

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The static files are written to `dist/`.

## Run Built UI

```bash
npm run build
node scripts/serve.mjs --host 0.0.0.0 --port 5180
```

## Deploy On A Server

```bash
git clone https://github.com/skkeoriw/sop-ui.git ~/sop-ui
cd ~/sop-ui
npm install
npm run build
nohup node scripts/serve.mjs --host 0.0.0.0 --port 5180 > /tmp/sop-ui.log 2>&1 &
```

Then register the local port with `ai-api-cli`. On the current 165 SOP UI
machine, no global `ai-api-cli` command was installed and no npm package with
that name exists, so this repo provides a small compatible wrapper that calls the
machine's existing auto-domain agent:

```bash
METADATA='{"title":"SOP UI","type":"frontend","sop_ui":"true","runtime_endpoint":"https://youtube-wiki.chxyka.ccwu.cc","sop_api":"https://youtube-wiki.chxyka.ccwu.cc/api/sop","github_repo":"https://github.com/skkeoriw/sop-ui","local_port":"5180"}'

nohup npm run ai-api-cli -- register \
  --name=sop-ui \
  --port=5180 \
  --metadata="$METADATA" \
  > /tmp/sop-ui-domain.log 2>&1 &
```

Public URL:

```text
https://sop-ui.chxyka.ccwu.cc
```

Expected channel metadata:

```json
{
  "name": "sop-ui",
  "local_port": 5180,
  "type": "frontend",
  "runtime_endpoint": "https://youtube-wiki.chxyka.ccwu.cc"
}
```

## Trigger A SOP Run

Open the UI, select `youtube-research-wiki`, enter:

```text
repo: skkeoriw/wiki-sop-dag-smoke
url:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Click `Trigger`. The UI will poll the returned pipeline until the DAG is done.
