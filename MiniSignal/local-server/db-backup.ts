import { createDatabaseBackup } from "./db";

const result = createDatabaseBackup();

console.log("\nMiniSignal Database Backup\n");

console.log("Backup Path:");
console.log(result.backupPath);

console.log(`\nSize: ${result.sizeBytes} bytes`);
console.log(`Created At: ${new Date(result.createdAt).toLocaleString()}`);
console.log("");
