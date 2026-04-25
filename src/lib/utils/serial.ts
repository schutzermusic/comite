export function generateSerial(prefix: string, id: string, year?: number): string {
  const y = year ?? new Date().getFullYear();
  const num = id.replace(/\D/g, '').padStart(4, '0').slice(-4);
  return `${prefix}-${y}-${num}`;
}

export const deliberationSerial = (id: string) => generateSerial('DEL', id);
export const contractSerial = (id: string) => generateSerial('CTR', id);
export const projectSerial = (id: string) => generateSerial('PRJ', id);
export const riskSerial = (id: string) => generateSerial('RSK', id);
