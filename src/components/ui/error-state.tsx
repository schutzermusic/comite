import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Erro ao carregar',
  message = 'Ocorreu um erro ao carregar os dados. Tente novamente.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <Card className={cn('border-red-200 shadow-lg bg-red-50/50', className)}>
      <CardContent className="p-12 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-600 mb-6 max-w-md mx-auto">{message}</p>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            className="border-red-300 hover:bg-red-50"
          >
            Tentar Novamente
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

