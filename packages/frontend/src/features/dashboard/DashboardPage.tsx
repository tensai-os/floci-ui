import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  RefreshCw,
  Zap,
} from "lucide-react";
import { fetchConsoleOverview, SERVICE_META } from "@/api/services";
import type { ConsoleOverview, ServiceName } from "@/api/types";
import { formatLatency, formatNumber, timeAgo } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({
  data,
  onRefresh,
  isLoading,
}: {
  data?: ConsoleOverview;
  onRefresh: () => void;
  isLoading: boolean;
}) {
  const activeServices = (data?.health.services ?? []).filter(
    (s) => s.status === "healthy",
  ).length;
  const implementedServices = SERVICE_META.filter((m) => m.implemented).length;
  const totalResources = data?.totalResourceCount ?? 0;

  return (
    <div className="stats-bar">
      <span className="stats-bar-item">
        <strong>{implementedServices}</strong>
        <span>of {activeServices} services active</span>
      </span>
      <span className="stats-bar-item">
        <strong>{formatNumber(totalResources)}</strong>
        <span>total resources</span>
      </span>
      {data?.logGroupCount !== undefined && (
        <span className="stats-bar-item">
          <strong>{data.logGroupCount}</strong>
          <span>log groups</span>
        </span>
      )}
      <button
        className="stats-bar-refresh"
        onClick={onRefresh}
        disabled={isLoading}
      >
        <RefreshCw size={12} className={isLoading ? "spinning" : ""} />
        {data ? `Updated ${timeAgo(data.checkedAt)}` : "Refresh"}
      </button>
    </div>
  );
}

// ─── Service card ─────────────────────────────────────────────────────────────

function resourceCount(data: ConsoleOverview | undefined, name: ServiceName) {
  return data?.resources.find((svc) => svc.service === name)?.count;
}

function resourceLatency(data: ConsoleOverview | undefined, name: ServiceName) {
  return data?.resources.find((svc) => svc.service === name)?.latencyMs;
}

function ServiceCard({
  meta,
  overview,
}: {
  meta: (typeof SERVICE_META)[number];
  overview?: ConsoleOverview;
}) {
  const svcInfo = overview?.health.services.find((s) => s.name === meta.name);
  const status =
    svcInfo?.status ?? (meta.implemented ? "unknown" : "unavailable");
  const count = resourceCount(overview, meta.name);
  const latency = resourceLatency(overview, meta.name);

  const dotColor =
    status === "healthy"
      ? "#22c55e"
      : status === "degraded"
        ? "#f59e0b"
        : status === "unavailable"
          ? "#ef4444"
          : "#6b7280";

  return (
    <Link
      className={`service-card ${!meta.implemented ? "offline" : ""}`}
      to={meta.route}
    >
      <div className="service-card-header">
        <div className="service-icon">
          <Zap size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 15 }}>{meta.displayName}</h3>
          {meta.implemented ? (
            <span className={`status ${status}`}>{status}</span>
          ) : (
            <span style={{ fontSize: 11, color: "#5f7080" }}>placeholder</span>
          )}
        </div>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: status === "healthy" ? `0 0 6px ${dotColor}` : undefined,
            flexShrink: 0,
            alignSelf: "flex-start",
            marginTop: 4,
          }}
        />
      </div>

      {meta.implemented ? (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "white",
              lineHeight: 1,
            }}
          >
            {count !== undefined ? formatNumber(count) : "—"}
          </div>
          <div style={{ fontSize: 12, color: "#8d9cad", marginTop: 3 }}>
            {meta.resourceLabel}
          </div>
          {latency !== undefined && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#5f7080" }}>
              API latency{" "}
              <span style={{ color: "#d1d1d1" }}>{formatLatency(latency)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "#5f7080" }}>Not wired yet</div>
        </div>
      )}
    </Link>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

