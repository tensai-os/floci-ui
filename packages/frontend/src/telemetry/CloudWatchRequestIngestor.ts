import {
  subscribeApiRequests,
} from "./requestEventBus";
import type { ApiRequestEvent } from "./types";
import { createLogGroup, createLogStream, putLogEvents } from "@/api/services";

const SKIP_SERVICES = new Set(["cloudwatch", "health"]);

export class CloudWatchRequestIngestor {
  private readonly buffer = new Map<string, ApiRequestEvent[]>();
  private readonly knownGroups = new Set<string>();
  private readonly knownStreams = new Set<string>();
  private unsubscribe?: () => void;
  private flushing = false;

  start() {
    if (this.unsubscribe) return;

    this.unsubscribe = subscribeApiRequests((event) => {
      if (event.provider !== "aws") return;
      if (SKIP_SERVICES.has(event.service)) return;

      const groupName = `/floci/${event.provider}/${event.service}`;
      const existing = this.buffer.get(groupName);

      if (existing) {
        existing.push(event);
      } else {
        this.buffer.set(groupName, [event]);
      }
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async flush() {
    if (this.flushing || this.buffer.size === 0) return;
    this.flushing = true;

    const snapshot = new Map(this.buffer);
    this.buffer.clear();

    try {
      for (const [groupName, events] of snapshot) {
        await this.ensureLogGroup(groupName);

        const streamName = new Date().toISOString().slice(0, 10);
        await this.ensureLogStream(groupName, streamName);

        await this.putEvents(groupName, streamName, events);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async ensureLogGroup(groupName: string) {
    if (this.knownGroups.has(groupName)) return;

    try {
      await createLogGroup(groupName);
    } catch {
      // ResourceAlreadyExistsException is fine here.
    }

    this.knownGroups.add(groupName);
  }

  private async ensureLogStream(groupName: string, streamName: string) {
    const streamKey = `${groupName}::${streamName}`;
    if (this.knownStreams.has(streamKey)) return;

    try {
      await createLogStream(groupName, streamName);
    } catch {
      // ResourceAlreadyExistsException is fine here.
    }

    this.knownStreams.add(streamKey);
  }

  private async putEvents(
    groupName: string,
    streamName: string,
    events: ApiRequestEvent[],
  ) {
    const logEvents = events.map((ev) => ({
      timestamp: ev.timestamp,
      message: JSON.stringify({
        provider: ev.provider,
        service: ev.service,
        method: ev.method,
        path: ev.path,
        statusCode: ev.statusCode,
        latencyMs: ev.latencyMs,
      }),
    }));

    try {
      await putLogEvents(groupName, streamName, logEvents);
    } catch (err) {
      console.warn(
        "[CloudWatch Ingestor] putLogEvents failed for",
        groupName,
        err,
      );
    }
  }
}
