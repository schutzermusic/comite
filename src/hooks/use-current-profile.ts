'use client';

import { useCurrentUser } from './use-current-user';

export function useCurrentProfile() {
  const { profile, organization, roles, loading, refresh } = useCurrentUser();
  return { profile, organization, roles, loading, refresh };
}
