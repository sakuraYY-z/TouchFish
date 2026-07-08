import { getDatabaseStats } from "./db";

const stats = getDatabaseStats();

console.log("\nMiniSignal Database Status\n");

console.log("Database Path:");
console.log(stats.dbPath);

console.log("\nTables:");
console.log(`registered_devices: ${stats.registeredDevices}`);
console.log(`prekey_bundles: ${stats.preKeyBundles}`);
console.log(`one_time_prekeys: ${stats.oneTimePreKeys}`);
console.log(`offline_messages: ${stats.offlineMessages}`);

console.log("");