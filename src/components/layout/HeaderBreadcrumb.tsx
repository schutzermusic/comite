import { InsightLogo } from "./insight-logo";
import { getCurrentUserContext } from "@/lib/auth/current-user";
import { getLogoUrl, getWorkspaceName } from "@/lib/branding";

export async function HeaderBreadcrumb() {
  const ctx = await getCurrentUserContext();
  const workspaceName = getWorkspaceName(ctx.organization);
  const logoUrl = getLogoUrl(ctx.organization);

  return (
    <div className="app-header-breadcrumb shrink-0 flex items-center gap-3">
      <div className="hud-header-brand shrink-0">
        <span className="hud-sidebar-brand-aura" aria-hidden="true" />
        <span className="hud-sidebar-brand-pulse" aria-hidden="true" />
        <span className="hud-sidebar-brand-sweep" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--a" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--b" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--c" aria-hidden="true" />
        <InsightLogo
          width={136}
          height={36}
          className="app-header-insight-logo hud-sidebar-brand-logo"
          priority
          animated={false}
          src={logoUrl}
          alt={workspaceName}
        />
      </div>
    </div>
  );
}
