import { useCallback, useEffect, useMemo, useState } from "react";
import "./style.css";
import Profile from "./components/Profile";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

const defaultSkills = "Python, SQL, basic HTML/CSS";

const FALLBACK_REASON_TEXT = {
  invalid_json: "Gemini returned malformed JSON.",
  validation_failed: "Gemini's roadmap did not pass the quality checks.",
  empty_response: "Gemini returned an empty response.",
  api_unavailable: "Gemini was unavailable.",
  api_error: "Gemini rejected the request. Check GEMINI_API_KEY and GEMINI_MODEL.",
  unexpected_error: "An unexpected server error occurred.",
  no_api_key: "GEMINI_API_KEY is not configured.",
};

function getList(data, keys = []) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

function cleanWeekTitle(title, weekNumber) {
  const cleaned = String(title || "")
    .replace(/^\s*week\s*\d+\s*[:\-–]\s*/i, "")
    .trim();

  return cleaned || `Learning Focus ${weekNumber}`;
}

function buildRoadmapViewWeeks(roadmap) {
  const weeks = getList(roadmap, ["weeks"]);

  return weeks.map((weekObj, index) => {
    const weekNumber = Number(weekObj?.week) || index + 1;
    const seenIds = {};

    const tasks = (Array.isArray(weekObj?.tasks) ? weekObj.tasks : [])
      .map((task) =>
        typeof task === "string"
          ? task.trim()
          : String(task?.task || task?.title || task?.text || "").trim()
      )
      .filter(Boolean)
      .map((text) => {
        const baseId = `week-${weekNumber}-${slugify(text)}`;
        seenIds[baseId] = (seenIds[baseId] || 0) + 1;
        const taskId =
          seenIds[baseId] > 1 ? `${baseId}-${seenIds[baseId]}` : baseId;

        return {
          task_id: taskId,
          task_text: text,
          week_number: weekNumber,
        };
      });

    return {
      weekNumber,
      title: cleanWeekTitle(weekObj?.title, weekNumber),
      goal: String(weekObj?.goal || "").trim(),
      topics: Array.isArray(weekObj?.topics)
        ? weekObj.topics.map((topic) => String(topic).trim()).filter(Boolean)
        : [],
      tasks,
      miniProject: String(weekObj?.mini_project || "").trim(),
      outcome: String(weekObj?.outcome || "").trim(),
      resources: Array.isArray(weekObj?.resources)
        ? weekObj.resources.filter(
            (resource) =>
              resource &&
              typeof resource.url === "string" &&
              resource.url.startsWith("http")
          )
        : [],
    };
  });
}

function saveRoadmapLocally(userId, roadmap) {
  if (!userId) return;

  try {
    localStorage.setItem(
      `codebridge_roadmap_${userId}`,
      JSON.stringify(roadmap)
    );
  } catch (err) {
    console.error("Could not save roadmap locally:", err);
  }
}

