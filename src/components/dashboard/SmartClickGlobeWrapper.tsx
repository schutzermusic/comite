'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// Dynamic import to avoid SSR issues with WebGL
const BrazilOperationalGlobe = dynamic(
    () => import('@/components/maps/BrazilOperationalGlobe').then((mod) => mod.BrazilOperationalGlobe),
    {
        ssr: false,
        loading: () => (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full" />
                    <div className="absolute inset-0 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
            </div>
        ),
    }
);

interface SmartClickGlobeWrapperProps {
    className?: string;
}

/**
 * SmartClickGlobeWrapper
 * 
 * Wraps the BrazilOperationalGlobe - display only, no click actions
 */
export function SmartClickGlobeWrapper({ className }: SmartClickGlobeWrapperProps) {
    return (
        <div className={cn('relative w-full h-full', className)}>
            {/* The 3D Globe */}
            <BrazilOperationalGlobe
                className="w-full h-full"
                fillContainer
            />
        </div>
    );
}

export default SmartClickGlobeWrapper;
