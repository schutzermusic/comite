"use client";

import { InsightLogo } from "./insight-logo";

export function HeaderBreadcrumb() {
  return (
    <div className="app-header-breadcrumb shrink-0">
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
        />
      </div>
    </div>
  );
}
