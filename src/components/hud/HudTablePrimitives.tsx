"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const HudTableElement = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-ig-body-sm", className)} {...props} />
  </div>
));
HudTableElement.displayName = "HudTableElement";

const HudTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-ig-border", className)} {...props} />
));
HudTableHeader.displayName = "HudTableHeader";

const HudTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
HudTableBody.displayName = "HudTableBody";

const HudTableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t border-ig-border bg-ig-bg-raised font-medium", className)}
    {...props}
  />
));
HudTableFooter.displayName = "HudTableFooter";

const HudTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-ig-border-subtle transition-colors hover:bg-ig-bg-panel-hover data-[state=selected]:bg-ig-accent-weak",
      className,
    )}
    {...props}
  />
));
HudTableRow.displayName = "HudTableRow";

const HudTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle text-ig-label font-medium uppercase text-ig-fg-muted [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
HudTableHead.displayName = "HudTableHead";

const HudTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("p-4 align-middle text-ig-fg-default [&:has([role=checkbox])]:pr-0", className)} {...props} />
));
HudTableCell.displayName = "HudTableCell";

const HudTableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-ig-body-sm text-ig-fg-muted", className)} {...props} />
));
HudTableCaption.displayName = "HudTableCaption";

export {
  HudTableElement,
  HudTableHeader,
  HudTableBody,
  HudTableFooter,
  HudTableHead,
  HudTableRow,
  HudTableCell,
  HudTableCaption,
};
