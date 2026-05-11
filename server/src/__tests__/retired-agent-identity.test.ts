import { describe, expect, it } from 'vitest';
import {
  HERMES_AGENT_ROSTER,
  STALE_HISTORICAL_AGENT_LABELS,
} from '../../../shared/src/types/hermes-agent.types.js';

describe('retired agent identity', () => {
  it('does not expose the retired review persona as a canonical or historical assignable Veritas agent label', () => {
    const retiredReviewPersona = `${'sa'}${'ge'}`;
    expect(HERMES_AGENT_ROSTER).not.toContain(retiredReviewPersona);
    expect(STALE_HISTORICAL_AGENT_LABELS).not.toContain(retiredReviewPersona);
  });
});
