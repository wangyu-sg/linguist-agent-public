import { executeSqliteAuditCommand } from "../packages/storage-sqlite/src/index.js";

const result = await executeSqliteAuditCommand(process.argv.slice(2));
console.log(JSON.stringify(result));
