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

Then register the local port with the machine's channel registration tool. On
the current 165 SOP UI machine, `ai-api-cli` is not installed and is not
available from npm. The existing channel tool is the same auto-domain agent used
by the other services:

```bash
METADATA='{"title":"SOP UI","type":"frontend","sop_ui":"true","runtime_endpoint":"https://youtube-wiki.chxyka.ccwu.cc","sop_api":"https://youtube-wiki.chxyka.ccwu.cc/api/sop","github_repo":"https://github.com/skkeoriw/sop-ui","local_port":"5180"}'

nohup node /root/.auto-domain/agent.js \
  --port=5180 \
  --token=myproxy-token-2026 \
  --name=sop-ui \
  --metadata="$METADATA" \
  --replace \
  --server=wss://tunnel-api.chxyka.ccwu.cc \
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
