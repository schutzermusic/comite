"use client";

import { InsightLogo } from "./insight-logo";

export function HeaderBreadcrumb() {
  return (
    <div className="app-header-breadcrumb">
      <div className="hud-header-brand">
        <span className="hud-sidebar-brand-aura" aria-hidden="true" />
        <span className="hud-sidebar-brand-pulse" aria-hidden="true" />
        <span className="hud-sidebar-brand-sweep" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--a" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--b" aria-hidden="true" />
        <span className="hud-sidebar-brand-spark hud-sidebar-brand-spark--c" aria-hidden="true" />
        <InsightLogo
          width={148}
          height={40}
          className="hud-sidebar-brand-logo"
          priority
          animated={false}
        />
      </div>
    </div>
  );
}
