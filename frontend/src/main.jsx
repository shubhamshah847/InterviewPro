import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./error.css";
import "./responsive.css";

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Frontend rendering error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="crash-screen">
          <section className="crash-card">
            <img src="/interviewly-mark.svg?v=2" alt="" />
            <span className="eyebrow muted-eyebrow">A QUICK RESET</span>
            <h1>We hit a small snag.</h1>
            <p>The page ran into an unexpected problem. Reload to continue; your account data is safe.</p>
            {import.meta.env.DEV && <pre>{this.state.error.message}</pre>}
            <button className="button button-primary" onClick={() => window.location.reload()}>Reload InterviewPro</button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
