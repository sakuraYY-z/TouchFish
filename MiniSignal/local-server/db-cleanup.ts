import { deleteExpiredOfflineMessages } from "./db";

const daysArg = process.argv[2];
const days = daysArg ? Number(daysArg) : 7;

if (!Number.isFinite(days) || days <= 0) {
  console.error("Usage: npm run db:cleanup -- <days>");
  process.exit(1);
}

const maxAgeMs = days * 24 * 60 * 60 * 1000;

const result = deleteExpiredOfflineMessages(maxAgeMs);

console.log("\nMiniSignal Database Cleanup\n");
console.log(`Rule: delete offline messages older than ${days} day(s)`);
console.log(`Cutoff timestamp: ${result.cutoff}`);
console.log(`Deleted messages: ${result.deleted}`);
console.log("");