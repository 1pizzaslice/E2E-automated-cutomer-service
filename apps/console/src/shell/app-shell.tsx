import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "../auth/session-context.js";
import { PERMISSION, can, type Permission } from "../lib/permissions.js";

interface NavItem {
  readonly label: string;
  readonly to: string;
  readonly permission: Permission;
}

/**
 * Primary navigation, gated by the caller's permissions (from `GET /v1/me`).
 * `client_viewer` lacks `qa_reviews:read`, so the QA tab never renders for it;
 * every role can read the approvals queue (the decide actions are gated inside
 * the evidence view). The API enforces the same rules — this is UI courtesy.
 */
const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Approvals",
    to: "/approvals",
    permission: PERMISSION.approvalsRead,
  },
  { label: "QA Reviews", to: "/qa", permission: PERMISSION.qaReviewsRead },
];

export function AppShell() {
  const { identity, signOut } = useSession();
  const items = NAV_ITEMS.filter((item) => can(identity, item.permission));

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Support Reviewer Console</span>
        <nav className="topnav" aria-label="Primary">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span className="user-email">
            {identity.email ?? identity.user_id}
          </span>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