async function fetchSavedProgress() {
  const response = await fetch(`${API}/api/roadmap/progress`, {
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Unable to load roadmap progress.");
  }

  const saved = {};

  (data.tasks || []).forEach((task) => {
    saved[task.task_id] = Boolean(task.completed);
  });

  return saved;
}

// Shared helper for authentication POST requests.
// Always sends credentials, parses JSON safely, and handles network failures.
async function postAuth(path, body) {
  try {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    return {
      ok: response.ok,
      status: response.status,
      data: data && typeof data === "object" ? data : {},
    };
  } catch (err) {
    console.error("Auth network error:", err);
    return {
      ok: false,
      status: 0,
      data: {
        error: "Unable to connect to the server. Check your connection and try again.",
      },
    };
  }
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [skills, setSkills] = useState(defaultSkills);
  const [role, setRole] = useState("Software Developer Intern");
  const [description, setDescription] = useState("");
  const [jobs, setJobs] = useState([]);
  const [analysis, setAnalysis] = useState(null);

  const [roadmapData, setRoadmapData] = useState(null);
  const [loadingRoadmap, setLoadingRoadmap] = useState(false);
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [hoursPerDay, setHoursPerDay] = useState(2);
  const [experience, setExperience] = useState("Beginner");
  const [completedTasks, setCompletedTasks] = useState({});
  const [profileActivity, setProfileActivity] = useState([]);

  const loadProfileActivity = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/profile/activity`, {
        credentials: "include",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not load profile activity.");
      }

      setProfileActivity(
        Array.isArray(data.activity) ? data.activity : []
      );
    } catch (err) {
      console.error("Profile activity error:", err);
    }
  }, []);

  function goTo(tab) {
    setActiveTab(tab);
    setError("");
  }

  const [projects, setProjects] = useState(() => {
    try {
      const saved = localStorage.getItem("codebridge_projects");
      return saved
        ? JSON.parse(saved)
        : [
            {
              id: 1,
              title: "Student Task Tracker API",
              description:
                "A simple REST API built with Flask and Python for managing daily student tasks.",
              technologies: "Python, Flask, SQLite",
              githubUrl: "https://github.com",
              liveUrl: "",
            },
          ];
    } catch {
      return [];
    }
  });

  const [loadingJobs, setLoadingJobs] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [jobType, setJobType] = useState("All");

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch(`${API}/api/auth/me`, {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data.user);
        } else {
          setCurrentUser(null);
        }
      } catch (err) {
        console.error("Could not check login session:", err);
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    }

    checkSession();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("codebridge_projects", JSON.stringify(projects));
    } catch (e) {
      console.error("Could not save projects", e);
    }
  }, [projects]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const response = await fetch(`${API}/api/jobs`);
      if (!response.ok) throw new Error("Could not load opportunities.");
      const data = await response.json();
      setJobs(getList(data, ["jobs", "data", "opportunities"]));
    } catch (err) {
      setJobs([]);
      setError("Unable to load jobs. Check that your backend is running.");
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!currentUser) {
      setRoadmapData(null);
      return;
    }

    try {
      const saved = localStorage.getItem(
        `codebridge_roadmap_${currentUser.id}`
      );
      setRoadmapData(saved ? JSON.parse(saved) : null);
    } catch (err) {
      console.error("Could not restore roadmap:", err);
      setRoadmapData(null);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setCompletedTasks({});
      return;
    }

    fetchSavedProgress()
      .then((saved) => setCompletedTasks(saved))
      .catch((err) => console.error("Could not load roadmap progress:", err));
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setProfileActivity([]);
      return;
    }

    async function recordVisitAndLoadActivity() {
      try {
        const visitResponse = await fetch(`${API}/api/profile/visit`, {
          method: "POST",
          credentials: "include",
        });

        if (!visitResponse.ok) {
          throw new Error("Could not record profile visit.");
        }

        await loadProfileActivity();
      } catch (err) {
        console.error("Activity tracking error:", err);
      }
    }

    recordVisitAndLoadActivity();
  }, [currentUser, loadProfileActivity]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const title = job.title || job.role || job.position || "";
      const company = job.company || job.organization || "";
      const text = `${title} ${company}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());
      const type = job.type || job.job_type || job.category || "Internship";
      const matchesType =
        jobType === "All" ||
        String(type).toLowerCase().includes(jobType.toLowerCase());
      return matchesSearch && matchesType;
    });
  }, [jobs, search, jobType]);

  async function handleAnalyze(event) {
    event?.preventDefault();
    setError("");
    setAnalyzing(true);

    try {
      const response = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills,
          target_role: role,
          job_description: description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed.");
      setAnalysis(data);
      setActiveTab("analyzer");
    } catch (err) {
      setError(err.message || "Could not connect to analysis service.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerateRoadmap(event) {
    event?.preventDefault();

    setError("");
    setLoadingRoadmap(true);

    try {
      const response = await fetch(`${API}/api/roadmap`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skills,
          target_role: role,
          experience,
          hours_per_day: Number(hoursPerDay),
          duration_weeks: Number(durationWeeks),
          job_description: description,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Roadmap generation failed.");
      }

      const viewWeeks = buildRoadmapViewWeeks(data);

      if (viewWeeks.length === 0) {
        throw new Error("The roadmap came back empty. Please try again.");
      }

      setRoadmapData(data);
      saveRoadmapLocally(currentUser?.id, data);
      setActiveTab("roadmap");

      const taskRecords = viewWeeks.flatMap((week) => week.tasks);

      const syncResponse = await fetch(`${API}/api/roadmap/progress/sync`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tasks: taskRecords,
        }),
      });

      if (!syncResponse.ok) {
        const syncData = await syncResponse.json().catch(() => ({}));
        throw new Error(
          syncData.error || "Could not synchronize roadmap tasks."
        );
      }

      setCompletedTasks(await fetchSavedProgress());
    } catch (err) {
      console.error("Roadmap error:", err);
      setError(err.message || "Could not generate or save your roadmap.");
    } finally {
      setLoadingRoadmap(false);
    }
  }

  async function handleRoadmapTaskChange(task, completed) {
    const previousValue = Boolean(completedTasks[task.task_id]);

    setCompletedTasks((prev) => ({
      ...prev,
      [task.task_id]: completed,
    }));

    try {
      const response = await fetch(`${API}/api/roadmap/progress`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task_id: task.task_id,
          task_text: task.task_text,
          week_number: task.week_number,
          completed,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not save task progress.");
      }
      await loadProfileActivity();
    } catch (err) {
      console.error("Task progress error:", err);

      setCompletedTasks((prev) => ({
        ...prev,
        [task.task_id]: previousValue,
      }));

      setError(err.message || "Could not save roadmap progress.");
    }
  }

  // Returns { success: true } on login, { verificationRequired: true, email }
  // when the account is unverified, or { success: false } on other errors.
  async function handleLogin(email, password) {
    setAuthError("");

    const result = await postAuth("/api/auth/login", { email, password });

    if (result.ok) {
      setCurrentUser(result.data.user);
      setActiveTab("dashboard");
      return { success: true };
    }

    if (result.status === 403 && result.data.verification_required === true) {
      return { success: false, verificationRequired: true, email };
    }

    setAuthError(result.data.error || "Login failed.");
    return { success: false };
  }

  // Returns { success: true, email } when the account was created and
  // a verification code was sent. The user cannot enter the dashboard yet.
  async function handleRegister(name, email, password, accountRole) {
    setAuthError("");

    const result = await postAuth("/api/auth/register", {
      name,
      email,
      password,
      role: accountRole,
    });

    if (result.ok) {
      return { success: true, email };
    }

    setAuthError(result.data.error || "Registration failed.");
    return { success: false };
  }

  // Returns { success, message } for the OTP verification screen.
  async function handleVerifyEmail(email, otp) {
    const result = await postAuth("/api/auth/verify-email", { email, otp });

    if (result.ok) {
      return {
        success: true,
        message: result.data.message || "Email verified successfully.",
      };
    }

    return {
      success: false,
      message: result.data.error || "Verification failed. Please try again.",
    };
  }

  // Returns { success, message, retryAfter } where retryAfter is the
  // cooldown in seconds if the backend asks the user to wait.
  async function handleResendOtp(email) {
    const result = await postAuth("/api/auth/resend-otp", { email });

    if (result.ok) {
      return {
        success: true,
        message:
          result.data.message ||
          "A new verification code has been sent to your email.",
        retryAfter: Number(result.data.retry_after) || undefined,
      };
    }

    const retryAfter =
      result.status === 429
        ? Number(result.data.retry_after) || 60
        : undefined;

    return {
      success: false,
      message:
        result.data.error || "Could not resend the verification code.",
      retryAfter,
    };
  }

  async function handleLogout() {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("Logout request failed:", err);
    }

    setCurrentUser(null);
    setAuthError("");
    setActiveTab("dashboard");
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete your CodeBridge AI account? This action cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API}/api/auth/account`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Unable to delete your account.");
        return;
      }

      setCurrentUser(null);
      setAuthError("");
      setActiveTab("dashboard");

      alert("Your account has been deleted successfully.");
    } catch (error) {
      console.error("Account deletion failed:", error);
      alert("Unable to connect to the server. Please try again.");
    }
  }

  const skillGaps = getList(analysis, ["skill_gaps", "gaps"]);
  const hiringSignals = getList(analysis, ["hiring_signals", "signals"]);
  const portfolioIdeas = getList(analysis, ["portfolio_ideas", "projects"]);

  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="brand-mark">CB</div>
        <p>Loading CodeBridge AI...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        onLogin={handleLogin}
        onRegister={handleRegister}
        onVerifyEmail={handleVerifyEmail}
        onResendOtp={handleResendOtp}
        error={authError}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CB</div>
          <div>
            <div className="brand-name">
              CodeBridge <span>AI</span>
            </div>
            <div className="brand-caption">FIRST-CODER CAREER AGENT</div>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => goTo("dashboard")}
          >
            <span className="nav-icon">⌂</span>
            Dashboard
          </button>
          <button
            className={`nav-item ${activeTab === "opportunities" ? "active" : ""}`}
            onClick={() => goTo("opportunities")}
          >
            <span className="nav-icon">◈</span>
            Find Opportunities
          </button>
          <button
            className={`nav-item ${activeTab === "analyzer" ? "active" : ""}`}
            onClick={() => goTo("analyzer")}
          >
            <span className="nav-icon">◎</span>
            Skill Analyzer
          </button>
          <button
            className={`nav-item ${activeTab === "portfolio" ? "active" : ""}`}
            onClick={() => goTo("portfolio")}
          >
            <span className="nav-icon">▤</span>
            Portfolio Builder
          </button>
          <button
            className={`nav-item ${activeTab === "roadmap" ? "active" : ""}`}
            onClick={() => goTo("roadmap")}
          >
            <span className="nav-icon">↗</span>
            Learning Roadmap
          </button>
          {currentUser.role === "recruiter" && (
            <button
              className={`nav-item ${activeTab === "recruiter-hub" ? "active" : ""}`}
              onClick={() => goTo("recruiter-hub")}
            >
              <span className="nav-icon">💼</span>
              Recruiter Hub
            </button>
          )}
          {currentUser.role === "admin" && (
            <button
              className={`nav-item ${activeTab === "admin-hub" ? "active" : ""}`}
              onClick={() => goTo("admin-hub")}
            >
              <span className="nav-icon">🛡️</span>
              Owner Admin Panel
            </button>
          )}
          <button
            className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => goTo("profile")}
          >
            <span className="nav-icon">👤</span>
            My Profile
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✦</div>
            <strong>Your first opportunity starts here.</strong>
            <p>Build skills. Show your work. Get noticed.</p>
            <button onClick={() => goTo("analyzer")}>
              Start your journey <span>→</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>
              {activeTab === "recruiter-hub"
                ? "Recruiter Hub"
                : activeTab === "admin-hub"
                ? "Owner Admin Panel"
                : activeTab === "profile"
                ? "My Profile"
                : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="status-dot" />
            <span>{currentUser.name}</span>
            <span className="user-role">
              {currentUser.role === "job_seeker"
                ? "Job Seeker"
                : currentUser.role === "recruiter"
                ? "Recruiter"
                : "Admin"}
            </span>
            <button className="logout-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <div className="page-content">
          {error && (
            <div className="error-message">
              <span>!</span> {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}

          {activeTab === "dashboard" && (
            <Dashboard
              role={role}
              skills={skills}
              analysis={analysis}
              jobsCount={jobs.length}
              projectsCount={projects.length}
              onNavigate={goTo}
            />
          )}

          {activeTab === "opportunities" && (
            <Opportunities
              jobs={filteredJobs}
              loading={loadingJobs}
              search={search}
              setSearch={setSearch}
              jobType={jobType}
              setJobType={setJobType}
            />
          )}

          {activeTab === "analyzer" && (
            <Analyzer
              role={role}
              setRole={setRole}
              skills={skills}
              setSkills={setSkills}
              description={description}
              setDescription={setDescription}
              analysis={analysis}
              skillGaps={skillGaps}
              hiringSignals={hiringSignals}
              analyzing={analyzing}
              onAnalyze={handleAnalyze}
            />
          )}

          {activeTab === "portfolio" && (
            <Portfolio
              projects={projects}
              setProjects={setProjects}
              ideas={portfolioIdeas}
              onAnalyze={() => goTo("analyzer")}
            />
          )}

          {activeTab === "roadmap" && (
            <Roadmap
              role={role}
              durationWeeks={durationWeeks}
              setDurationWeeks={setDurationWeeks}
              hoursPerDay={hoursPerDay}
              setHoursPerDay={setHoursPerDay}
              experience={experience}
              setExperience={setExperience}
              roadmapData={roadmapData}
              loadingRoadmap={loadingRoadmap}
              onGenerateRoadmap={handleGenerateRoadmap}
              completedTasks={completedTasks}
              onTaskChange={handleRoadmapTaskChange}
            />
          )}

          {activeTab === "recruiter-hub" && (
            <RecruiterHub currentUser={currentUser} onJobsUpdated={loadJobs} />
          )}

          {activeTab === "admin-hub" && <AdminHub onJobsUpdated={loadJobs} />}

          {activeTab === "profile" && (
            <Profile
              currentUser={currentUser}
              onDeleteAccount={handleDeleteAccount}
              activityData={profileActivity}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function AuthScreen({
  onLogin,
  onRegister,
  onVerifyEmail,
  onResendOtp,
  error,
}) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("job_seeker");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [otp, setOtp] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");

  const displayError = localError || error;

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;

    const timer = setTimeout(() => {
      setResendCooldown((seconds) => seconds - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [resendCooldown]);

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    setLocalError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting) return;

    setSubmitting(true);
    setMessage("");
    setLocalError("");

    try {
      if (mode === "register") {
        const result = await onRegister(name, email, password, role);

        if (result?.success) {
          setVerifyEmail(result.email);
          setOtp("");
          setPassword("");
          setResendCooldown(60);
          setMode("verify");
          setMessage(
            role === "recruiter"
              ? "Registration successful! We sent a 6-digit verification code to your email. After verifying, your recruiter account will be pending approval by the owner."
              : "Registration successful! Check your email for a 6-digit verification code."
          );
        }
      } else {
        const result = await onLogin(email, password);

        if (result?.verificationRequired) {
          setVerifyEmail(result.email);
          setOtp("");
          setPassword("");
          setMode("verify");
          setMessage(
            "Your email is not verified yet. Enter the 6-digit code we sent to your email, or request a new one."
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event) {
    event.preventDefault();

    if (submitting || otp.length !== 6) return;

    setSubmitting(true);
    setMessage("");
    setLocalError("");

    try {
      const result = await onVerifyEmail(verifyEmail, otp);

      if (result.success) {
        setEmail(verifyEmail);
        setPassword("");
        setOtp("");
        setMode("login");
        setMessage(
          "Email verified successfully. Please log in with your email and password."
        );
      } else {
        setLocalError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (submitting || resendCooldown > 0) return;

    setSubmitting(true);
    setMessage("");
    setLocalError("");

    try {
      const result = await onResendOtp(verifyEmail);

      if (result.success) {
        setMessage("A new verification code has been sent to your email.");
        setResendCooldown(result.retryAfter || 60);
      } else {
        setLocalError(result.message);
        if (result.retryAfter) {
          setResendCooldown(result.retryAfter);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleOtpChange(event) {
    const digitsOnly = event.target.value.replace(/\D/g, "").slice(0, 6);
    setOtp(digitsOnly);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">CB</div>

          <div>
            <div className="brand-name">
              CodeBridge <span>AI</span>
            </div>

            <div className="brand-caption">FIRST-CODER CAREER AGENT</div>
          </div>
        </div>

        <div className="auth-heading">
          <h1>
            {mode === "login"
              ? "Welcome back."
              : mode === "register"
              ? "Create your account."
              : "Verify your email."}
          </h1>

          <p>
            {mode === "login"
              ? "Continue your career journey with CodeBridge AI."
              : mode === "register"
              ? "Start building your skills and career opportunities."
              : "Enter the 6-digit code sent to your email address."}
          </p>
        </div>

        {mode !== "verify" && (
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "login" ? "selected" : ""}
              onClick={() => switchMode("login")}
            >
              Login
            </button>

            <button
              type="button"
              className={mode === "register" ? "selected" : ""}
              onClick={() => switchMode("register")}
            >
              Register
            </button>
          </div>
        )}

        {mode === "verify" ? (
          <form onSubmit={handleVerify} className="auth-form">
            <p>
              Verification code sent to <strong>{verifyEmail}</strong>
            </p>

            <label>
              Verification Code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={handleOtpChange}
                maxLength={6}
                pattern="[0-9]{6}"
                required
              />
            </label>

            {displayError && <div className="auth-error">{displayError}</div>}
            {message && <div className="auth-success">{message}</div>}

            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={submitting || otp.length !== 6}
            >
              {submitting ? "Please wait..." : "Verify Email"}
            </button>

            <button
              type="button"
              className="primary-button"
              onClick={handleResend}
              disabled={submitting || resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Resend Code in ${resendCooldown}s`
                : "Resend Verification Code"}
            </button>

            <button type="button" onClick={() => switchMode("login")}>
              Back to Login
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            {mode === "register" && (
              <>
                <label>
                  Full Name
                  <input
                    type="text"
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Account Type
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="job_seeker">Job Seeker</option>
                    <option value="recruiter">Recruiter</option>
                  </select>
                </label>
              </>
            )}

            <label>
              Email Address
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                placeholder="Enter your password (min 8 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>

            {displayError && <div className="auth-error">{displayError}</div>}
            {message && <div className="auth-success">{message}</div>}

            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Please wait..."
                : mode === "login"
                ? "Login to CodeBridge AI →"
                : "Create Account →"}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <span>Secure career workspace</span>
          <span>CodeBridge AI</span>
        </div>
      </div>
    </div>
  );
}

