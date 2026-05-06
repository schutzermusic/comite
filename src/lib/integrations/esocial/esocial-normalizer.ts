export {
  MockEsocialNormalizer,
  MockEsocialXmlParser,
  classifyPayrollRubric,
} from "@/lib/esocial/services";

export const SUPPORTED_ESOCIAL_EVENTS = [
  "S-2200",
  "S-2300",
  "S-2206",
  "S-2230",
  "S-1200",
  "S-1210",
  "S-2299",
  "S-2399",
  "S-5001",
  "S-3000",
] as const;

export type SupportedEsocialEvent = (typeof SUPPORTED_ESOCIAL_EVENTS)[number];
