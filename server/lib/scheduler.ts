import { getSettings } from "./settings.js";
import { syncAll } from "./sync.js";
import { syncReading } from "./reading.js";

let timer: NodeJS.Timeout | null = null;
let currentMinutes = -1;

/** (Re)starts the automatic sync to match the saved interval. */
export function reschedule() {
  const minutes = getSettings().syncIntervalMinutes;
  if (minutes === currentMinutes) return;
  currentMinutes = minutes;
  if (timer) clearInterval(timer);
  timer = null;
  if (minutes > 0) {
    timer = setInterval(() => {
      syncAll("scheduled")
        .catch(() => {})
        .finally(() => syncReading("scheduled").catch(() => {}));
    }, minutes * 60_000);
    timer.unref();
  }
}
