import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function RequireAuth() {
  const { authReady, setupRequired, token } = useAuth();

  if (!authReady) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-inner">Loading…</div>
      </div>
    );
  }

  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