function RecruiterHub({ currentUser, onJobsUpdated }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [type, setType] = useState("Internship");
  const [location, setLocation] = useState("Remote");
  const [salary, setSalary] = useState("Stipend Provided");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("");
  const [myJobs, setMyJobs] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [loadingRequest, setLoadingRequest] = useState(false);

  const isApproved = currentUser.recruiter_status === "approved";

  const fetchRecruiterJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/jobs/recruiter`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setMyJobs(data.jobs || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (isApproved) {
      fetchRecruiterJobs();
    }
  }, [isApproved, fetchRecruiterJobs]);

  async function sendVerificationRequest() {
    setLoadingRequest(true);
    setRequestStatus("");
    try {
      const res = await fetch(`${API}/api/recruiter/request-verification`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send request.");
      setRequestStatus("✅ Verification request sent successfully to the owner!");
    } catch (err) {
      setRequestStatus(`❌ Error: ${err.message}`);
    } finally {
      setLoadingRequest(false);
    }
  }

  async function handlePostJob(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      const res = await fetch(`${API}/api/jobs/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          company,
          type,
          location,
          salary,
          description,
          skills: skills.split(",").map((s) => s.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessage(data.message);
      setTitle("");
      setCompany("");
      setDescription("");
      setSkills("");
      fetchRecruiterJobs();
      onJobsUpdated();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!isApproved) {
    return (
      <div className="panel empty-state" style={{ textAlign: "left", padding: "2rem" }}>
        <h2>Recruiter Account Pending Verification</h2>
        <p style={{ marginTop: "1rem", lineHeight: "1.6" }}>
          Your account status is currently <strong>{currentUser.recruiter_status}</strong>.
          The platform owner must verify your account before you can post job and internship opportunities.
        </p>

        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.03)", borderRadius: "8px" }}>
          <h4>Notify Owner Instantly</h4>
          <p style={{ fontSize: "0.9rem", margin: "0.5rem 0 1rem", opacity: 0.85 }}>
            Click below to instantly trigger an automated verification email notification directly to the platform owner.
          </p>
          <button
            onClick={sendVerificationRequest}
            className="primary-button"
            disabled={loadingRequest}
          >
            {loadingRequest ? "Sending Request..." : "📧 Send Verification Request to Owner ↗"}
          </button>
          {requestStatus && <p style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>{requestStatus}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeading
        eyebrow="RECRUITER PORTAL"
        title="Manage Job Opportunities"
        description="Post verified openings for CodeBridge AI learners."
      />

      <div className="panel" style={{ marginBottom: "2rem" }}>
        <h3>Post a New Opportunity</h3>
        {message && (
          <div className="auth-success" style={{ margin: "1rem 0" }}>
            {message}
          </div>
        )}
        {error && (
          <div className="auth-error" style={{ margin: "1rem 0" }}>
            {error}
          </div>
        )}

        <form
          onSubmit={handlePostJob}
          style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}
        >
          <input
            placeholder="Job Title (e.g. Junior Python Developer)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <input
            placeholder="Company Name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
            }}
          >
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="Internship">Internship</option>
              <option value="Apprenticeship">Apprenticeship</option>
              <option value="Full-time">Full-time</option>
            </select>
            <input
              placeholder="Location (e.g. Remote / Pune)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <input
            placeholder="Salary / Stipend (e.g. ₹15,000 / month)"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
          />
          <textarea
            placeholder="Job description and candidate expectations..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <input
            placeholder="Required Skills separated by comma (e.g. Python, Flask, SQL)"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
          />
          <button className="primary-button" type="submit">
            Submit for Owner Verification ↗
          </button>
        </form>
      </div>

      <h2>Your Submitted Listings ({myJobs.length})</h2>
      <div className="jobs-list" style={{ marginTop: "1rem" }}>
        {myJobs.map((job) => (
          <div
            className="panel"
            key={job.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h4>
                {job.title} — <em>{job.company}</em>
              </h4>
              <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                {job.description}
              </p>
            </div>
            <div>
              <span
                style={{
                  padding: "0.25rem 0.6rem",
                  borderRadius: "99px",
                  fontSize: "0.75rem",
                  background:
                    job.status === "approved"
                      ? "rgba(46,204,113,0.2)"
                      : "rgba(243,156,18,0.2)",
                  color: job.status === "approved" ? "#2ecc71" : "#f39c12",
                }}
              >
                {job.status.toUpperCase()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminHub({ onJobsUpdated }) {
  const [pendingRecruiters, setPendingRecruiters] = useState([]);

  const loadPending = useCallback(() => {
    fetch(`${API}/api/admin/recruiters/pending`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setPendingRecruiters(data.pending_recruiters || []))
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  async function handleVerify(userId, status) {
    await fetch(`${API}/api/admin/recruiters/${userId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    loadPending();
    onJobsUpdated();
  }

  return (
    <div>
      <PageHeading
        eyebrow="ADMIN OWNER CONTROL"
        title="Pending Recruiter Verifications"
        description="Approve or reject recruiter account requests."
      />

      {pendingRecruiters.length === 0 ? (
        <div className="panel empty-state">
          <strong>No pending recruiter requests right now.</strong>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {pendingRecruiters.map((rec) => (
            <div
              className="panel"
              key={rec.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h3>{rec.name}</h3>
                <p>{rec.email}</p>
                <small style={{ opacity: 0.7 }}>
                  Registered on: {rec.created_at}
                </small>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="primary-button"
                  style={{ background: "#2ecc71", padding: "0.5rem 1rem" }}
                  onClick={() => handleVerify(rec.id, "approved")}
                >
                  Approve
                </button>
                <button
                  className="primary-button"
                  style={{ background: "#e74c3c", padding: "0.5rem 1rem" }}
                  onClick={() => handleVerify(rec.id, "rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({ role, skills, analysis, jobsCount, projectsCount, onNavigate }) {
  const gapCount = getList(analysis, ["skill_gaps", "gaps"]).length;

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> YOUR CAREER JOURNEY
          </div>
          <h1>
            Turn your skills into
            <br />
            <span>your first opportunity.</span>
          </h1>
          <p className="page-description">
            Discover beginner-friendly roles, build proof of your skills, and
            track your career roadmap.
          </p>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Target Role" value={role} note="Current goal" icon="◎" tone="purple" />
        <StatCard label="Opportunities" value={jobsCount} note="Open listings" icon="◈" tone="green" />
        <StatCard label="Portfolio Projects" value={projectsCount} note="Built & showcased" icon="▤" tone="orange" />
      </section>

      <section className="dashboard-grid">
        <div className="panel career-panel">
          <div className="panel-heading">
            <div>
              <span className="section-number">01</span>
              <h2>Career Scan</h2>
            </div>
          </div>
          <p>
            <strong>Current skills:</strong> {skills}
          </p>
          <button
            className="primary-button"
            onClick={() => onNavigate("analyzer")}
          >
            Run AI Analyzer <span>↗</span>
          </button>
        </div>

        <div className="panel action-panel">
          <div className="panel-heading">
            <div>
              <span className="section-number">02</span>
              <h2>Action Plan</h2>
            </div>
          </div>
          <div className="action-list">
            <ActionItem
              icon="↗"
              title="Learning Roadmap"
              text="Generate a structured weekly study plan."
              onClick={() => onNavigate("roadmap")}
            />
            <ActionItem
              icon="▤"
              title="Portfolio Builder"
              text="Add and manage your personal coding projects."
              onClick={() => onNavigate("portfolio")}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function StatCard({ label, value, note, icon, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={{ fontSize: "1.2rem", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {value}
      </div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function ActionItem({ icon, title, text, onClick }) {
  return (
    <button className="action-item" onClick={onClick}>
      <span className="action-item-icon">{icon}</span>
      <span className="action-item-text">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <span className="action-arrow">→</span>
    </button>
  );
}

function Opportunities({ jobs, loading, search, setSearch, jobType, setJobType }) {
  return (
    <>
      <PageHeading
        eyebrow="OPPORTUNITY DISCOVERY"
        title="Find your first opportunity."
        description="Explore beginner-friendly roles and internships."
      />
      <section className="panel jobs-panel">
        <div className="jobs-toolbar">
          <div className="search-box">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles or companies..."
            />
          </div>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
            <option value="All">All opportunities</option>
            <option value="Internship">Internships</option>
            <option value="Apprenticeship">Apprenticeships</option>
          </select>
        </div>
        {loading ? (
          <div className="empty-state">
            <strong>Loading opportunities...</strong>
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <strong>No opportunities found.</strong>
          </div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job, idx) => (
              <JobCard key={job.id || idx} job={job} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function JobCard({ job }) {
  return (
    <article className="job-card">
      <div className="job-company-mark">{(job.company || "D").charAt(0)}</div>
      <div className="job-info">
        <div className="job-title-row">
          <h3>{job.title}</h3>
          <span className="job-type">{job.type}</span>
        </div>
        <p className="job-company">{job.company}</p>
        <p className="job-description">{job.description}</p>
        <div className="job-meta">
          <span>⌖ {job.location || "Remote"}</span>
          <span>₹ {job.salary || "Stipend"}</span>
        </div>
      </div>
      <span className="demo-label">{job.source || "Verified Listing"}</span>
    </article>
  );
}

function Analyzer({
  role,
  setRole,
  skills,
  setSkills,
  description,
  setDescription,
  analysis,
  skillGaps,
  hiringSignals,
  analyzing,
  onAnalyze,
}) {
  return (
    <>
      <PageHeading
        eyebrow="AI CAREER ANALYSIS"
        title="Understand your career fit."
        description="Compare your current skills with target role requirements."
      />
      <div className="analyzer-layout">
        <form className="panel analyzer-form" onSubmit={onAnalyze}>
          <h2>Your starting point</h2>
          <label>
            Target Role
            <input value={role} onChange={(e) => setRole(e.target.value)} required />
          </label>
          <label>
            Current Skills
            <textarea
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              rows={4}
              required
            />
          </label>
          <label>
            Job Description (Optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </label>
          <button className="primary-button" type="submit" disabled={analyzing}>
            {analyzing ? "Analyzing..." : "Analyze my career fit ↗"}
          </button>
        </form>

        <div className="panel analyzer-results">
          <h2>Career Insights</h2>
          {!analysis ? (
            <p>Run analysis to see skill gaps and recommendations.</p>
          ) : (
            <div className="insights-content">
              <h3>Skills to Develop</h3>
              <div className="skill-chip-list">
                {skillGaps.map((gap, i) => (
                  <span className="skill-chip" key={i}>
                    {typeof gap === "string" ? gap : gap.name}
                  </span>
                ))}
              </div>
              <h3>Hiring Signals</h3>
              <ul className="insight-list">
                {hiringSignals.map((signal, i) => (
                  <li key={i}>
                    {typeof signal === "string" ? signal : signal.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Portfolio({ projects, setProjects, ideas, onAnalyze }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tech, setTech] = useState("");
  const [github, setGithub] = useState("");
  const [live, setLive] = useState("");

  function handleAddProject(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const newProj = {
      id: Date.now(),
      title,
      description: desc,
      technologies: tech,
      githubUrl: github,
      liveUrl: live,
    };
    setProjects([newProj, ...projects]);
    setTitle("");
    setDesc("");
    setTech("");
    setGithub("");
    setLive("");
  }

  function handleDelete(id) {
    setProjects(projects.filter((p) => p.id !== id));
  }

  return (
    <>
      <PageHeading
        eyebrow="PROOF OF SKILLS"
        title="Portfolio Builder"
        description="Add and manage your actual coding projects."
      />

      <div className="panel" style={{ marginBottom: "2rem" }}>
        <h3>Add New Project</h3>
        <form
          onSubmit={handleAddProject}
          style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}
        >
          <input
            placeholder="Project Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            placeholder="Short description of what you built"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
          />
          <input
            placeholder="Technologies used (e.g. React, Flask, Python)"
            value={tech}
            onChange={(e) => setTech(e.target.value)}
          />
          <input
            placeholder="GitHub Repository URL"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
          />
          <input
            placeholder="Live Demo URL (Optional)"
            value={live}
            onChange={(e) => setLive(e.target.value)}
          />
          <button className="primary-button" type="submit">
            Add to Portfolio ↗
          </button>
        </form>
      </div>

      <h2>Your Projects ({projects.length})</h2>
      {projects.length === 0 ? (
        <p>No projects added yet. Add your first project above!</p>
      ) : (
        <div className="portfolio-grid">
          {projects.map((p) => (
            <article className="panel portfolio-card" key={p.id}>
              <h3>{p.title}</h3>
              <p>{p.description}</p>
              {p.technologies && (
                <small>
                  <strong>Tech:</strong> {p.technologies}
                </small>
              )}
              <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
                {p.githubUrl && (
                  <a href={p.githubUrl} target="_blank" rel="noreferrer">
                    GitHub ↗
                  </a>
                )}
                {p.liveUrl && (
                  <a href={p.liveUrl} target="_blank" rel="noreferrer">
                    Live Demo ↗
                  </a>
                )}
                <button
                  onClick={() => handleDelete(p.id)}
                  style={{
                    color: "#e74c3c",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {ideas.length > 0 && (
        <div style={{ marginTop: "3rem" }}>
          <h2>AI Suggested Project Ideas</h2>
          <div className="portfolio-grid" style={{ marginTop: "1rem" }}>
            {ideas.map((idea, i) => (
              <article className="panel portfolio-card" key={i}>
                <span className="project-label">AI IDEA</span>
                <h3>{typeof idea === "string" ? idea : idea.title}</h3>
                <p>
                  {typeof idea === "object"
                    ? idea.description
                    : "Build this to bridge your skill gap."}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const MODE_BADGES = {
  ai: { label: "AI generated", color: "#2ecc71" },
  fallback: { label: "Fallback plan", color: "#f39c12" },
  demo: { label: "Demo plan", color: "#3498db" },
};

function Roadmap({
  role,
  durationWeeks,
  setDurationWeeks,
  hoursPerDay,
  setHoursPerDay,
  experience,
  setExperience,
  roadmapData,
  loadingRoadmap,
  onGenerateRoadmap,
  completedTasks,
  onTaskChange,
}) {
  const viewWeeks = buildRoadmapViewWeeks(roadmapData);
  const allTasks = viewWeeks.flatMap((week) => week.tasks);
  const completedCount = allTasks.filter(
    (task) => Boolean(completedTasks[task.task_id])
  ).length;
  const totalCount = allTasks.length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const badge = MODE_BADGES[roadmapData?.mode];
  const missingSkills = getList(roadmapData, ["missing_skills"]);

  return (
    <>
      <PageHeading
        eyebrow="YOUR LEARNING JOURNEY"
        title="Personalized Learning Roadmap"
        description="Generate and follow a step-by-step practical study plan."
      />

      <form
        className="panel"
        onSubmit={onGenerateRoadmap}
        style={{ marginBottom: "2rem" }}
      >
        <h3>Configure Roadmap Parameters</h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          <label>
            Duration (Weeks: 1-12)
            <input
              type="number"
              min="1"
              max="12"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(Number(e.target.value))}
              required
            />
          </label>

          <label>
            Study Hours Per Day
            <input
              type="number"
              min="1"
              max="10"
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(Number(e.target.value))}
              required
            />
          </label>

          <label>
            Experience Level
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
            </select>
          </label>
        </div>

        <p style={{ marginTop: "0.75rem", opacity: 0.8 }}>
          Target role: <strong>{role}</strong>. You can change it in the Skill
          Analyzer.
        </p>

        <button
          className="primary-button"
          type="submit"
          disabled={loadingRoadmap}
          style={{ marginTop: "1rem" }}
        >
          {loadingRoadmap ? "Generating Roadmap..." : "Generate Custom Roadmap ↗"}
        </button>
      </form>

      {loadingRoadmap && (
        <div className="panel empty-state">
          <strong>Generating your personalized roadmap with Gemini...</strong>
          <p>This can take 20 to 40 seconds. Please keep this page open.</p>
        </div>
      )}

      {!loadingRoadmap && !roadmapData && (
        <div className="panel empty-state">
          <strong>
            Configure your preferences above and click Generate Custom Roadmap.
          </strong>
        </div>
      )}

      {!loadingRoadmap && roadmapData && (
        <div className="panel roadmap-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <h2>{roadmapData.title || `Learning Roadmap for ${role}`}</h2>
              <p>
                Target role: <strong>{roadmapData.target_role || role}</strong>
              </p>
              <p>
                Duration:{" "}
                <strong>
                  {roadmapData.duration_weeks || durationWeeks} weeks
                </strong>
                {roadmapData.hours_per_day
                  ? ` · ${roadmapData.hours_per_day} hours per day`
                  : ""}
                {roadmapData.experience ? ` · ${roadmapData.experience}` : ""}
              </p>
            </div>

            {badge && (
              <span
                style={{
                  padding: "0.35rem 0.75rem",
                  borderRadius: "999px",
                  border: `1px solid ${badge.color}`,
                  color: badge.color,
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                }}
              >
                {badge.label}
              </span>
            )}
          </div>

          {missingSkills.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <strong>Skills to build:</strong> {missingSkills.join(", ")}
            </div>
          )}

          <div style={{ marginTop: "1.25rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.4rem",
              }}
            >
              <strong>Overall progress</strong>
              <span>
                {completedCount} of {totalCount} tasks completed ({progressPercent}
                %)
              </span>
            </div>
            <div
              style={{
                height: "10px",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.1)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: "#2ecc71",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>

          {viewWeeks.length === 0 ? (
            <div className="empty-state" style={{ marginTop: "1.5rem" }}>
              <strong>This roadmap has no weeks yet. Generate a new one.</strong>
            </div>
          ) : (
            <div className="roadmap-list" style={{ marginTop: "1.5rem" }}>
              {viewWeeks.map((week) => (
                <div
                  className="roadmap-step"
                  key={week.weekNumber}
                  style={{
                    display: "block",
                    marginBottom: "1.5rem",
                    padding: "1rem",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <h3>
                    Week {week.weekNumber}: {week.title}
                  </h3>

                  {week.goal && (
                    <p>
                      <strong>Goal:</strong> {week.goal}
                    </p>
                  )}

                  {week.topics.length > 0 && (
                    <div style={{ margin: "0.5rem 0" }}>
                      <strong>Topics:</strong> {week.topics.join(" · ")}
                    </div>
                  )}

                  {week.tasks.length > 0 && (
                    <div style={{ margin: "0.5rem 0" }}>
                      <strong>Practical Tasks:</strong>

                      <ul style={{ paddingLeft: "1.2rem", marginTop: "0.5rem" }}>
                        {week.tasks.map((task) => {
                          const isCompleted = Boolean(
                            completedTasks[task.task_id]
                          );

                          return (
                            <li key={task.task_id} style={{ margin: "0.5rem 0" }}>
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: "0.6rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isCompleted}
                                  onChange={(event) =>
                                    onTaskChange(task, event.target.checked)
                                  }
                                  style={{ marginTop: "0.25rem" }}
                                />

                                <span
                                  style={{
                                    textDecoration: isCompleted
                                      ? "line-through"
                                      : "none",
                                    opacity: isCompleted ? 0.65 : 1,
                                  }}
                                >
                                  {task.task_text}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {week.miniProject && (
                    <p style={{ marginTop: "0.5rem" }}>
                      <strong>Mini-Project:</strong> {week.miniProject}
                    </p>
                  )}

                  {week.outcome && (
                    <p>
                      <strong>Measurable outcome:</strong> {week.outcome}
                    </p>
                  )}

                  {week.resources.length > 0 && (
                    <div style={{ margin: "0.5rem 0" }}>
                      <strong>Learning resources:</strong>
                      <ul style={{ paddingLeft: "1.2rem", marginTop: "0.4rem" }}>
                        {week.resources.map((resource, index) => (
                          <li key={`${week.weekNumber}-res-${index}`}>
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {resource.name} ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PageHeading({ eyebrow, title, description }) {
  return (
    <section className="page-heading">
      <div className="eyebrow">
        <span className="eyebrow-dot" /> {eyebrow}
      </div>
      <h1>{title}</h1>
      <p className="page-description">{description}</p>
    </section>
  );
}

export default App;