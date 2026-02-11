/**
 * Brazil Maintenance Points Dataset
 * Local mock data for energy maintenance operations visualization
 */

export interface MaintenancePoint {
  position: [number, number]; // [longitude, latitude]
  weight: number; // Activity intensity (1-15)
  status: 'active' | 'risk' | 'completed';
  uf: string; // State code
  city: string;
}

export const brazilMaintenancePoints: MaintenancePoint[] = [
  // Southeast Region
  { position: [-46.6333, -23.5505], weight: 12, status: 'active', uf: 'SP', city: 'São Paulo' },
  { position: [-43.1729, -22.9068], weight: 9, status: 'active', uf: 'RJ', city: 'Rio de Janeiro' },
  { position: [-44.5550, -20.3194], weight: 8, status: 'risk', uf: 'MG', city: 'Belo Horizonte' },
  { position: [-47.8825, -15.7942], weight: 6, status: 'active', uf: 'DF', city: 'Brasília' },
  { position: [-47.0608, -22.9068], weight: 5, status: 'active', uf: 'SP', city: 'Campinas' },
  { position: [-43.9378, -19.9167], weight: 4, status: 'active', uf: 'MG', city: 'Uberlândia' },
  { position: [-40.3081, -20.3194], weight: 3, status: 'active', uf: 'ES', city: 'Vitória' },
  
  // Northeast Region
  { position: [-38.5014, -12.9730], weight: 7, status: 'active', uf: 'BA', city: 'Salvador' },
  { position: [-34.8770, -8.0476], weight: 6, status: 'active', uf: 'PE', city: 'Recife' },
  { position: [-38.5434, -3.7172], weight: 5, status: 'active', uf: 'CE', city: 'Fortaleza' },
  { position: [-35.2083, -5.7950], weight: 4, status: 'active', uf: 'RN', city: 'Natal' },
  { position: [-36.2406, -9.5713], weight: 3, status: 'risk', uf: 'AL', city: 'Maceió' },
  { position: [-34.8614, -7.2400], weight: 3, status: 'active', uf: 'PB', city: 'João Pessoa' },
  { position: [-37.0717, -10.9092], weight: 2, status: 'active', uf: 'SE', city: 'Aracaju' },
  { position: [-42.8014, -5.0892], weight: 2, status: 'completed', uf: 'PI', city: 'Teresina' },
  { position: [-44.3028, -2.5297], weight: 2, status: 'active', uf: 'MA', city: 'São Luís' },
  
  // South Region
  { position: [-49.2733, -25.4284], weight: 5, status: 'completed', uf: 'PR', city: 'Curitiba' },
  { position: [-51.2177, -30.0346], weight: 5, status: 'active', uf: 'RS', city: 'Porto Alegre' },
  { position: [-48.5482, -27.5949], weight: 4, status: 'risk', uf: 'SC', city: 'Florianópolis' },
  { position: [-51.2308, -30.0346], weight: 3, status: 'active', uf: 'RS', city: 'Caxias do Sul' },
  { position: [-50.3228, -25.4284], weight: 2, status: 'active', uf: 'PR', city: 'Londrina' },
  
  // Central-West Region
  { position: [-49.2539, -16.6864], weight: 4, status: 'active', uf: 'GO', city: 'Goiânia' },
  { position: [-56.0967, -15.6014], weight: 3, status: 'active', uf: 'MT', city: 'Cuiabá' },
  { position: [-54.6064, -20.4427], weight: 2, status: 'active', uf: 'MS', city: 'Campo Grande' },
  
  // North Region
  { position: [-60.0217, -3.1190], weight: 4, status: 'active', uf: 'AM', city: 'Manaus' },
  { position: [-48.5044, -1.4558], weight: 3, status: 'active', uf: 'PA', city: 'Belém' },
  { position: [-67.8106, -9.9747], weight: 2, status: 'active', uf: 'AC', city: 'Rio Branco' },
  { position: [-63.9039, -8.7619], weight: 2, status: 'active', uf: 'RO', city: 'Porto Velho' },
  { position: [-61.3261, 2.8195], weight: 1, status: 'completed', uf: 'RR', city: 'Boa Vista' },
  { position: [-51.0664, 0.0344], weight: 1, status: 'active', uf: 'AP', city: 'Macapá' },
  { position: [-48.5044, -1.4558], weight: 1, status: 'active', uf: 'TO', city: 'Palmas' },
];




















