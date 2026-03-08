import pino, { type Logger } from "pino";

export interface LoggerOptions {
  target?: "stdout" | "stderr" | "file";
  path?: string;
}

export function createLogger(level: string, opts: LoggerOptions = {}): Logger {
  const target = opts.target ?? "stdout";
  const destination =
    target === "file"
      ? pino.destination({ dest: opts.path || "oclay.log", sync: false })
      : target === "stderr"
        ? pino.destination({ dest: 2, sync: false })
        : pino.destination({ dest: 1, sync: false });
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime
    },
    destination
  );
}
