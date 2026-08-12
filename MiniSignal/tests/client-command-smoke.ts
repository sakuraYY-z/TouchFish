import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";

const projectRoot = path.resolve(__dirname, "..");

const commands = [
  "/help",
  "/chats",
  "/chats bob",
  "/chats nobody",
  "/chats-all",
  "/chats-all bob",
  "/unread",
  "/archived",
  "/history 5",
  "/history all",
  "/history abc",
  "/stats",
  "/chat-info",
  "/exit",
];

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
    input: commands.join("\n"),
    encoding: "utf8",
    timeout: 15000,
  }
);

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.strictEqual(result.stderr.trim(), "");

const output = result.stdout;

function expectOutput(pattern: RegExp, description: string) {
  assert.match(output, pattern, `missing output: ${description}`);
}

expectOutput(/MiniSignal Commands/, "/help header");
expectOutput(/\/chats <.+>/, "/help mentions chat filtering");
expectOutput(/\/history \[.+\|all\]/, "/help mentions history limit");
expectOutput(/\/unread/, "/help mentions unread chats");
expectOutput(/\/archived/, "/help mentions archived chats");
expectOutput(/\/stats/, "/help mentions stats");
expectOutput(/\/chat-info/, "/help mentions chat-info");
expectOutput(/\/exit/, "/help mentions exit");

expectOutput(/===== CHATS =====/, "chat list output");
expectOutput(/bob\/phone/, "chat filter can find bob/phone");
expectOutput(/nobody/, "chat filter no-match path includes keyword");

expectOutput(/===== HISTORY =====/, "history output");
expectOutput(/\/history/, "invalid history usage output");

expectOutput(/===== CHAT STATS =====/, "chat stats output");
expectOutput(/===== CHAT INFO =====/, "chat info output");
expectOutput(/MiniSignal/, "client startup or exit output");

console.log(`client command smoke test passed (${commands.length} commands)`);
