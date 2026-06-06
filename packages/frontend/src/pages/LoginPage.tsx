import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { postLogin } from "@/api/auth.api";
import { useAuth } from "@/auth/AuthContext";

export function LoginPage() {
  const { authReady, setupRequired, setSession, refreshAuthStatus } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (authReady && setupRequired) {
      navigate("/setup", { replace: true });
    }
  }, [authReady, setupRequired, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { token, user } = await postLogin(email, password);
      setSession(token, user);
      await refreshAuthStatus();
      navigate("/console/aws", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

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

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Use your Floci account credentials.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
            />
          </label>
          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-footer">
          Need to create the first account? <Link to="/setup">Setup</Link>
        </p>
      </div>
    </div>
  );
}
