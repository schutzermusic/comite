import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn('border-slate-200 shadow-lg', className)}>
      <CardContent className="p-12 text-center">
        {Icon && (
          <Icon className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        )}
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        {description && (
          <p className="text-slate-600 mb-6 max-w-md mx-auto">{description}</p>
        )}
        {action && (
          <Button
            onClick={action.onClick}
            style={{
              background: 'linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%)',
            }}
          >
            {action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