function QuickActions() {
  const navigate = useNavigate();
  const actions = [
    { label: "Browse S3 buckets", route: "/s3" },
    { label: "Inspect SQS queues", route: "/sqs" },
    { label: "List Lambda functions", route: "/lambda" },
    { label: "Open DynamoDB tables", route: "/dynamodb" },
    { label: "Open CloudWatch", route: "/cloudwatch" },
    { label: "Check SNS topics", route: "/sns" },
  ];

  return (
    <div className="grid">
      {actions.map((action) => (
        <button
          key={action.route}
          className="link-button"
          onClick={() => navigate(action.route)}
        >
          <CheckCircle2 size={12} color="#8d9cad" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ─── Widget wrapper ───────────────────────────────────────────────────────────

function Widget({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="widget">
      <div className="widget-header">
        <h3>{title}</h3>
        {footer === undefined ? null : (
          <span style={{ marginLeft: "auto" }}>{footer}</span>
        )}
      </div>
      <div className="widget-body">{children}</div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["console-overview"],
    queryFn: ({ signal }) => fetchConsoleOverview(signal),
    refetchInterval: 15_000,
  });

  const implementedMeta = SERVICE_META.filter((m) => m.implemented);
  const serviceErrors = data?.resources.filter((svc) => svc.error).length ?? 0;

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2>Console Home</h2>
          <span className="info-link">
            <Info size={11} />
            Floci DevTools
          </span>
        </div>
      </div>

      <StatsBar
        data={data}
        onRefresh={() => void refetch()}
        isLoading={isLoading}
      />

      <div className="content">
        {isError && (
          <div
            className="card"
            style={{
              padding: 14,
              marginBottom: 16,
              borderColor: "rgba(239,68,68,.28)",
            }}
          >
            <span className="status unavailable">
              Cannot reach Floci. Make sure it is running at the configured
              endpoint.
            </span>
          </div>
        )}

        {/* Top row */}
        <div className="grid two">
          <Widget
            title="Floci Health"
            footer={
              <span className="link-button">
                {serviceErrors > 0
                  ? `${serviceErrors} error${serviceErrors > 1 ? "s" : ""}`
                  : "All systems operational"}
              </span>
            }
          >
            <div className="metric-grid">
              <div>
                <p className="metric-label">Endpoint issues</p>
                <p
                  className={`metric-value ${isError || serviceErrors ? "status unavailable" : ""}`}
                >
                  {isError ? 1 : serviceErrors}
                </p>
              </div>
              <div>
                <p className="metric-label">Active services</p>
                <p className="metric-value">
                  {isLoading
                    ? "—"
                    : `${implementedMeta.length} of ${(data?.health.services ?? []).filter((s) => s.status === "healthy").length}`}
                </p>
              </div>
              <div>
                <p className="metric-label">Total resources</p>
                <p className="metric-value">
                  {formatNumber(data?.totalResourceCount)}
                </p>
              </div>
              <div>
                <p className="metric-label">Last checked</p>
                <p className="metric-value" style={{ fontSize: 12 }}>
                  {timeAgo(data?.checkedAt)}
                </p>
              </div>
            </div>
          </Widget>

          <Widget
            title="CloudWatch"
            footer={
              <Link className="link-button" to="/cloudwatch">
                Open CloudWatch <ExternalLink size={11} />
              </Link>
            }
          >
            <div className="metric-grid six">
              <div>
                <p className="metric-label">Log groups</p>
                <p className="metric-value">
                  {formatNumber(data?.logGroupCount)}
                </p>
              </div>
              <div>
                <p className="metric-label">Alarms</p>
                <p className="metric-value">{formatNumber(data?.alarmCount)}</p>
              </div>
              <div>
                <p className="metric-label">Metrics</p>
                <p className="metric-value">
                  {formatNumber(data?.metricCount)}
                </p>
              </div>
              <div>
                <p className="metric-label">Resources</p>
                <p className="metric-value">
                  {formatNumber(data?.totalResourceCount)}
                </p>
              </div>
            </div>
          </Widget>
        </div>

        {/* Service overview */}
        <div className="section-space">
          <Widget title="Service overview">
            <div className="grid three">
              {SERVICE_META.map((meta) => (
                <ServiceCard key={meta.name} meta={meta} overview={data} />
              ))}
            </div>
          </Widget>
        </div>

        {/* Quick actions */}
        <div className="section-space">
          <div className="grid two">
            <Widget title="Quick actions">
              <QuickActions />
            </Widget>

            <Widget title="Requests &amp; Logs">
              <EmptyState
                icon={AlertTriangle}
                title="No persisted request timeline"
                description="Use CloudWatch to see service activity. A dedicated request-history API is planned."
              />
            </Widget>
          </div>
        </div>
      </div>
    </>
  );
}
