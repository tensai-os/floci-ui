import { CloudWatchRequestIngestor } from "./CloudWatchRequestIngestor";
import { Scheduler } from "./Scheduler";

const CLOUDWATCH_FLUSH_INTERVAL_MS = 5_000;

export class TelemetryRuntime {
  private readonly scheduler = new Scheduler();
  private readonly cloudWatchIngestor = new CloudWatchRequestIngestor();
  private started = false;

  start() {
    if (this.started) return;

    this.cloudWatchIngestor.start();
    this.scheduler.add({
      name: "cloudwatch-request-ingestor",
      intervalMs: CLOUDWATCH_FLUSH_INTERVAL_MS,
      run: () => this.cloudWatchIngestor.flush(),
    });

    this.started = true;
  }

  stop() {
    if (!this.started) return;

    this.scheduler.stop();
    this.cloudWatchIngestor.stop();
    this.started = false;
  }
}

export function createTelemetryRuntime() {
  return new TelemetryRuntime();
}
