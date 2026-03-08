export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "--";

  const deltaMs = timestamp - Date.now();
  const absMs = Math.abs(deltaMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMs < minute) return formatter.format(Math.round(deltaMs / 1000), "second");
  if (absMs < hour) return formatter.format(Math.round(deltaMs / minute), "minute");
  if (absMs < day) return formatter.format(Math.round(deltaMs / hour), "hour");
  return formatter.format(Math.round(deltaMs / day), "day");
}

export function formatAbsoluteTime(timestamp: number | undefined): string {
  if (!timestamp) return "--";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";

  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-US", {
    hour12: false,
  })}`;
}

export function formatShortTime(timestamp: number | undefined): string {
  if (!timestamp) return "--";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleTimeString("en-US", { hour12: false });
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return "--";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatCountdown(targetMs: number | undefined): string {
  if (!targetMs) return "--";

  const remaining = targetMs - Date.now();
  if (remaining <= 0) return "Expired";

  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function isStale(lastUpdateAt: number | undefined, thresholdMs: number = 10000): boolean {
  if (!lastUpdateAt) return true;
  return Date.now() - lastUpdateAt > thresholdMs;
}

export function getUptime(startedAtMs: number | undefined): string {
  if (!startedAtMs) return "--";
  return formatDuration(Math.floor((Date.now() - startedAtMs) / 1000));
}
