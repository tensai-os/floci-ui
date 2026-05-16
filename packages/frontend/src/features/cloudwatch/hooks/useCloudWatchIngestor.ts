import { useEffect } from "react";
import { createTelemetryRuntime } from "@/telemetry";

export function useCloudWatchIngestor() {
  useEffect(() => {
    const telemetry = createTelemetryRuntime();

    telemetry.start();

    return () => {
      telemetry.stop();
    };
  }, []);
}
