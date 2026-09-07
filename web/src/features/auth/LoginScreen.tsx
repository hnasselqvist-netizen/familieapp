import { useState } from "react";
import { login } from "@data/auth.repository";
import styles from "./LoginScreen.module.css";

/** Portert 1:1 fra dagens LoginScreen i index.html — samme felt, samme feilmelding. */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch {
      setError("Feil e-post eller passord.");
    }
    setLoading(false);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.heading}>
          <div className={styles.emoji}>🏡</div>
          <div className={styles.title}>Hverdagsflyt</div>
          <div className={styles.subtitle}>Logg inn for å fortsette</div>
        </div>
        <div className={styles.form}>
          <div>
            <div className={styles.label}>E-post</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="din@epost.no"
              className={styles.input}
            />
          </div>
          <div>
            <div className={styles.label}>Passord</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="••••••••"
              className={styles.input}
            />
          </div>
          {error && <div className={styles.error}>⚠️ {error}</div>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className={styles.submit}
          >
            {loading ? "Logger inn…" : "Logg inn"}
          </button>
        </div>
      </div>
    </div>
  );
}
