import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import NotificationCenter from '@/components/layout/notification-center';
import { ImmersiveSpatialBackground } from '@/components/system/ImmersiveSpatialBackground';
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
        <SidebarProvider>
          {/* Background layer - fixed, decorative only */}
          <ImmersiveSpatialBackground className="fixed inset-0 z-0 pointer-events-none" />

          {/* UI Shell */}
          <div className="relative min-h-screen flex w-full z-10">
            {/* Sidebar */}
            <AppSidebar />

            {/* Main Content Area */}
            <SidebarInset className="flex flex-col w-full bg-transparent">
              <Header />
              {/* Scrollable content - Globe is in GlobeSlot beside Saúde Financeira */}
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </SidebarInset>

            {/* Fixed Notification Center */}
            <div className="fixed top-3 md:top-4 right-3 md:right-4 z-[9999]">
              <NotificationCenter />
            </div>
          </div>
        </SidebarProvider>
      </ContractAIProvider>
    </GlobeControlProvider>
  );
}
