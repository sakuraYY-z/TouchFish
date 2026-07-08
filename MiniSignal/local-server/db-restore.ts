import fs from "fs";
import path from "path";

const backupArg = process.argv[2];

if (!backupArg) {
  console.error("\nUsage:");
  console.error("npm run db:restore -- <backup-db-path>\n");
  process.exit(1);
}

const projectRoot = process.cwd();

const backupPath = path.isAbsolute(backupArg)
  ? backupArg
  : path.resolve(projectRoot, backupArg);

if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

const targetDbPath = process.env.MINISIGNAL_DB_PATH
  ? path.resolve(projectRoot, process.env.MINISIGNAL_DB_PATH)
  : path.resolve(projectRoot, "local-server", "storage", "minisignal.db");

const targetDir = path.dirname(targetDbPath);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const timestamp = new Date()
  .toISOString()
  .replace(/:/g, "-")
  .replace(/\./g, "-");

const safetyBackupPath = path.join(
  targetDir,
  `minisignal-before-restore-${timestamp}.db`
);

if (fs.existsSync(targetDbPath)) {
  fs.copyFileSync(targetDbPath, safetyBackupPath);
}

fs.copyFileSync(backupPath, targetDbPath);

console.log("\nMiniSignal Database Restore\n");

console.log("Restored From:");
console.log(backupPath);

console.log("\nRestored To:");
console.log(targetDbPath);

if (fs.existsSync(safetyBackupPath)) {
  console.log("\nSafety Backup Created:");
  console.log(safetyBackupPath);
}

console.log("\nRestore completed.\n");
