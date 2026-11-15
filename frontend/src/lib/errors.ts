// One place that turns an error into text for the user: known messages are translated, a write
// that lost to someone else's change says so, anything else is shown as it came.
import { toast } from "sonner";
import i18n from "../i18n";
import { RouteChangedError } from "./db";

const KNOWN: Record<string, string> = {
  "No safe walking route: the target is cut off by slopes over 25° or closed areas.": "ship.no_safe_route",
  "Route worker failed": "ship.route_worker_failed",
};

export function errorText(e: unknown): string {
  if (e instanceof RouteChangedError) return i18n.t("errors.route_changed");
  const msg = e instanceof Error ? e.message : String(e);
  return KNOWN[msg] ? i18n.t(KNOWN[msg]) : msg;
}

/** a toast for a failed action; the same text is shown once even if several places report it */
export function toastError(e: unknown) {
  const text = errorText(e);
  toast.error(text, { id: `error:${text}` });
}
