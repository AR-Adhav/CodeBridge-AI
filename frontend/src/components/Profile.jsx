import "../Profile.css";

const sampleActivity = [];

export default function Profile({
  currentUser,
  onDeleteAccount,
  activityData = sampleActivity,
}) {
  const name = currentUser?.name || "CodeBridge User";
  const email = currentUser?.email || "No email available";
  const role = currentUser?.role || "user";

  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const formattedRole = role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const isAdmin = role.toLowerCase() === "admin";

  const totalTasks = activityData.reduce(
    (total, day) => total + Number(day.tasks || 0),
    0
  );

  const activeDays = activityData.filter(
    (day) => Number(day.visits || 0) > 0 || Number(day.tasks || 0) > 0
  ).length;

  return (
    <div className="profile-page">
      <div className="profile-heading">
        <div>
          <p className="profile-eyebrow">ACCOUNT</p>
          <h1>My Profile</h1>
          <p className="profile-subtitle">
            Manage your personal information and track your learning progress.
          </p>
        </div>
      </div>

      {/* Profile Overview */}
      <section className="profile-card profile-overview">
        <div className="profile-avatar">{initials}</div>

        <div className="profile-overview-info">
          <h2>{name}</h2>
          <p>{email}</p>

          <span className="profile-role">{formattedRole}</span>
        </div>

        <div className="profile-status">
          <span className="profile-status-dot"></span>
          Signed in
        </div>
      </section>

      {/* Personal Information */}
      <section className="profile-card">
        <div className="profile-section-heading">
          <div>
            <h2>Personal Information</h2>
            <p>Your account details</p>
          </div>

          <span className="profile-section-icon">👤</span>
        </div>

        <div className="profile-details-grid">
          <div className="profile-detail">
            <span className="profile-detail-label">Full Name</span>
            <strong>{name}</strong>
          </div>

          <div className="profile-detail">
            <span className="profile-detail-label">Email Address</span>
            <strong>{email}</strong>
          </div>

          <div className="profile-detail">
            <span className="profile-detail-label">Account Role</span>
            <strong>{formattedRole}</strong>
          </div>

          {currentUser?.id && (
            <div className="profile-detail">
              <span className="profile-detail-label">User ID</span>
              <strong>#{currentUser.id}</strong>
            </div>
          )}
        </div>
      </section>

      {/* Real User Activity & Growth Graph */}
      <section className="profile-card profile-activity-card">
        <div className="profile-section-heading">
          <div>
            <h2>Consistency & Activity Growth</h2>
            <p>Your real learning activity and growth over the last 7 days</p>
          </div>

          <span className="profile-section-icon">📈</span>
        </div>

        <div className="profile-activity-stats">
          <div className="profile-activity-stat">
            <span>Total Tasks Completed</span>
            <strong>{totalTasks}</strong>
          </div>

          <div className="profile-activity-stat">
            <span>Active Days</span>
            <strong>{activeDays}/7</strong>
          </div>

          <div className="profile-activity-stat">
            <span>Consistency</span>
            <strong>{Math.round((activeDays / 7) * 100)}%</strong>
          </div>
        </div>

        <div className="profile-activity-chart">
          <div className="profile-chart-heading">
            <h3>Activity Growth Trend</h3>

            <div className="profile-chart-legend">
              <span>
                <i className="profile-legend-visits" style={{ background: "#3498db" }}></i>
                Visits
              </span>

              <span>
                <i className="profile-legend-tasks" style={{ background: "#2ecc71" }}></i>
                Tasks Completed
              </span>
            </div>
          </div>

          {/* Modern SVG Line & Area Growth Chart powered by real backend data */}
          <div className="svg-chart-container" style={{ width: "100%", overflowX: "auto", marginTop: "1rem" }}>
            <svg viewBox="0 0 600 220" style={{ width: "100%", height: "auto", overflow: "visible" }}>
              <defs>
                <linearGradient id="taskGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2ecc71" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#2ecc71" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="visitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3498db" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#3498db" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Background Grid lines */}
              {[0, 50, 100, 150, 200].map((y, idx) => (
                <line
                  key={idx}
                  x1="40"
                  y1={y}
                  x2="580"
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeDasharray="4 4"
                />
              ))}

              {(() => {
                const safeData = activityData.length > 0 ? activityData : [
                  { date: "", day: "Mon", visits: 0, tasks: 0 },
                  { date: "", day: "Tue", visits: 0, tasks: 0 },
                  { date: "", day: "Wed", visits: 0, tasks: 0 },
                  { date: "", day: "Thu", visits: 0, tasks: 0 },
                  { date: "", day: "Fri", visits: 0, tasks: 0 },
                  { date: "", day: "Sat", visits: 0, tasks: 0 },
                  { date: "", day: "Sun", visits: 0, tasks: 0 },
                ];

                const maxVal = Math.max(
                  ...safeData.map(d => Math.max(Number(d.tasks || 0), Number(d.visits || 0))),
                  5 // Minimum Y-axis ceiling scale
                );

                const getX = (index) => 60 + index * (520 / Math.max(safeData.length - 1, 1));
                const getY = (val) => 200 - (val / maxVal) * 180;

                const taskPoints = safeData.map((d, i) => `${getX(i)},${getY(Number(d.tasks || 0))}`).join(" ");
                const visitPoints = safeData.map((d, i) => `${getX(i)},${getY(Number(d.visits || 0))}`).join(" ");

                const taskArea = `${getX(0)},200 ${taskPoints} ${getX(safeData.length - 1)},200`;
                const visitArea = `${getX(0)},200 ${visitPoints} ${getX(safeData.length - 1)},200`;

                return (
                  <>
                    {/* Area fills */}
                    <polygon points={taskArea} fill="url(#taskGradient)" />
                    <polygon points={visitArea} fill="url(#visitGradient)" />

                    {/* Visit Line */}
                    <polyline
                      fill="none"
                      stroke="#3498db"
                      strokeWidth="2.5"
                      points={visitPoints}
                    />

                    {/* Task Line */}
                    <polyline
                      fill="none"
                      stroke="#2ecc71"
                      strokeWidth="3"
                      points={taskPoints}
                    />

                    {/* Data Points & Labels */}
                    {safeData.map((d, i) => {
                      const cx = getX(i);
                      const tY = getY(Number(d.tasks || 0));
                      const vY = getY(Number(d.visits || 0));
                      return (
                        <g key={i}>
                          {/* Visit dot */}
                          <circle cx={cx} cy={vY} r="4" fill="#3498db" />
                          {/* Task dot */}
                          <circle cx={cx} cy={tY} r="5" fill="#2ecc71" />

                          {/* Hover Tooltip */}
                          <title>{`${d.date || d.day}: ${d.tasks || 0} tasks completed, ${d.visits || 0} visits`}</title>

                          {/* X-axis Day Label */}
                          <text
                            x={cx}
                            y="215"
                            fill="rgba(255, 255, 255, 0.7)"
                            fontSize="12"
                            textAnchor="middle"
                          >
                            {d.day}
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          </div>
        </div>

        <p className="profile-activity-note">
          Stay consistent! Visit CodeBridge AI regularly and complete your
          roadmap tasks to grow your learning score and track your progress.
        </p>
      </section>

      {/* Delete Account */}
      {!isAdmin && (
        <section className="profile-card profile-danger-card">
          <div className="profile-section-heading">
            <div>
              <h2>Delete Account</h2>
              <p>
                Permanently remove your CodeBridge AI account.
              </p>
            </div>

            <span className="profile-section-icon">⚠️</span>
          </div>

          <div className="profile-danger-row">
            <p>
              This action may permanently delete your account and its
              associated information. Make sure you want to continue.
            </p>

            <button
              type="button"
              className="profile-delete-button"
              onClick={onDeleteAccount}
            >
              Delete Account
            </button>
          </div>
        </section>
      )}
    </div>
  );
}