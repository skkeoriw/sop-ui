#!/usr/bin/env node
import { spawn } from "node:child_process";

function usage() {
  console.log(`Usage:
  npm run ai-api-cli -- register --name=sop-ui --port=5180 --metadata='{}'

Options:
  --name       public channel name
  --port       local service port
  --metadata   JSON metadata string
  --token      tunnel token, defaults to AUTO_DOMAIN_TOKEN or myproxy-token-2026
  --server     websocket server, defaults to wss://tunnel-api.chxyka.ccwu.cc
  --agent      agent.js path, defaults to AUTO_DOMAIN_AGENT_JS or /root/.auto-domain/agent.js
`);
}

const [, , command, ...args] = process.argv;
if (command !== "register") {
  usage();
  process.exit(command ? 2 : 0);
}

const options = new Map();
for (const arg of args) {
  const [key, ...rest] = arg.split("=");
  if (!key.startsWith("--")) continue;
  options.set(key.slice(2), rest.join("="));
}

const name = options.get("name");
const port = options.get("port");
if (!name || !port) {
  usage();
  process.exit(2);
}

const agent = options.get("agent") || process.env.AUTO_DOMAIN_AGENT_JS || "/root/.auto-domain/agent.js";
const token = options.get("token") || process.env.AUTO_DOMAIN_TOKEN || "myproxy-token-2026";
const server = options.get("server") || process.env.AUTO_DOMAIN_SERVER || "wss://tunnel-api.chxyka.ccwu.cc";
const metadata = options.get("metadata") || "{}";

const child = spawn(
  "node",
  [
    agent,
    `--port=${port}`,
    `--token=${token}`,
    `--name=${name}`,
    `--metadata=${metadata}`,
    "--replace",
    `--server=${server}`
  ],
  {
    stdio: "inherit",
    detached: false
  }
);

child.on("exit", (code) => process.exit(code || 0));
