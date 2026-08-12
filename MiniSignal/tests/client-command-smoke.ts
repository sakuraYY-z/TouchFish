import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";

const projectRoot = path.resolve(__dirname, "..");

const input = [
  "/help",
  "/chats",
  "/chats bob",
  "/history 5",
  "/history all",
  "/history abc",
  "/stats",
  "/chat-info",
  "/exit",
].join("\n");

const result = spawnSync(
  process.execPath,
  [
    "./node_modules/tsx/dist/cli.mjs",
    "demo-client/client.ts",
    "alice",
    "desktop",
    "bob",
    "phone",
  ],
  {
    cwd: projectRoot,
    input,
    encoding: "utf8",
    timeout: 15000,
  }
);

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /MiniSignal Commands/);
assert.match(result.stdout, /\/chats <.+>/);
assert.match(result.stdout, /===== CHATS =====/);
assert.match(result.stdout, /===== HISTORY =====/);
assert.match(result.stdout, /\/history \[.+\|all\]/);
assert.match(result.stdout, /===== CHAT STATS =====/);
assert.match(result.stdout, /===== CHAT INFO =====/);
assert.match(result.stdout, /MiniSignal/);
assert.strictEqual(result.stderr.trim(), "");

console.log("client command smoke test passed");
