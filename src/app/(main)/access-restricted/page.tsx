import { HudPageLayout } from '@/components/hud';
import { AccessRestrictedState } from '@/components/auth/AccessRestrictedState';

export default function AccessRestrictedPage() {
  return (
    <HudPageLayout>
      <AccessRestrictedState />
    </HudPageLayout>
  );
}
