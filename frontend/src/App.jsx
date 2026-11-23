import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, Award, BriefcaseBusiness, Check,
  ChevronDown, CircleHelp, Clock3, FileText, Headphones, LoaderCircle,
  LockKeyhole, LogOut, Mail, Maximize, Menu, Mic, MicOff, Plus, Send, ShieldCheck,
  Sparkles, Trash2, Video, VideoOff, Volume2, X,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:5000/api" : "/api");
const AVATAR_PORTRAIT_DELAY_MS = 1500;
const SKILL_DIMENSIONS = [
  { key: "technicalAccuracy", label: "Technical accuracy" },
  { key: "communicationClarity", label: "Communication clarity" },
  { key: "answerStructure", label: "Answer structure" },
  { key: "problemSolving", label: "Problem solving" },
  { key: "roleRelevance", label: "Role relevance" },
  { key: "languageFluency", label: "Language fluency" },
];

function logInterviewApiError(method, path, status, message) {
  if (!path.startsWith("/interviews")) return;
  const endpoint = path.replace(/\/[a-f\d]{24}(?=\/|$)/gi, "/:id");
  console.error("Interview API error:", { method, endpoint, status, message });
}

async function request(path, { token, ...options } = {}) {
  const method = options.method || "GET";
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    logInterviewApiError(method, path, "network", error.message);
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || "Something went wrong. Please try again.";
    logInterviewApiError(method, path, response.status, message);
    throw new Error(message);
  }
  return data;
}

