import { qualifiedInventoryCount, qualifiedVehicleShard, qualifiedInventoryGroups } from "./lib/inventory-index";
import { inventoryUrls } from "./lib/inventory-index";
import { submitIndexNow } from "./lib/indexnow";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

if (!process.argv.includes("--confirm")) {
  logger.error("Refusing IndexNow bootstrap without --confirm");
  process.exit(2);
}
try {
  const shardSize = 5_000;
  const count = await qualifiedInventoryCount();
  const vehicles: string[] = [];
  for (let offset = 0; offset < count; offset += shardSize) {
    vehicles.push(...(await qualifiedVehicleShard(offset, shardSize)).map((row) => row.vin));
  }
  const groups = await qualifiedInventoryGroups();
  const urls = inventoryUrls(vehicles, groups, groups);
  const statuses = await submitIndexNow(urls);
  logger.info(
    { vehicleCount: vehicles.length, directoryCount: groups.length, urlCount: urls.length, statuses },
    "IndexNow bootstrap completed",
  );
} finally {
  await pool.end();
}