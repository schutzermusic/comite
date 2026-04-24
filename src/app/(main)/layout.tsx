import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import NotificationCenter from '@/components/layout/notification-center';
import { AtmosphericBackground } from '@/components/system/AtmosphericBackground';
import { GlobeControlProvider } from '@/contexts/GlobeControlContext';
import { ContractAIProvider } from '@/lib/stores/contract-ai-store';

/**
 * MainLayout - Dashboard Shell
 * 
 * ARCHITECTURE:
 * - Background layer is fixed (doesn't scroll)
 * - Main content scrolls normally within <main>
 * - Sidebar and header are part of the normal layout
 * 
 * GLOBE BEHAVIOR:
 * - The globe is rendered inside GlobeSlot on the dashboard page
 * - It sits BESIDE the Saúde Financeira panel in a 2-column layout
 * - Globe is clipped to its container and does NOT pollute other areas
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GlobeControlProvider>
      <ContractAIProvider>
        {/* Background layer - fixed, decorative only */}
        <AtmosphericBackground />

        <SidebarProvider>
          {/* UI Shell - Fixed Height (100dvh) for Control Room stability */}
          <div className="relative flex h-[100dvh] w-full overflow-hidden z-10">
            {/* Sidebar */}
            <AppSidebar />

            {/* Main Content Area - full height for dashboard canvas */}
            <SidebarInset className="flex flex-col flex-1 min-h-0 w-full bg-transparent overflow-hidden">
              <Header />
              <main className="flex-1 min-h-0 w-full relative overflow-auto">
                {children}
              </main>
            </SidebarInset>

            {/* Fixed Notification Center */}
            <div className="fixed top-3 md:top-4 right-3 md:right-4 z-[9999]">
              <NotificationCenter hiddenOnDashboard={true} />
            </div>
          </div>
        </SidebarProvider>
      </ContractAIProvider>
    </GlobeControlProvider>
  );
}