async function requestStream(path, { token, body, onEvent }) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body,
      headers: {
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "text/event-stream",
      },
    });
  } catch (error) {
    logInterviewApiError("POST", path, "network", error.message);
    throw error;
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.message || "Something went wrong. Please try again.";
      logInterviewApiError("POST", path, response.status, message);
      throw new Error(message);
    }
    return data;
  }
  if (!response.body) throw new Error("Streaming is unavailable in this browser. Please try again.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  function handleFrame(frame) {
    let event = "message";
    const dataLines = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    let payload;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      throw new Error("The server returned an invalid streaming response.");
    }
    if (event === "error") {
      const message = payload.message || "Could not submit your answer. Please try again.";
      logInterviewApiError("POST", path, response.status, message);
      throw new Error(message);
    }
    if (event === "result") result = payload;
    onEvent?.(event, payload);
  }
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) handleFrame(buffer);
  if (!result) throw new Error("The answer stream ended before feedback was complete. Please try again.");
  return result;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("interviewly-token") || "");
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("interviewly-user") || "null"); } catch { return null; }
  });
  const [screen, setScreen] = useState(() => localStorage.getItem("interviewly-token") ? "home" : "welcome");
  const [authMode, setAuthMode] = useState("login");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [interviews, setInterviews] = useState([]);
  const [activeInterview, setActiveInterview] = useState(null);
  const [completedInterview, setCompletedInterview] = useState(null);
  const [practiceMode, setPracticeMode] = useState("mock");
  const [cameraOn, setCameraOn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 700);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const appShellRef = useRef(null);
  const interviewTabHiddenRef = useRef(false);

  useEffect(() => {
    if (token) {
      request("/interviews", { token })
        .then(({ interviews: items }) => setInterviews(items))
        .catch((error) => setNotice(error.message));
    }
  }, [token]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOn, screen]);

  useEffect(() => {
    function updateFullscreenState() {
      setIsFullscreen(document.fullscreenElement === appShellRef.current);
    }
    document.addEventListener("fullscreenchange", updateFullscreenState);
    updateFullscreenState();
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    if (screen !== "interview") return undefined;
    function handleVisibilityChange() {
      if (document.hidden) {
        interviewTabHiddenRef.current = true;
      } else if (interviewTabHiddenRef.current) {
        interviewTabHiddenRef.current = false;
        setNotice("You left the interview tab. Please return to the interview; this page cannot block other tabs or apps.");
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [screen]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  function saveSession(data) {
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem("interviewly-token", data.token);
    localStorage.setItem("interviewly-user", JSON.stringify(data.user));
    setScreen("home");
    setNotice("");
  }

  function logout() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
    setToken("");
    setUser(null);
    setInterviews([]);
    setProfileOpen(false);
    localStorage.removeItem("interviewly-token");
    localStorage.removeItem("interviewly-user");
    setScreen("welcome");
  }

  async function updateProfile(name) {
    const { user: updatedUser } = await request("/auth/profile", {
      token,
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setUser(updatedUser);
    localStorage.setItem("interviewly-user", JSON.stringify(updatedUser));
    return updatedUser;
  }

  async function enterFullscreen() {
    const element = appShellRef.current;
    if (!element?.requestFullscreen) {
      setNotice("Fullscreen is not available in this browser. You may try again or exit the interview.");
      return;
    }
    try {
      await element.requestFullscreen();
    } catch (error) {
      setNotice(`Fullscreen could not be enabled: ${error.message}`);
    }
  }

  async function startInterview(formData) {
    setBusy(true);
    setNotice("");
    void enterFullscreen();
    try {
      const { interview } = await request("/interviews", {
        token,
        method: "POST",
        body: formData,
      });
      setActiveInterview(interview);
      setScreen("interview");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function resumeInterview(interview) {
    setBusy(true);
    setNotice("");
    void enterFullscreen();
    try {
      const { interview: fullInterview } = await request(`/interviews/${interview._id}`, { token });
      setActiveInterview(fullInterview);
      setScreen("interview");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshInterviews() {
    try {
      const { interviews: items } = await request("/interviews", { token });
      setInterviews(items);
    } catch (error) {
      setNotice(error.message);
    }
  }

  const signedIn = Boolean(token && user);
  return (
    <div ref={appShellRef} className={`app-shell ${screen === "interview" ? "interview-mode" : ""}`}>
      {!signedIn ? (
        screen === "auth" ? (
          <AuthScreen
            mode={authMode}
            setMode={setAuthMode}
            onSuccess={saveSession}
            onBackToWelcome={() => { setScreen("welcome"); setNotice(""); }}
            busy={busy}
            setBusy={setBusy}
            notice={notice}
            setNotice={setNotice}
          />
        ) : (
          <WelcomeScreen
            onSignIn={() => { setAuthMode("login"); setScreen("auth"); setNotice(""); }}
            onGetStarted={() => { setAuthMode("register"); setScreen("auth"); setNotice(""); }}
          />
        )
      ) : (
        <div className={`workspace ${screen === "home" ? "dashboard-workspace" : ""}`}>
          <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
            <div className="sidebar-head">
              <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setScreen("home"); setSidebarOpen(false); }}>
                <BrandMark />
                <span>InterviewPro</span>
              </a>
              <button className="sidebar-toggle" type="button" aria-label={sidebarOpen ? "Collapse navigation" : "Expand navigation"} title={sidebarOpen ? "Collapse navigation" : "Expand navigation"} onClick={() => setSidebarOpen((open) => !open)}><Menu size={17} /></button>
            </div>
            <div className="side-label">WORKSPACE</div>
            <button className={`side-link ${screen === "home" ? "selected" : ""}`} onClick={() => { setScreen("home"); setNotice(""); setSidebarOpen(false); }}>
              <BriefcaseBusiness size={17} /><span>My interviews</span>
            </button>
            <button className="side-link" onClick={() => { setPracticeMode("mock"); setScreen("setup"); setSidebarOpen(false); }}>
              <Plus size={17} /><span>New practice</span>
            </button>
            <div className="sidebar-bottom">
              <div className="privacy-note"><ShieldCheck size={16} /><span>Your practice is private</span></div>
              <div className="account">
                <button className="account-profile" type="button" onClick={() => { setProfileOpen(true); setSidebarOpen(false); }} aria-label="View profile">
                  <div className="avatar">{user.name?.[0]?.toUpperCase() || "U"}</div>
                  <span className="account-info"><strong>{user.name}</strong><span>{user.email}</span></span>
                </button>
                <button className="icon-button" title="Sign out" onClick={logout}><LogOut size={16} /></button>
              </div>
            </div>
          </aside>
          {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
          <main className="main-panel">
            {screen === "home" && (
              <Dashboard
                user={user}
                token={token}
                interviews={interviews}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((open) => !open)}
                onOpenProfile={() => { setProfileOpen(true); setSidebarOpen(false); }}
                onNew={(mode = "mock") => { setPracticeMode(mode); setScreen("setup"); setNotice(""); }}
                onResume={resumeInterview}
                notice={notice}
                refresh={refreshInterviews}
              />
            )}
            {screen === "setup" && (
              <SetupScreen token={token} initialMode={practiceMode} onBack={() => setScreen("home")} onStart={startInterview} busy={busy} notice={notice} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
            )}
            {screen === "interview" && activeInterview && (
              <InterviewScreen
                key={activeInterview._id}
                interview={activeInterview}
                user={user}
                token={token}
                videoRef={videoRef}
                cameraOn={cameraOn}
                toggleCamera={async () => {
                  if (cameraOn) {
                    streamRef.current?.getVideoTracks().forEach((track) => track.stop());
                    streamRef.current = null;
                    setCameraOn(false);
                    return;
                  }
                  try {
                    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    streamRef.current = videoStream;
                    setCameraOn(true);
                    setNotice("");
                  } catch {
                    setNotice("Camera access was denied or is unavailable. Check your browser permissions.");
                  }
                }}
                onExit={async (finished) => {
                  let finishedResult = null;
                  if (finished) {
                    try {
                      const { interview: finishedInterview } = await request(`/interviews/${activeInterview._id}/finish`, { token, method: "POST", body: "{}" });
                      finishedResult = finishedInterview;
                      await refreshInterviews();
                    } catch (error) {
                      setNotice(error.message);
                    }
                  }
                  streamRef.current?.getTracks().forEach((track) => track.stop());
                  streamRef.current = null;
                  setCameraOn(false);
                  setActiveInterview(null);
                  setScreen("home");
                  if (finishedResult) setCompletedInterview(finishedResult);
                  if (document.fullscreenElement === appShellRef.current) {
                    try {
                      await document.exitFullscreen();
                    } catch (error) {
                      setNotice(`Could not exit fullscreen: ${error.message}`);
                    }
                  }
                }}
                isFullscreen={isFullscreen}
                onEnterFullscreen={enterFullscreen}
                setNotice={setNotice}
                notice={notice}
              />
            )}
          </main>
          {profileOpen && <ProfileModal user={user} onClose={() => setProfileOpen(false)} onSave={updateProfile} onLogout={logout} />}
        </div>
      )}
      {completedInterview && <InterviewResultsModal interview={completedInterview} onClose={() => setCompletedInterview(null)} />}
    </div>
  );
}

function InterviewResultsModal({ interview, onClose }) {
  const summary = interview.summary || {};
  const score = Number.isFinite(summary.score) ? summary.score : null;
  const dimensions = [
    ["technicalAccuracy", "Technical accuracy"],
    ["communicationClarity", "Communication clarity"],
    ["answerStructure", "Answer structure"],
    ["problemSolving", "Problem solving"],
    ["roleRelevance", "Role relevance"],
    ["languageFluency", "Language fluency"],
  ];

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="results-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="results-modal" role="dialog" aria-modal="true" aria-labelledby="results-title">
        <button className="results-modal-close" type="button" onClick={onClose} aria-label="Close interview results"><X size={18} /></button>
        <div className="results-modal-icon"><Award size={22} /></div>
        <div className="eyebrow muted-eyebrow">PRACTICE COMPLETE</div>
        <h2 id="results-title">Your interview score</h2>
        <p className="results-role">{interview.role} · {interview.difficulty}</p>
        <div className="results-score-ring" style={{ background: `conic-gradient(#315edb ${score ?? 0}%, #e5e7eb 0)` }}>
          <div className="results-score-inner">{score === null ? "—" : score}<span>{score === null ? "" : "%"}</span></div>
        </div>
        <p className="results-overview">{summary.overview || "Your interview has been saved. Keep practicing to build your skills."}</p>
        {Object.keys(summary.dimensionScores || {}).length > 0 && (
          <div className="results-dimensions">
            {dimensions.filter(([key]) => Number.isFinite(summary.dimensionScores[key])).map(([key, label]) => (
              <div className="results-dimension" key={key}>
                <span>{label}</span><strong>{summary.dimensionScores[key]}%</strong>
                <div><i style={{ width: `${summary.dimensionScores[key]}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        <div className="results-takeaways">
          {summary.strengths?.length > 0 && <div><strong>Strengths</strong><ul>{summary.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {summary.improvements?.length > 0 && <div><strong>Next to improve</strong><ul>{summary.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </div>
        <button className="button button-primary results-dashboard-button" type="button" onClick={onClose}>Back to dashboard <ArrowRight size={15} /></button>
      </section>
    </div>
  );
}

function BrandMark() {
  return <span className="brand-mark"><img src="/interviewly-mark.svg?v=2" alt="" /></span>;
}

function WelcomeScreen({ onSignIn, onGetStarted }) {
  return (
    <main className="welcome-screen">
      <header className="welcome-nav">
        <a className="brand welcome-brand" href="#" onClick={(event) => event.preventDefault()}>
          <BrandMark />
          <span>InterviewPro</span>
        </a>
        <div className="welcome-nav-actions">
          <span className="welcome-private"><ShieldCheck size={15} /> Private by design</span>
          <button className="welcome-signin" onClick={onSignIn}>Sign in</button>
          <button className="button button-primary" onClick={onGetStarted}>Get started <ArrowRight size={16} /></button>
        </div>
      </header>
      <section className="welcome-hero">
        <div className="welcome-copy">
          <div className="welcome-kicker"><span className="live-dot" /> YOUR PERSONAL INTERVIEW STUDIO</div>
          <h1>Make your next<br />interview feel <span>familiar.</span></h1>
          <p>Meet Maya or Dev in a video-call style practice interview. Answer by voice or text, then get thoughtful feedback to help you show up ready.</p>
          <div className="welcome-actions">
            <button className="button button-primary" onClick={onGetStarted}>Create your free account <ArrowRight size={16} /></button>
            <button className="welcome-secondary" onClick={onSignIn}>I already have an account <ArrowRight size={15} /></button>
          </div>
          <div className="welcome-trust"><ShieldCheck size={16} /><span>Your practice stays private</span><i />No pressure. Just progress.</div>
        </div>
        <div className="welcome-visual" aria-label="Preview of an InterviewPro practice session">
          <div className="welcome-visual-glow" />
          <div className="welcome-preview-card">
            <div className="preview-topbar">
              <span><span className="preview-live-dot" /> PRACTICE SESSION</span>
              <span className="preview-time">20 MIN</span>
            </div>
            <div className="preview-coach">
              <div className="preview-coach-image"><img src="/image_girl.png" alt="Maya, AI interview coach" /></div>
              <div className="preview-coach-name"><strong>Maya</strong><span>AI interview coach</span></div>
              <span className="preview-coach-ready"><span /> Ready</span>
            </div>
            <div className="preview-question">
              <span>QUESTION 01 <i>INTERMEDIATE</i></span>
              <p>Tell me about a project you’re proud of and the impact it made.</p>
              <div className="preview-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <div className="preview-progress-label"><span>SESSION PROGRESS</span><strong>01 <i>/ 08</i></strong></div>
            <div className="preview-progress"><span /></div>
            <div className="preview-feedback"><span><Sparkles size={15} /></span><div><strong>Feedback that moves you forward</strong><small>Clear, practical guidance after every answer.</small></div></div>
          </div>
          <div className="welcome-float-card"><span><Check size={14} /></span><div><strong>Built around you</strong><small>Questions tailored to your goals</small></div></div>
        </div>
      </section>
      <section className="welcome-coaches">
        <div className="welcome-coaches-heading">
          <div>
            <span className="welcome-section-kicker">MEET YOUR AI INTERVIEWERS</span>
            <h2>Choose who you practice with.</h2>
            <p>Each session feels like a focused one-on-one interview. Pick the coach and voice that help you feel comfortable.</p>
          </div>
          <span className="welcome-call-chip"><Video size={15} /> VIDEO-CALL STYLE PRACTICE</span>
        </div>
        <div className="welcome-coach-grid">
          <article className="welcome-coach-card">
            <div className="welcome-coach-photo maya"><img src="/image_girl.png" alt="Maya, the AI interview coach" /><span><i /> AVAILABLE</span></div>
            <div className="welcome-coach-copy"><div><h3>Maya</h3><span>Clear · Bright · Professional</span></div><p>A thoughtful, encouraging interviewer who helps you find your voice and build confidence.</p></div>
          </article>
          <article className="welcome-coach-card">
            <div className="welcome-coach-photo dev"><img src="/image_boy.png" alt="Dev, the AI interview coach" /><span><i /> AVAILABLE</span></div>
            <div className="welcome-coach-copy"><div><h3>Dev</h3><span>Warm · Relaxed · Engaging</span></div><p>A friendly, conversational interviewer who gives you room to think out loud.</p></div>
          </article>
        </div>
      </section>
      <section className="welcome-features" aria-label="InterviewPro features">
        <article className="welcome-feature">
          <span className="welcome-feature-icon"><Headphones size={18} /></span>
          <div><h2>Practice like it’s real</h2><p>Speak naturally with an AI coach that listens and follows up.</p></div>
        </article>
        <article className="welcome-feature">
          <span className="welcome-feature-icon"><Sparkles size={18} /></span>
          <div><h2>Get useful feedback</h2><p>Understand what worked and how to make your next answer stronger.</p></div>
        </article>
        <article className="welcome-feature">
          <span className="welcome-feature-icon"><FileText size={18} /></span>
          <div><h2>Make it personal</h2><p>Practice for your role, experience, difficulty, and interview style.</p></div>
        </article>
      </section>
      <footer className="welcome-footer"><span><BrandMark /> A calmer way to prepare.</span><span>Private practice. Real progress.</span></footer>
    </main>
  );
}

function AuthScreen({ mode, setMode, onSuccess, onBackToWelcome, busy, setBusy, notice, setNotice }) {
  const [step, setStep] = useState("form");
  const [email, setEmail] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", otp: "", newPassword: "" });
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setStep("form");
    setForm({ name: "", email: "", password: "", otp: "", newPassword: "" });
    setDevOtp("");
    setLocalError("");
  }, [mode]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    setNotice("");
    try {
      if (mode === "login") {
        const data = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email, password: form.password }) });
        onSuccess(data);
      } else if (mode === "register") {
        const result = await request("/auth/register", { method: "POST", body: JSON.stringify({ name: form.name, email: form.email, password: form.password }) });
        setEmail(form.email);
        setDevOtp(result.devOtp || "");
        setStep("verify");
      } else if (mode === "forgot") {
        const result = await request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: form.email }) });
        setEmail(form.email);
        setDevOtp(result.devOtp || "");
        setStep("reset");
      }
    } catch (error) {
      if (error.message.includes("Verify your email")) {
        setEmail(form.email);
        setStep("verify");
      } else {
        setLocalError(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      if (step === "verify") {
        const data = await request("/auth/verify-otp", { method: "POST", body: JSON.stringify({ email, otp: form.otp }) });
        onSuccess(data);
      } else {
        await request("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ email, otp: form.otp, password: form.newPassword }),
        });
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setLocalError("");
    try {
      const result = await request("/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ email, purpose: step === "verify" ? "verify" : "reset" }),
      });
      setDevOtp(result.devOtp || "");
      setNotice("A fresh code has been sent to your email.");
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    login: ["Welcome back", "Sign in to pick up where you left off.", "Sign in"],
    register: ["Create your account", "Start building confidence for your next interview.", "Create account"],
    forgot: ["Reset your password", "We'll send a one-time code to your email.", "Send reset code"],
  }[mode];

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="#" onClick={(event) => { event.preventDefault(); onBackToWelcome(); }}>
          <BrandMark />
          <span>InterviewPro</span>
        </a>
        <button className="auth-back-button" onClick={onBackToWelcome}><ArrowLeft size={15} /> Back to welcome</button>
      </header>
      <section className="auth-main">
        <div className="auth-card">
          {step === "form" ? (
            <>
              <div className="auth-heading"><div className="auth-icon"><Sparkles size={18} /></div><span className="auth-kicker">{mode === "register" ? "YOUR NEXT CHAPTER STARTS HERE" : mode === "forgot" ? "ACCOUNT RECOVERY" : "YOUR PRIVATE PRACTICE STUDIO"}</span><h2>{copy[0]}</h2><p>{copy[1]}</p></div>
              <form className="form-stack" onSubmit={submit}>
                {mode === "register" && <label>Full name<div className="input-wrap"><input required minLength="2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" autoComplete="name" /></div></label>}
                <label>Email address<div className="input-wrap"><Mail size={16} /><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" autoComplete="email" /></div></label>
                {mode !== "forgot" && <label>Password<div className="input-wrap"><LockKeyhole size={16} /><input type="password" required minLength="8" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} /></div></label>}
                {mode === "login" && <button className="text-button forgot-link" type="button" onClick={() => setMode("forgot")}>Forgot password?</button>}
                {(localError || notice) && <div className={`notice ${localError ? "notice-error" : ""}`}>{localError || notice}</div>}
                <button className="button button-primary full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{copy[2]} <ArrowRight size={16} /></button>
              </form>
              <div className="auth-switch">
                {mode === "login" ? <>New to InterviewPro? <button onClick={() => setMode("register")}>Create an account</button></> :
                  mode === "register" ? <>Already have an account? <button onClick={() => setMode("login")}>Sign in</button></> :
                    <>Remembered it? <button onClick={() => setMode("login")}>Back to sign in</button></>}
              </div>
              <div className="auth-foot"><ShieldCheck size={14} /> Your data is encrypted and never shared.</div>
            </>
          ) : (
            <>
              <div className="auth-heading"><div className="auth-icon"><Mail size={18} /></div><span className="auth-kicker">SECURE ACCOUNT</span><h2>{step === "verify" ? "Check your inbox" : "Choose a new password"}</h2><p>{step === "verify" ? `Enter the 6-digit code we sent to ${email}.` : `Enter the code sent to ${email}, then set a new password.`}</p></div>
              <form className="form-stack" onSubmit={verify}>
                <label>One-time code<div className="input-wrap"><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="000000" /></div></label>
                {step === "reset" && <label>New password<div className="input-wrap"><LockKeyhole size={16} /><input type="password" minLength="8" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} placeholder="At least 8 characters" autoComplete="new-password" /></div></label>}
                {devOtp && <div className="notice">Development email preview: your code is <strong>{devOtp}</strong>.</div>}
                {localError && <div className="notice notice-error">{localError}</div>}
                {notice && <div className="notice">{notice}</div>}
                <button className="button button-primary full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{step === "verify" ? "Verify email" : "Reset password"} <ArrowRight size={16} /></button>
                <button className="text-button centered" type="button" onClick={resendCode} disabled={busy}>Resend code</button>
              </form>
              <div className="auth-switch"><button onClick={() => { setStep("form"); setMode("login"); }}>Back to sign in</button></div>
            </>
          )}
        </div>
        <p className="auth-private-note"><ShieldCheck size={15} /> Your practice is private and your data is never shared.</p>
      </section>
    </main>
  );
}

function ProfileModal({ user, onClose, onSave, onLogout }) {
  const [name, setName] = useState(user.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button className="profile-modal-close" type="button" aria-label="Close profile" disabled={saving} onClick={onClose}><X size={17} /></button>
        <div className="profile-modal-heading">
          <div className="profile-modal-avatar">{name.trim().charAt(0).toUpperCase() || "U"}</div>
          <span className="auth-kicker">ACCOUNT SETTINGS</span>
          <h2 id="profile-title">Your profile</h2>
          <p>Manage how you appear in your private practice studio.</p>
        </div>
        <form className="profile-form" onSubmit={submit}>
          <label>Full name
            <input autoFocus required minLength="2" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>Email address
            <input value={user.email || ""} readOnly aria-describedby="profile-email-note" />
            <small id="profile-email-note">Your sign-in email can’t be changed here.</small>
          </label>
          <div className="profile-security-note"><ShieldCheck size={16} /><span>Your profile and interview practice are private.</span></div>
          {error && <div className="notice notice-error">{error}</div>}
          <div className="profile-modal-actions">
            <button className="profile-logout" type="button" disabled={saving} onClick={onLogout}><LogOut size={15} /> Sign out</button>
            <span />
            <button className="button button-outline" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving || name.trim().length < 2}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Dashboard({ user, token, interviews, sidebarOpen, onToggleSidebar, onOpenProfile, onNew, onResume, notice, refresh }) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await request(`/interviews/${deleteTarget._id}`, { token, method: "DELETE" });
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeleting(false);
    }
  }
  const completed = interviews.filter((item) => item.status === "completed");
  const performanceSessions = completed
    .filter((item) => item.summary?.dimensionScores)
    .slice()
    .reverse()
    .slice(-6);
  const skillStats = SKILL_DIMENSIONS.map((dimension) => {
    const series = performanceSessions.flatMap((session) => {
      const score = session.summary?.dimensionScores?.[dimension.key];
      return Number.isFinite(score) ? [{ session, score }] : [];
    });
    if (!series.length) return null;
    return {
      ...dimension,
      average: Math.round(series.reduce((sum, item) => sum + item.score, 0) / series.length),
      series,
    };
  }).filter(Boolean);
  const focusSkill = skillStats.slice().sort((left, right) => left.average - right.average)[0];
  const average = completed.length
    ? Math.round(completed.reduce((sum, item) => sum + (item.summary?.score || 0), 0) / completed.length)
    : 0;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="page-content dashboard-content">
      <header className="topbar">
        <div className="dashboard-topbar-left"><button className="workspace-menu-button" type="button" aria-label={sidebarOpen ? "Collapse navigation" : "Open navigation"} aria-expanded={sidebarOpen} onClick={onToggleSidebar}><Menu size={17} /></button><div className="breadcrumb">Workspace <span>/</span> Overview</div></div>
        <div className="topbar-right"><span className="secure-tag"><ShieldCheck size={14} /> Private workspace</span><button className="dashboard-profile-button" type="button" onClick={onOpenProfile}><div className="avatar small-avatar">{user.name?.[0]?.toUpperCase()}</div><span>{user.name?.split(" ")[0]}</span><ChevronDown size={14} /></button></div>
      </header>
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-greeting">{greeting}, {user.name?.split(" ")[0]}</div>
          <h1>Feel ready for your<br /><em>next interview.</em></h1>
          <p>Practice out loud with your AI interviewer. Get thoughtful feedback and build confidence one answer at a time.</p>
          <div className="dashboard-hero-actions">
            <button className="button button-primary" onClick={() => onNew("mock")}><Plus size={17} /> Start a mock interview <ArrowRight size={15} /></button>
            <button className="button dashboard-guided-button" onClick={() => onNew("guided")}><Sparkles size={16} /> Guided practice</button>
          </div>
          <div className="dashboard-privacy-note"><ShieldCheck size={15} /> Private practice, at your pace.</div>
        </div>
        <aside className="dashboard-hero-visual" aria-label="Voice-first interview practice">
          <span className="dashboard-voice-kicker">VOICE PRACTICE</span>
          <div className="dashboard-visual-wave" aria-hidden="true">{[18, 28, 20, 42, 30, 55, 24, 46, 19, 34, 24, 50, 29, 40, 17].map((height, index) => <i key={index} style={{ height }} />)}</div>
          <span className="dashboard-visual-caption">Practice out loud, at your pace.</span>
        </aside>
      </section>
      {notice && <div className="notice notice-error dashboard-notice">{notice}<button onClick={refresh} className="text-button">Retry</button></div>}
      <div className="dashboard-stats-heading"><span>YOUR PRACTICE AT A GLANCE</span><span>Small steps add up.</span></div>
      <div className="stats-grid dashboard-stats-grid">
        <StatCard icon={<BriefcaseBusiness size={17} />} label="Practice sessions" value={interviews.length} sub="Keep showing up" color="purple" />
        <StatCard icon={<Award size={17} />} label="Average score" value={completed.length ? `${average}%` : "—"} sub={completed.length ? "Across completed sessions" : "Complete a session to see"} color="green" />
        <StatCard icon={<Clock3 size={17} />} label="Minutes practiced" value={interviews.reduce((sum, item) => sum + (item.duration || 0), 0)} sub="A little practice adds up" color="orange" />
      </div>
      {skillStats.length > 0 && (
        <section className="skill-insights" aria-label="Skill progress across completed sessions">
          <div className="skill-insights-heading"><div><h2>Your progress</h2><p>Six skills tracked across your latest practice sessions.</p></div><span>Last {performanceSessions.length} sessions</span></div>
          <div className="skill-grid">{skillStats.map((skill) => (
            <article className={`skill-card ${focusSkill?.key === skill.key ? "focus" : ""}`} key={skill.key}>
              <div className="skill-card-heading"><span>{skill.label}</span><strong>{skill.average}%</strong></div>
              <div className="skill-meter"><span style={{ width: `${skill.average}%` }} /></div>
              <div className="skill-sparkline" aria-label={`${skill.label} scores over recent sessions`}>
                {skill.series.map(({ session, score }) => <i key={session._id} title={`${new Date(session.createdAt).toLocaleDateString()}: ${score}%`} style={{ height: `${Math.max(5, score)}%` }} />)}
              </div>
            </article>
          ))}</div>
          {focusSkill && <p className="skill-focus-note"><Sparkles size={14} /> Next focus: <strong>{focusSkill.label}</strong>. Future questions adapt to your practice history.</p>}
        </section>
      )}
      <div className="section-heading dashboard-section-heading"><div><span className="dashboard-section-kicker">KEEP YOUR MOMENTUM</span><h2>Recent sessions</h2><p>Your practice history, all in one place.</p></div><button className="text-button" onClick={refresh}>Refresh <ArrowRight size={14} /></button></div>
      {interviews.length ? (
        <div className="session-list">{interviews.slice(0, 8).map((item) => (
          <div className="session-card" key={item._id}>
            <button className="session-card-main" type="button" onClick={() => item.status !== "completed" && onResume(item)} disabled={item.status === "completed"}>
            <div className="session-icon"><FileText size={17} /></div>
            <div className="session-main"><strong>{item.role}{item.mode === "guided" && <em className="guided-session-tag">Guided</em>}</strong><span>{item.difficulty} · {item.duration} min · {new Date(item.createdAt).toLocaleDateString()}</span></div>
            <span className={`status-pill ${item.status}`}>{item.status === "completed" ? <><Check size={12} /> Completed</> : <><Clock3 size={12} /> In progress</>}</span>
            <span className="session-score">{item.status === "completed" ? `${item.summary?.score ?? "—"}%` : <ArrowRight size={16} />}</span>
            </button>
            <button className="session-delete-button" type="button" title={`Delete ${item.role} interview`} aria-label={`Delete ${item.role} interview`} onClick={() => { setDeleteTarget(item); setDeleteError(""); }}><Trash2 size={15} /></button>
          </div>
        ))}</div>
      ) : (
        <div className="empty-state"><div className="empty-icon"><Headphones size={23} /></div><h3>Your next opportunity starts here.</h3><p>Upload a resume, choose a role, and your AI coach will take it from there.</p><button className="button button-dark" onClick={() => onNew("mock")}><Plus size={16} /> Create your first practice</button></div>
      )}
      <div className="bottom-tip"><Sparkles size={16} /><span><strong>Good to know</strong> — Your resume is used to personalize questions and is only saved with your account.</span></div>
      {deleteTarget && (
        <div className="delete-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}>
          <div className="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-interview-title" aria-describedby="delete-interview-description">
            <button className="delete-modal-close" type="button" aria-label="Close delete confirmation" disabled={deleting} onClick={() => setDeleteTarget(null)}><X size={16} /></button>
            <div className="delete-modal-icon"><Trash2 size={20} /></div>
            <h2 id="delete-interview-title">Delete this interview?</h2>
            <p id="delete-interview-description">"<strong>{deleteTarget.role}</strong>" and all of its answers and feedback will be permanently deleted.</p>
            {deleteError && <div className="notice notice-error">{deleteError}</div>}
            <div className="delete-modal-actions">
              <button className="button button-outline" type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="button button-danger" type="button" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{deleting ? "Deleting..." : "Delete interview"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-sub">{sub}</span></div>;
}

function SetupScreen({ token, initialMode, onBack, onStart, busy, notice, sidebarOpen, onToggleSidebar }) {
  const [role, setRole] = useState("");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [duration, setDuration] = useState("20");
  const [mode, setMode] = useState(initialMode);
  const [voice, setVoice] = useState("feminine");
  const [language, setLanguage] = useState("English");
  const [resumes, setResumes] = useState([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [savingResume, setSavingResume] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let active = true;
    request("/interviews/resumes", { token })
      .then(({ resumes: savedResumes }) => {
        if (active) setResumes(savedResumes);
      })
      .catch((error) => {
        if (active) setResumeError(error.message);
      });
    return () => { active = false; };
  }, [token]);

  async function chooseFile(file) {
    setResumeError("");
    if (!file) return;
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setResumeError("Upload a PDF, DOCX, or TXT resume.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setResumeError("Resume must be smaller than 5 MB.");
      return;
    }
    const body = new FormData();
    body.append("resume", file);
    setSavingResume(true);
    try {
      const { resume: savedResume } = await request("/interviews/resumes", { token, method: "POST", body });
      setResumes((current) => [savedResume, ...current.filter((item) => item._id !== savedResume._id)]);
      setSelectedResumeId(savedResume._id);
    } catch (error) {
      setResumeError(error.message);
    } finally {
      setSavingResume(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const body = new FormData();
    body.append("role", role);
    body.append("difficulty", difficulty);
    body.append("duration", duration);
    body.append("mode", mode);
    body.append("voiceStyle", voice);
    body.append("language", language);
    if (selectedResumeId) body.append("resumeId", selectedResumeId);
    onStart(body);
  }

  return (
    <div className="page-content setup-page">
      <header className="topbar"><div className="dashboard-topbar-left"><button className="workspace-menu-button" type="button" aria-label={sidebarOpen ? "Collapse navigation" : "Open navigation"} aria-expanded={sidebarOpen} onClick={onToggleSidebar}><Menu size={17} /></button><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to overview</button></div><span className="secure-tag"><ShieldCheck size={14} /> Your data stays private</span></header>
      <div className="setup-heading"><div className="eyebrow muted-eyebrow">LET'S MAKE IT COUNT</div><h1>Build your practice</h1><p>A few details help your AI coach make this feel like the real thing.</p></div>
      <form className="setup-card" onSubmit={submit}>
        <div className="practice-mode-options" role="radiogroup" aria-label="Choose a practice style">
          <button type="button" role="radio" aria-checked={mode === "mock"} className={`practice-mode-card ${mode === "mock" ? "selected" : ""}`} onClick={() => setMode("mock")}>
            <span className="practice-mode-icon"><BriefcaseBusiness size={17} /></span>
            <span><strong>Mock interview</strong><small>Realistic interview flow with feedback after each answer.</small></span>
            {mode === "mock" && <Check size={16} />}
          </button>
          <button type="button" role="radio" aria-checked={mode === "guided"} className={`practice-mode-card ${mode === "guided" ? "selected" : ""}`} onClick={() => setMode("guided")}>
            <span className="practice-mode-icon"><Sparkles size={17} /></span>
            <span><strong>Guided practice</strong><small>Learn a useful answer structure and get a personalized example.</small></span>
            {mode === "guided" && <Check size={16} />}
          </button>
        </div>
        <div className="form-section-title"><span className="section-number">01</span><div><h2>The opportunity</h2><p>What are you preparing for?</p></div></div>
        <label className="setup-label">Job title or interview type<div className="input-wrap"><BriefcaseBusiness size={16} /><input required value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Product Designer, Frontend Developer" maxLength="100" /></div></label>
        <div className="form-grid">
          <label className="setup-label">Difficulty<div className="select-wrap"><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><ChevronDown size={16} /></div></label>
          <label className="setup-label">Time limit<div className="select-wrap"><select value={duration} onChange={(e) => setDuration(e.target.value)}><option value="10">10 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option></select><ChevronDown size={16} /></div></label>
          <label className="setup-label">Interview language<div className="select-wrap"><select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="English">English</option><option value="Hindi">Hindi / हिन्दी</option></select><ChevronDown size={16} /></div></label>
        </div>
        <div className="form-section-title second-section"><span className="section-number">02</span><div><h2>Make it personal</h2><p>Give your coach the context it needs.</p></div></div>
        <div className="setup-label">Saved resumes <span className="optional">(optional, PDF / DOCX / TXT · max 5 MB each)</span></div>
        {resumes.length ? (
          <div className="saved-resume-list" role="radiogroup" aria-label="Choose a saved resume">
            {resumes.map((item) => (
              <button type="button" role="radio" aria-checked={selectedResumeId === item._id} className={`saved-resume ${selectedResumeId === item._id ? "selected" : ""}`} key={item._id} onClick={() => setSelectedResumeId(item._id)}>
                <span className="saved-resume-icon"><FileText size={16} /></span>
                <span className="saved-resume-copy"><strong>{item.name}</strong><small>Saved {new Date(item.createdAt).toLocaleDateString()}</small></span>
                {selectedResumeId === item._id && <Check size={16} />}
              </button>
            ))}
          </div>
        ) : <p className="resume-empty">No saved resumes yet. Upload one to reuse it in future interviews.</p>}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="upload-box" disabled={savingResume} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files?.[0]); }}>
          {savingResume ? <div className="upload-icon"><LoaderCircle className="spin" size={18} /></div> : <div className="upload-icon"><FileText size={18} /></div>}
          <span><strong>{savingResume ? "Saving resume..." : "Upload another resume"}</strong><small>{savingResume ? "Extracting and saving resume text" : "Choose a PDF, DOCX, or TXT file"}</small></span>
          {!savingResume && <ArrowDownLeft size={17} className="upload-arrow" />}
        </button>
        {resumeError && <div className="notice notice-error">{resumeError}</div>}
        <div className="form-section-title second-section"><span className="section-number">03</span><div><h2>Choose your coach</h2><p>Pick a voice that makes you feel comfortable.</p></div></div>
        <div className="voice-options">
          <button type="button" className={`voice-option ${voice === "feminine" ? "active" : ""}`} onClick={() => setVoice("feminine")}><img className="voice-avatar-image" src="/image_girl.png" alt="" /><span><strong>Maya</strong><small>Professional interviewer</small></span>{voice === "feminine" && <Check size={16} />}</button>
          <button type="button" className={`voice-option ${voice === "masculine" ? "active" : ""}`} onClick={() => setVoice("masculine")}><img className="voice-avatar-image" src="/image_boy.png" alt="" /><span><strong>Dev</strong><small>Warm raspy male interviewer</small></span>{voice === "masculine" && <Check size={16} />}</button>
        </div>
        {notice && <div className="notice notice-error setup-notice">{notice}</div>}
        <div className="setup-footer"><span><ShieldCheck size={15} /> Only extracted resume text is saved to your account.</span><button className="button button-primary" disabled={busy || savingResume || !role.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={16} />}{busy ? "Preparing..." : mode === "guided" ? "Start guided practice" : "Create interview"} <ArrowRight size={16} /></button></div>
      </form>
    </div>
  );
}

function InterviewScreen({ interview: initialInterview, user, token, videoRef, cameraOn, toggleCamera, onExit, isFullscreen, onEnterFullscreen, setNotice, notice }) {
  const [interview, setInterview] = useState(initialInterview);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamedFeedback, setStreamedFeedback] = useState("");
  const [speechBusy, setSpeechBusy] = useState(false);
  const [coachSpeaking, setCoachSpeaking] = useState(false);
  const [avatarState, setAvatarState] = useState("connecting");
  const [avatarActive, setAvatarActive] = useState(true);
  const [avatarSpeechSynced, setAvatarSpeechSynced] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [seconds, setSeconds] = useState(() => {
    const duration = initialInterview.duration * 60;
    const elapsed = Math.floor((Date.now() - new Date(initialInterview.createdAt).getTime()) / 1000);
    return Math.max(0, duration - elapsed);
  });
  const recorderRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const microphoneAnalyserRef = useRef(null);
  const microphoneSourceRef = useRef(null);
  const microphoneFrameRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const startingMicRef = useRef(false);
  const submitLockRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioSourcesRef = useRef([]);
  const speechAbortRef = useRef(null);
  const speechRequestRef = useRef(0);
  const avatarHideTimerRef = useRef(null);
  const avatarVideoRef = useRef(null);
  const avatarAudioRef = useRef(null);
  const avatarTrackRef = useRef(null);
  const avatarAudioTrackRef = useRef(null);
  const avatarAudioReadyRef = useRef(false);
  const avatarRoomRef = useRef(null);
  const avatarSocketRef = useRef(null);
  const avatarSessionIdRef = useRef("");
  const avatarSocketReadyRef = useRef(false);
  const avatarUtteranceOpenRef = useRef(false);
  const avatarConnectionFailedRef = useRef(false);
  const avatarErrorRef = useRef("");
  const avatarMessageRef = useRef("");
  const currentQuestion = interview.questions?.[interview.questions.length - 1];
  const lastAnswered = interview.questions?.[interview.questions.length - 2];
  const coachName = interview.voiceStyle === "masculine" ? "Dev" : "Maya";
  const coachImage = interview.voiceStyle === "masculine" ? "/image_boy.png" : "/image_girl.png";
  const guidedPractice = interview.mode === "guided";

  function stopMicVisualization() {
    if (microphoneFrameRef.current !== null) {
      window.cancelAnimationFrame(microphoneFrameRef.current);
      microphoneFrameRef.current = null;
    }
    microphoneSourceRef.current?.disconnect();
    microphoneSourceRef.current = null;
    microphoneAnalyserRef.current = null;
    setMicLevel(0);
    setUserSpeaking(false);
  }

  function startMicVisualization(stream) {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state === "closed") return;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    microphoneAnalyserRef.current = analyser;
    microphoneSourceRef.current = source;
    const samples = new Uint8Array(analyser.fftSize);
    let lastUpdate = 0;
    const updateLevel = (now) => {
      if (microphoneAnalyserRef.current !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = (samples[index] - 128) / 128;
        sum += sample * sample;
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 3);
      if (now - lastUpdate >= 60) {
        setMicLevel(level);
        setUserSpeaking(level > 0.045);
        lastUpdate = now;
      }
      microphoneFrameRef.current = window.requestAnimationFrame(updateLevel);
    };
    microphoneFrameRef.current = window.requestAnimationFrame(updateLevel);
  }

  function updateAvatarMessage(message) {
    avatarMessageRef.current = message;
    setAvatarMessage(message);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (seconds === 0 && !busy) onExit(true);
  }, [seconds, busy]);
  useEffect(() => {
    if (currentQuestion?.question) {
      const timer = window.setTimeout(() => speak(currentQuestion.question), 350);
      return () => window.clearTimeout(timer);
    }
  }, []);
  useEffect(() => {
    let active = true;
    let startTimer;
    let keepAliveTimer;
    let sessionId = "";
    let room;
    let socket;
    let avatarTrack;
    let avatarAudioTrack;
    let wsConnected = false;
    const interviewId = initialInterview._id;
    if (!avatarActive) {
      setAvatarState("fallback");
      updateAvatarMessage("Listening for your answer");
      return undefined;
    }
    avatarConnectionFailedRef.current = false;
    avatarErrorRef.current = "";
    updateAvatarMessage("");

    function updateAvatarStatus() {
      if (avatarAudioTrackRef.current && !avatarAudioReadyRef.current && avatarErrorRef.current) {
        setAvatarState("unavailable");
        updateAvatarMessage(avatarErrorRef.current);
      } else if (avatarTrack && wsConnected && avatarAudioReadyRef.current) {
        setAvatarState("ready");
        updateAvatarMessage("LiveAvatar video + synchronized audio");
      } else if (avatarTrack && wsConnected) {
        setAvatarState("connecting");
        updateAvatarMessage("LiveAvatar video is ready · starting synchronized audio");
      } else if (active) {
        setAvatarState("connecting");
      }
    }

    function showAvatarError(error) {
      if (!active) return;
      avatarConnectionFailedRef.current = true;
      const message = error?.message || "The live avatar could not connect.";
      console.error("LiveAvatar synchronization error:", error);
      avatarErrorRef.current = message;
      setAvatarState("unavailable");
      updateAvatarMessage(message);
    }

    async function connectAvatar() {
      try {
        const { Room, RoomEvent, Track } = await import("livekit-client");
        const { session } = await request(`/interviews/${interviewId}/avatar/session`, {
          token,
          method: "POST",
          body: "{}",
        });
        sessionId = session.sessionId;
        avatarSessionIdRef.current = sessionId;
        if (!active) {
          await request(`/interviews/${interviewId}/avatar/stop`, { token, method: "POST", body: "{}" });
          return;
        }

        room = new Room();
        avatarRoomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (!active) return;
          if (track.kind === Track.Kind.Video) {
            avatarTrack = track;
            avatarTrackRef.current = track;
            if (avatarVideoRef.current) track.attach(avatarVideoRef.current);
            updateAvatarStatus();
          } else if (track.kind === Track.Kind.Audio) {
            avatarAudioTrack = track;
            avatarAudioTrackRef.current = track;
            avatarAudioReadyRef.current = false;
            if (avatarAudioRef.current) {
              track.attach(avatarAudioRef.current);
              avatarAudioRef.current.play().then(() => {
                if (!active || avatarAudioTrackRef.current !== track) return;
                avatarAudioReadyRef.current = true;
                avatarErrorRef.current = "";
                updateAvatarStatus();
              }).catch(() => {
                if (!active) return;
                avatarErrorRef.current = "Allow audio playback to use synchronized live video.";
                updateAvatarMessage(avatarErrorRef.current);
                setAvatarState("unavailable");
              });
            }
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach();
          if (track === avatarTrack) {
            avatarTrack = null;
            avatarTrackRef.current = null;
            updateAvatarStatus();
          }
          if (track === avatarAudioTrack) {
            avatarAudioTrack = null;
            avatarAudioTrackRef.current = null;
            avatarAudioReadyRef.current = false;
            updateAvatarStatus();
          }
        });
        room.on(RoomEvent.Disconnected, () => {
          if (active) showAvatarError(new Error("The LiveAvatar video connection ended."));
        });
        await room.connect(session.livekitUrl, session.clientToken);
        if (!active) {
          await room.disconnect();
          return;
        }

        socket = new WebSocket(session.websocketUrl);
        avatarSocketRef.current = socket;
        await new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("LiveAvatar audio connection timed out.")), 20000);
          socket.onmessage = (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            if (message.type === "session.state_updated" && message.state === "connected") {
              wsConnected = true;
              avatarSocketReadyRef.current = true;
              window.clearTimeout(timeout);
              updateAvatarStatus();
              resolve();
            } else if (message.type === "error") {
              const details = message.error?.message || "LiveAvatar rejected an audio event.";
              showAvatarError(new Error(details));
            } else if (message.type === "session.state_updated" && message.state === "disconnected") {
              avatarSocketReadyRef.current = false;
              if (active) showAvatarError(new Error("The LiveAvatar audio connection closed."));
            }
          };
          socket.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error("Could not connect to the LiveAvatar audio stream."));
          };
          socket.onclose = () => {
            avatarSocketReadyRef.current = false;
            if (!wsConnected) {
              window.clearTimeout(timeout);
              reject(new Error("LiveAvatar closed the audio connection before it was ready."));
            }
            if (active && wsConnected) showAvatarError(new Error("The LiveAvatar audio stream disconnected."));
          };
        });
        if (!active) return;
        keepAliveTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "session.keep_alive" }));
        }, 45000);
      } catch (error) {
        showAvatarError(error);
        if (room) await room.disconnect();
        if (sessionId) {
          try {
            await request(`/interviews/${interviewId}/avatar/stop`, { token, method: "POST", body: "{}" });
            sessionId = "";
            avatarSessionIdRef.current = "";
          } catch (stopError) {
            console.error("Could not stop LiveAvatar after a connection error:", stopError.message);
          }
        }
      }
    }

    startTimer = window.setTimeout(() => { void connectAvatar(); }, 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      window.clearInterval(keepAliveTimer);
      avatarSocketReadyRef.current = false;
      avatarUtteranceOpenRef.current = false;
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      if (avatarTrack) avatarTrack.detach();
      if (avatarAudioTrack) avatarAudioTrack.detach();
      if (room) void room.disconnect();
      avatarSocketRef.current = null;
      avatarRoomRef.current = null;
      avatarTrackRef.current = null;
      avatarAudioTrackRef.current = null;
      avatarAudioReadyRef.current = false;
      if (sessionId) {
        request(`/interviews/${interviewId}/avatar/stop`, { token, method: "POST", body: "{}" })
          .catch((error) => console.error("Could not stop LiveAvatar session:", error.message));
      }
    };
  }, [initialInterview._id, token, avatarActive]);
  useEffect(() => () => {
    speechRequestRef.current += 1;
    if (avatarHideTimerRef.current) window.clearTimeout(avatarHideTimerRef.current);
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.onerror = null;
      if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
    }
    if (microphoneFrameRef.current !== null) window.cancelAnimationFrame(microphoneFrameRef.current);
    microphoneSourceRef.current?.disconnect();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
    speechAbortRef.current?.abort();
    audioSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch { /* The source may already have ended. */ }
    });
    audioContextRef.current?.close();
  }, []);

  function prepareAudioOutput() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === "suspended") audioContextRef.current.resume().catch(() => {});
    return audioContextRef.current;
  }

  function stopAudioSources() {
    audioSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch { /* The source may already have ended. */ }
    });
    audioSourcesRef.current = [];
  }

  function sendAvatarAudio(audio) {
    const socket = avatarSocketRef.current;
    if (!audio || !avatarTrackRef.current || !avatarSocketReadyRef.current || socket?.readyState !== WebSocket.OPEN) return false;
    const maxChunkLength = 64000;
    try {
      for (let offset = 0; offset < audio.length; offset += maxChunkLength) {
        const event = {
          type: "agent.speak",
          audio: audio.slice(offset, offset + maxChunkLength - (maxChunkLength % 4)),
        };
        socket.send(JSON.stringify(event));
        avatarUtteranceOpenRef.current = true;
      }
      return true;
    } catch (error) {
      avatarSocketReadyRef.current = false;
      setAvatarState("unavailable");
      avatarErrorRef.current = `LiveAvatar audio could not be sent: ${error.message}`;
      updateAvatarMessage(`LiveAvatar audio could not be sent: ${error.message}`);
      return false;
    }
  }

  function finishAvatarAudio() {
    const socket = avatarSocketRef.current;
    if (!avatarUtteranceOpenRef.current || !avatarSocketReadyRef.current || socket?.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "agent.speak_end" }));
      avatarUtteranceOpenRef.current = false;
    } catch (error) {
      avatarSocketReadyRef.current = false;
      setAvatarState("unavailable");
      avatarErrorRef.current = `LiveAvatar audio could not be completed: ${error.message}`;
      updateAvatarMessage(`LiveAvatar audio could not be completed: ${error.message}`);
    }
  }

  function interruptAvatarAudio() {
    const socket = avatarSocketRef.current;
    if (avatarUtteranceOpenRef.current && avatarSocketReadyRef.current && socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "agent.interrupt" }));
        avatarUtteranceOpenRef.current = false;
      } catch (error) {
        avatarSocketReadyRef.current = false;
        setAvatarState("unavailable");
        avatarErrorRef.current = `LiveAvatar could not interrupt its audio: ${error.message}`;
        updateAvatarMessage(`LiveAvatar could not interrupt its audio: ${error.message}`);
      }
    }
  }

  async function waitForAvatarSyncReady(requestId) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (requestId !== speechRequestRef.current) return false;
      if (avatarTrackRef.current && avatarSocketReadyRef.current && avatarAudioReadyRef.current) return true;
      if (avatarConnectionFailedRef.current) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  }

  async function enableAvatarAudio() {
    const room = avatarRoomRef.current;
    const audio = avatarAudioRef.current;
    if (!room || !audio) {
      updateAvatarMessage("LiveAvatar audio is not ready yet. Please wait a moment.");
      return;
    }
    try {
      const playback = audio.play();
      const roomPlayback = typeof room.startAudio === "function" ? room.startAudio() : Promise.resolve();
      await Promise.all([playback, roomPlayback]);
      avatarAudioReadyRef.current = true;
      avatarErrorRef.current = "";
      if (avatarTrackRef.current && avatarSocketReadyRef.current) {
        setAvatarState("ready");
        updateAvatarMessage("LiveAvatar video + synchronized audio");
      }
    } catch (error) {
      setAvatarState("unavailable");
      avatarErrorRef.current = `LiveAvatar audio could not start: ${error.message}`;
      updateAvatarMessage(`LiveAvatar audio could not start: ${error.message}`);
    }
  }

  function speakWithBrowserVoice(text, requestId) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
        reject(new Error("Device speech is not supported in this browser."));
        return;
      }
      if (requestId !== speechRequestRef.current) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const language = interview.language === "Hindi" ? "hi-IN" : "en-US";
      const languagePrefix = language.split("-")[0].toLowerCase();
      const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(languagePrefix));
      utterance.lang = language;
      utterance.rate = 0.96;
      if (voice) utterance.voice = voice;
      utterance.onstart = () => {
        if (requestId === speechRequestRef.current) setCoachSpeaking(true);
      };
      utterance.onend = () => {
        if (requestId === speechRequestRef.current) setCoachSpeaking(false);
        resolve();
      };
      utterance.onerror = (event) => {
        if (requestId !== speechRequestRef.current || event.error === "canceled" || event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error("Your device could not play fallback speech."));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speak(text) {
    if (!text?.trim()) return;
    if (avatarHideTimerRef.current) {
      window.clearTimeout(avatarHideTimerRef.current);
      avatarHideTimerRef.current = null;
    }
    if (!avatarActive) {
      avatarConnectionFailedRef.current = false;
      avatarErrorRef.current = "";
      setAvatarState("connecting");
      updateAvatarMessage("");
      setAvatarActive(true);
    }
    const requestId = speechRequestRef.current + 1;
    speechRequestRef.current = requestId;
    speechAbortRef.current?.abort();
    window.speechSynthesis?.cancel();
    interruptAvatarAudio();
    stopAudioSources();
    const audioContext = prepareAudioOutput();
    const abortController = new AbortController();
    speechAbortRef.current = abortController;
    setSpeechBusy(true);
    setNotice("");
    let receivedAudio = false;
    let useSynchronizedAvatar = false;
    try {
      if (!audioContext) throw new Error("Audio playback is not supported in this browser.");
      if (avatarAudioTrackRef.current && avatarAudioRef.current?.paused) {
        try {
          await avatarAudioRef.current.play();
          avatarAudioReadyRef.current = true;
          avatarErrorRef.current = "";
        } catch (error) {
          avatarAudioReadyRef.current = false;
          setAvatarState("unavailable");
          avatarErrorRef.current = `Allow audio playback to use synchronized live video: ${error.message}`;
          updateAvatarMessage(`Allow audio playback to use synchronized live video: ${error.message}`);
        }
      }
      useSynchronizedAvatar = await waitForAvatarSyncReady(requestId);
      if (requestId !== speechRequestRef.current) return;
      setAvatarSpeechSynced(useSynchronizedAvatar);
      if (!useSynchronizedAvatar) {
        const reason = avatarErrorRef.current.slice(0, 300);
        setNotice(reason
          ? `${coachName}'s live avatar could not synchronize: ${reason}. Playing Gemini voice with the coach portrait.`
          : `${coachName}'s live avatar did not become ready in time. Playing Gemini voice with the coach portrait.`);
      }
      let response;
      try {
        response = await fetch(`${API_URL}/interviews/speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text: text.slice(0, 3000), voiceStyle: interview.voiceStyle, language: interview.language || "English" }),
          signal: abortController.signal,
        });
      } catch (error) {
        if (error.name !== "AbortError") logInterviewApiError("POST", "/interviews/speech", "network", error.message);
        throw error;
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || "The speech service is temporarily unavailable.";
        logInterviewApiError("POST", "/interviews/speech", response.status, message);
        throw new Error(message);
      }
      if (requestId !== speechRequestRef.current) return;
      if (!response.body) throw new Error("The browser could not start streamed audio playback.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let playbackEnd = audioContext.currentTime;
      const scheduleAudio = (base64) => {
        const binary = window.atob(base64);
        const samples = new Float32Array(Math.floor(binary.length / 2));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = view.getInt16(index * 2, true) / 32768;
        }
        if (!samples.length) return;
        const startAt = Math.max(audioContext.currentTime + 0.025, playbackEnd);
        const sentToSynchronizedAvatar = useSynchronizedAvatar && sendAvatarAudio(base64);
        if (useSynchronizedAvatar && !sentToSynchronizedAvatar) {
          throw new Error("The live avatar audio connection was lost. Speech stopped to avoid switching audio sources.");
        }
        const audioDuration = samples.length / 24000;
        if (sentToSynchronizedAvatar) {
          playbackEnd = startAt + audioDuration;
        } else {
          const audioBuffer = audioContext.createBuffer(1, samples.length, 24000);
          audioBuffer.copyToChannel(samples, 0);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          source.start(startAt);
          playbackEnd = startAt + audioBuffer.duration;
          audioSourcesRef.current.push(source);
          source.onended = () => {
            audioSourcesRef.current = audioSourcesRef.current.filter((item) => item !== source);
          };
        }
        receivedAudio = true;
        setCoachSpeaking(true);
      };
      const handleFrame = (frame) => {
        let eventName = "message";
        const data = [];
        frame.split("\n").forEach((line) => {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trim());
        });
        if (!data.length) return;
        const message = JSON.parse(data.join("\n"));
        if (eventName === "error") throw new Error(message.message || "The speech service stopped unexpectedly.");
        if (message.audio) scheduleAudio(message.audio);
        if (message.done) finishAvatarAudio();
      };
      let finished = false;
      while (!finished && requestId === speechRequestRef.current) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        pending = pending.replace(/\r\n/g, "\n");
        let boundary = pending.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          handleFrame(frame);
          if (frame.includes("\"done\":true")) finished = true;
          boundary = pending.indexOf("\n\n");
        }
        if (done) {
          if (pending.trim()) handleFrame(pending);
          finished = true;
        }
      }
      if (!receivedAudio) throw new Error("The speech service returned no audio.");
      if (audioContext.state === "suspended") {
        const resumed = await Promise.race([
          audioContext.resume().then(() => audioContext.state === "running").catch(() => false),
          new Promise((resolve) => window.setTimeout(() => resolve(false), 500)),
        ]);
        if (!resumed) throw new Error("Tap Repeat question to allow audio playback.");
      }
      while (requestId === speechRequestRef.current && audioContext.currentTime < playbackEnd) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      setCoachSpeaking(false);
    } catch (error) {
      if (requestId === speechRequestRef.current) {
        abortController.abort();
        interruptAvatarAudio();
        stopAudioSources();
        setCoachSpeaking(false);
        if (!receivedAudio) {
          setAvatarSpeechSynced(false);
          setAvatarActive(false);
          setAvatarState("fallback");
          updateAvatarMessage("Using your device's voice · no live lip-sync");
          setNotice(`Gemini voice is unavailable: ${error.message}. Playing the question with your device's voice instead.`);
          try {
            await speakWithBrowserVoice(text, requestId);
          } catch (fallbackError) {
            setNotice(`Gemini voice failed (${error.message}). ${fallbackError.message}`);
          }
        } else {
          setNotice(`Voice playback stopped: ${error.message}`);
        }
      }
    } finally {
      if (requestId === speechRequestRef.current) {
        setSpeechBusy(false);
        setAvatarSpeechSynced(false);
        if (useSynchronizedAvatar && receivedAudio) {
          avatarHideTimerRef.current = window.setTimeout(() => {
            avatarHideTimerRef.current = null;
            if (requestId !== speechRequestRef.current) return;
            setAvatarActive(false);
            setAvatarState("fallback");
            updateAvatarMessage("Listening for your answer");
          }, AVATAR_PORTRAIT_DELAY_MS);
        } else {
          setAvatarActive(false);
          setAvatarState("fallback");
          updateAvatarMessage("Listening for your answer");
        }
        if (speechAbortRef.current === abortController) speechAbortRef.current = null;
      }
    }
  }

  async function dictate() {
    if (isListening) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      setIsListening(false);
      return;
    }
    if (busy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Audio recording is not supported in this browser. Allow microphone access or type your answer.");
      return;
    }
    if (startingMicRef.current) return;
    prepareAudioOutput();
    startingMicRef.current = true;
    let microphoneStream;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported?.(type));
      const options = { audioBitsPerSecond: 64000 };
      if (mimeType) options.mimeType = mimeType;
      const recorder = new MediaRecorder(microphoneStream, options);
      recorderChunksRef.current = [];
      microphoneStreamRef.current = microphoneStream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recorderChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopMicVisualization();
        microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        recorderRef.current = null;
        setIsListening(false);
        setNotice("The microphone recording failed. Check your microphone and try again, or type your answer.");
      };
      recorder.onstop = async () => {
        stopMicVisualization();
        microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        recorderRef.current = null;
        setIsListening(false);
        const audio = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recorderChunksRef.current = [];
        if (!audio.size) {
          setNotice("No audio was recorded. Try speaking again or type your answer.");
          return;
        }
        if (audio.size > 12 * 1024 * 1024) {
          setNotice("That recording is too long to transcribe. Please record a shorter answer.");
          return;
        }
        void submitAudioAnswer(audio);
      };
      recorder.start(250);
      startMicVisualization(microphoneStream);
      setIsListening(true);
      setNotice("");
    } catch (error) {
      microphoneStream?.getTracks().forEach((track) => track.stop());
      stopMicVisualization();
      const message = error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
        ? "Microphone permission is blocked. Allow microphone access for this site in your browser settings, then try again. You can also type your answer."
        : error.name === "NotFoundError" || error.name === "DevicesNotFoundError"
          ? "No microphone was found. Connect a microphone or type your answer."
          : "The microphone could not be opened. Check your browser permissions and try again.";
      setNotice(message);
    } finally {
      startingMicRef.current = false;
    }
  }

  async function submitAnswerRequest(body) {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setBusy(true);
    setStreamedFeedback("");
    setNotice("");
    try {
      const data = await requestStream(`/interviews/${interview._id}/answer`, {
        token,
        body,
        onEvent: (event, payload) => {
          if (event === "feedback") setStreamedFeedback(payload.text || "");
        },
      });
      if (!data?.interview?.questions?.length) {
        throw new Error("The interview service did not return the next question. Please try again.");
      }
      const nextQuestion = data.interview.questions[data.interview.questions.length - 1]?.question;
      setInterview(data.interview);
      setAnswer("");
      await speak(nextQuestion || data.feedback);
    } catch (error) {
      setNotice(error.message);
    } finally {
      submitLockRef.current = false;
      setStreamedFeedback("");
      setBusy(false);
    }
  }

  async function submitAnswerText(answerText) {
    const cleanAnswer = answerText.trim();
    if (!cleanAnswer) return;
    await submitAnswerRequest(JSON.stringify({ answer: cleanAnswer }));
  }

  async function submitAudioAnswer(audio) {
    if (!audio.size || submitLockRef.current) return;
    if (audio.size > 12 * 1024 * 1024) {
      setNotice("That recording is too long to send. Please record a shorter answer.");
      return;
    }
    const extension = audio.type.split(";")[0].split("/")[1] || "webm";
    const body = new FormData();
    body.append("audio", audio, `answer.${extension}`);
    await submitAnswerRequest(body);
  }

  function submitAnswer(event) {
    event.preventDefault();
    if (isListening) return;
    prepareAudioOutput();
    void submitAnswerText(answer);
  }

  function stopSpeech() {
    speechRequestRef.current += 1;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    stopAudioSources();
    window.speechSynthesis?.cancel();
    setCoachSpeaking(false);
    setAvatarSpeechSynced(false);
    setSpeechBusy(false);
  }

  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  const totalQuestions = Math.max(1, interview.questions?.length || 1);
  const showLiveAvatar = avatarState === "ready" && Boolean(avatarTrackRef.current);
  return (
    <div className="interview-page">
      <header className="interview-topbar"><button className="back-button" onClick={() => onExit(false)}><ArrowLeft size={16} /> Exit practice</button><div className="interview-top-title"><span className="live-dot" /> {guidedPractice ? "GUIDED PRACTICE" : "LIVE PRACTICE"} <span className="top-divider">/</span> {interview.role}</div><div className="interview-top-actions">{!isFullscreen && <button className="interview-fullscreen-button" type="button" onClick={() => { void onEnterFullscreen(); }}><Maximize size={14} /> Fullscreen</button>}<div className={`timer ${seconds < 60 ? "timer-warning" : ""}`}><Clock3 size={15} /> {mins}:{secs}</div></div></header>
      {notice && <div className="notice notice-error interview-notice">{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}
      <div className="interview-body">
        <section className="coach-column">
          <div className="coach-video">
            <div className="coach-glow" />
            <video
              ref={avatarVideoRef}
              className={`live-avatar-video ${showLiveAvatar ? "active" : ""} ${coachSpeaking ? "speaking" : ""}`}
              autoPlay
              muted
              playsInline
              aria-label={`${coachName} live AI interviewer`}
            />
            <audio ref={avatarAudioRef} className="avatar-audio-output" autoPlay playsInline aria-label={`${coachName} synchronized voice`} />
            {!showLiveAvatar && (
              <div className={`coach-orb ${interview.voiceStyle} ${avatarState === "fallback" ? "idle" : ""} ${coachSpeaking ? "speaking" : ""}`}><img className="coach-portrait" src={coachImage} alt={`${coachName} interviewer`} /></div>
            )}
            <div className={`live-avatar-status ${avatarState}`} role="status">
              {avatarState === "ready"
                ? avatarMessage
                : avatarState === "fallback"
                  ? avatarMessage
                  : avatarState === "connecting"
                    ? "Connecting live avatar…"
                    : `Live video unavailable · ${avatarMessage}`}
            </div>
            {avatarState === "unavailable" && avatarAudioTrackRef.current && (
              <button className="avatar-audio-unlock" type="button" onClick={() => { void enableAvatarAudio(); }}><Headphones size={14} /> Enable synchronized audio</button>
            )}
            <div className="coach-caption"><span className="coach-status-dot" />{coachName} <span aria-live="polite">{coachSpeaking ? avatarSpeechSynced ? "· Speaking · lip-synced" : "· Audio playing" : speechBusy ? avatarState === "connecting" ? "· Waiting for live avatar" : "· Starting audio stream" : busy ? "· AI generating" : isListening ? "· Listening to your answer" : avatarState === "fallback" ? "· Listening" : "· Ready"}</span></div>
            <button className="sound-button" title="Repeat question" disabled={speechBusy} onClick={() => { prepareAudioOutput(); void speak(currentQuestion?.question); }}><Volume2 size={17} /></button>
            <div className="self-video">
              {cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="self-placeholder">{initialInterview.role ? "You" : "U"}</div>}
              <span>{user.name}</span>
              {isListening && <div className={`voice-indicator ${userSpeaking ? "speaking" : ""}`} role="status" aria-live="polite">
                <span className="voice-wave" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => {
                  const variation = [0.58, 0.82, 1, 0.7, 0.92, 0.66, 0.48][index];
                  const height = userSpeaking ? 4 + micLevel * variation * 27 : 3;
                  return <i key={index} style={{ height: `${height}px` }} />;
                })}</span>
                <span>{userSpeaking ? "Speaking" : "Listening"}</span>
              </div>}
            </div>
          </div>
          <div className="media-controls">
            <button className={`media-button ${isListening ? "enabled" : ""}`} onClick={dictate}><Mic size={17} /><span>{isListening ? "Listening" : "Start voice"}</span></button>
            <button className={`media-button ${cameraOn ? "enabled" : ""}`} onClick={toggleCamera}>{cameraOn ? <Video size={17} /> : <VideoOff size={17} />}<span>{cameraOn ? "Camera on" : "Camera off"}</span></button>
          </div>
          <div className="privacy-foot"><ShieldCheck size={14} /> Camera stays local; voice recordings go to Gemini for transcription and feedback.</div>
        </section>
        <section className="question-column">
          <div className="question-meta"><div className="eyebrow muted-eyebrow">QUESTION {Math.max(1, interview.questions.length)} · {interview.language || "English"}</div><span className="difficulty-tag">{interview.difficulty}</span></div>
          {guidedPractice && <div className="guided-hint"><Sparkles size={15} /><p><strong>Practice first, then learn.</strong> Answer in your own words. Afterward, your coach will show a clear structure and a sample shaped around your experience.</p></div>}
          <h1 className="question-text">{currentQuestion?.question || "Tell me about yourself and what drew you to this role."}</h1>
          {interview.questions?.length > 1 && interview.questions[interview.questions.length - 2]?.feedback && (
            <div className="feedback-card"><div className="feedback-top"><Sparkles size={15} /><strong>Coach's note</strong><span>{lastAnswered?.score ?? "—"}/100</span></div><p>{lastAnswered?.feedback}</p></div>
          )}
          {busy && streamedFeedback && (
            <div className="feedback-card"><div className="feedback-top"><Sparkles size={15} /><strong>Live feedback</strong></div><p>{streamedFeedback}</p></div>
          )}
          {lastAnswered?.dimensionScores && (
            <div className="dimension-feedback"><strong>Skills in this answer</strong><div className="dimension-score-grid">{SKILL_DIMENSIONS.map(({ key, label }) => <div key={key}><span>{label}</span><b>{lastAnswered.dimensionScores[key]}%</b></div>)}</div></div>
          )}
          {guidedPractice && lastAnswered?.sampleAnswer && (
            <section className="guided-coaching-card">
              <div className="guided-coaching-heading"><span><Sparkles size={15} /></span><div><strong>A stronger way to answer</strong><small>Use the structure, not a script to memorize.</small></div></div>
              <ol>{lastAnswered.answerFramework?.map((step, index) => <li key={`${index}-${step}`}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className="guided-sample-answer"><strong>Personalized example</strong><p>{lastAnswered.sampleAnswer}</p></div>
            </section>
          )}
          <form onSubmit={submitAnswer} className="answer-form">
            <label htmlFor="answer">Your answer</label>
            <textarea id="answer" required value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Take a breath, then share your answer. You can type or use voice input." rows="7" />
            <div className="answer-hint"><span className="answer-hint-copy">{isListening ? "Recording — finish speaking, then select Finish & send." : "Use voice recording or type your answer. Gemini transcribes your recording."}</span><span className="answer-word-count">{answer.trim().split(/\s+/).filter(Boolean).length} words</span></div>
            <div className="answer-actions">
              <button type="button" className={`button ${isListening ? "button-listening" : "button-outline"}`} disabled={busy} onClick={dictate}>{isListening ? <MicOff size={15} /> : <Mic size={15} />}{isListening ? "Finish & send" : "Start speaking"}</button>
              <button type="submit" className="button button-primary" disabled={busy || isListening || !answer.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}{busy ? (coachSpeaking ? "Speaking..." : speechBusy ? "Starting audio..." : "AI generating...") : "Submit answer"} <ArrowRight size={15} /></button>
            </div>
          </form>
          <div className="interview-progress"><div className="progress-label"><span>Session progress</span><span>{totalQuestions} {totalQuestions === 1 ? "question" : "questions"}</span></div><div className="progress-track"><div style={{ width: `${Math.min(100, totalQuestions * 20)}%` }} /></div></div>
          <button className="finish-button" disabled={busy || isListening} onClick={() => { stopSpeech(); onExit(true); }}><Check size={15} /> Finish practice and return to dashboard</button>
        </section>
      </div>
      <div className="interview-footer"><span><CircleHelp size={14} /> {guidedPractice ? "Use the example as a guide; keep every detail true to your experience." : "Your answers are private. This is a practice space, not a real interview."}</span><span><span className="footer-dot" /> {interview.difficulty} · {interview.duration} min</span></div>
      {!isFullscreen && (
        <div className="fullscreen-interview-guard" role="dialog" aria-modal="true" aria-labelledby="fullscreen-guard-title" aria-describedby="fullscreen-guard-description">
          <div className="fullscreen-interview-card">
            <div className="fullscreen-interview-icon"><Maximize size={20} /></div>
            <h2 id="fullscreen-guard-title">Fullscreen ended</h2>
            <p id="fullscreen-guard-description">The interview is paused. Return to fullscreen to continue, or exit the interview and resume it later.</p>
            {notice && <p className="fullscreen-interview-error" role="alert">{notice}</p>}
            <button className="button button-primary" type="button" onClick={() => { setNotice(""); void onEnterFullscreen(); }}><Maximize size={15} /> Return to fullscreen</button>
            <button className="fullscreen-interview-exit" type="button" onClick={() => { stopSpeech(); void onExit(false); }}><ArrowLeft size={15} /> Exit interview</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
