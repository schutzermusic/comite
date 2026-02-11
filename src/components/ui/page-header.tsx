import { cn } from "@/lib/utils";
import { Button } from "./button";
import { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    icon?: LucideIcon;
    onClick: () => void;
  };
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({ 
  title, 
  description, 
  action, 
  breadcrumbs,
  className,
  children 
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4 mb-6", className)}>
      {breadcrumbs && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {breadcrumbs.map((crumb, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <span>/</span>}
              {crumb.href ? (
                <a href={crumb.href} className="hover:text-slate-900 transition-colors">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-slate-900 font-medium">{crumb.label}</span>
              )}
            </div>
          ))}
        </div>
      )}
      
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
          {description && (
            <p className="text-slate-600 text-base max-w-2xl">{description}</p>
          )}
        </div>
        
        {action && (
          <Button 
            onClick={action.onClick}
            className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
          >
            {action.icon && <action.icon className="w-4 h-4 mr-2" />}
            {action.label}
          </Button>
        )}
      </div>
      
      {children}
    </div>
  );
}

