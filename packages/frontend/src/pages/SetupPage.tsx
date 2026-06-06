import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { postRegister } from "@/api/auth.api";
import { useAuth } from "@/auth/AuthContext";

export function SetupPage() {
  const { authReady, setupRequired, setSession, refreshAuthStatus } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (authReady && !setupRequired) {
      navigate("/login", { replace: true });
    }
  }, [authReady, setupRequired, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { token, user } = await postRegister(email, password);
      setSession(token, user);
      await refreshAuthStatus();
      navigate("/console/aws", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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

  if (!setupRequired) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Create admin account</h1>
        <p className="auth-subtitle">
          First launch: set credentials to sign in to Floci.
        </p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
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
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
