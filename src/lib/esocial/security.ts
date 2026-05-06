export function maskCpf(value?: string | null): string {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return "***.***.***-**";
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

export function maskCnpj(value?: string | null): string {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return "**.***.***/****-**";
  return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
}

export function onlyDigits(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

export function safeStorageLabel(path?: string | null): string {
  if (!path) return "storage seguro nao configurado";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const last = parts.at(-1) ?? "secure";
  return `.../${last}`;
}

export function getSafeXmlStorageKey(source: "manual_xml" | "certificate_sync", fileName: string): string {
  const safeName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96);

  return `esocial/${source}/${new Date().toISOString().slice(0, 10)}/${safeName || "event.xml"}`;
}

export function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      const lowered = key.toLowerCase();
      if (lowered.includes("cpf")) return [key, maskCpf(String(value ?? ""))];
      if (lowered.includes("cnpj")) return [key, maskCnpj(String(value ?? ""))];
      if (lowered.includes("password") || lowered.includes("senha") || lowered.includes("cert")) {
        return [key, "[redacted]"];
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        return [key, value];
      }
      return [key, String(value)];
    }),
  );
}
