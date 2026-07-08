import fs from "fs";
import path from "path";
import { exportDatabaseSnapshot } from "./db";

const outputDir = path.join(process.cwd(), "local-server", "storage", "exports");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const timestamp = new Date()
  .toISOString()
  .replace(/:/g, "-")
  .replace(/\./g, "-");

const outputPath = path.join(
  outputDir,
  `minisignal-export-${timestamp}.json`
);

const snapshot = exportDatabaseSnapshot();

fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");

console.log("\nMiniSignal Database Export\n");

console.log("Export Path:");
console.log(outputPath);

console.log("\nTables:");
console.log(`registeredDevices: ${snapshot.tables.registeredDevices.length}`);
console.log(`preKeyBundles: ${snapshot.tables.preKeyBundles.length}`);
console.log(`oneTimePreKeys: ${snapshot.tables.oneTimePreKeys.length}`);
console.log(`offlineMessages: ${snapshot.tables.offlineMessages.length}`);

console.log("\nExport completed.\n");