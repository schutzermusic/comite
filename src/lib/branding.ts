import type { Organization } from '@/lib/auth/types';

export const PRODUCT_NAME = 'Insight Apex Board';
export const PRODUCT_SHORT_NAME = 'Apex Board';
export const PRODUCT_SIGNATURE = 'powered by Insight Apex';
export const PRODUCT_TAGLINE = 'Executive Governance Control Room';
export const PRODUCT_TAGLINE_PT = 'Governança executiva em tempo real';
export const PRODUCT_DEFAULT_BRAND_COLOR = '#008751';
export const PRODUCT_DEFAULT_LOGO_URL = '/LOGO INSIGHT.png';

export type BrandingOrganization = Pick<
  Organization,
  | 'name'
  | 'workspace_name'
  | 'logo_url'
  | 'brand_color'
  | 'email_from_name'
  | 'notification_name'
  | 'branding_enabled'
>;

function brandingActive(org: BrandingOrganization | null | undefined): boolean {
  if (!org) return false;
  return org.branding_enabled !== false;
}

export function getWorkspaceName(org: BrandingOrganization | null | undefined): string {
  if (!brandingActive(org)) return PRODUCT_NAME;
  const ws = org?.workspace_name?.trim();
  if (ws) return ws;
  const company = org?.name?.trim();
  if (company) return `${company} Board`;
  return PRODUCT_NAME;
}

export function getEmailFromName(org: BrandingOrganization | null | undefined): string {
  if (!brandingActive(org)) return PRODUCT_NAME;
  const v = org?.email_from_name?.trim();
  return v || getWorkspaceName(org);
}

export function getNotificationName(org: BrandingOrganization | null | undefined): string {
  if (!brandingActive(org)) return PRODUCT_NAME;
  const v = org?.notification_name?.trim();
  return v || getWorkspaceName(org);
}

export function getBrandColor(org: BrandingOrganization | null | undefined): string {
  if (!brandingActive(org)) return PRODUCT_DEFAULT_BRAND_COLOR;
  const v = org?.brand_color?.trim();
  return v || PRODUCT_DEFAULT_BRAND_COLOR;
}

export function getLogoUrl(org: BrandingOrganization | null | undefined): string {
  if (!brandingActive(org)) return PRODUCT_DEFAULT_LOGO_URL;
  const v = org?.logo_url?.trim();
  return v || PRODUCT_DEFAULT_LOGO_URL;
}

export function hasCustomLogo(org: BrandingOrganization | null | undefined): boolean {
  if (!brandingActive(org)) return false;
  const v = org?.logo_url?.trim();
  return !!v;
}

export type ResolvedBranding = {
  workspaceName: string;
  emailFromName: string;
  notificationName: string;
  brandColor: string;
  logoUrl: string;
  signature: string;
  productName: string;
  tagline: string;
};

export function resolveBranding(org: BrandingOrganization | null | undefined): ResolvedBranding {
  return {
    workspaceName: getWorkspaceName(org),
    emailFromName: getEmailFromName(org),
    notificationName: getNotificationName(org),
    brandColor: getBrandColor(org),
    logoUrl: getLogoUrl(org),
    signature: PRODUCT_SIGNATURE,
    productName: PRODUCT_NAME,
    tagline: PRODUCT_TAGLINE,
  };
}
