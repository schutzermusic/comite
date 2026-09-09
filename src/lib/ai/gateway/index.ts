if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/gateway must not be imported in the browser');
}

import { AnthropicApexAdapter } from './anthropic-adapter';
import { ApexAIGateway } from './apex-ai-gateway';

let gateway: ApexAIGateway | null = null;

export function getApexAIGateway(): ApexAIGateway {
  gateway ??= new ApexAIGateway([new AnthropicApexAdapter()]);
  return gateway;
}

export { ApexAIGateway } from './apex-ai-gateway';
export { AnthropicApexAdapter } from './anthropic-adapter';
export { ApexAIError } from './errors';
export { APEX_AI_TASKS } from './types';
export {
  getApexAITaskPolicy,
  CURRENT_PRODUCTION_TASKS,
  DEFAULT_PRODUCTION_MODEL,
  EXPLICIT_ESCALATION_MODEL,
  type ApexAIProductionTask,
} from './task-registry';
export type * from './types';
