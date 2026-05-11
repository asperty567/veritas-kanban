import type { AgentType } from './task.types.js';

/** Canonical HermesAgent profiles owned by the live runtime/control plane. */
export const HERMES_AGENT_ROSTER = [
  'default',
  'hawk',
  'blitz',
  'aura',
  'forge',
  'midas',
  'orbit',
  'signal',
  'helm',
  'scops',
] as const;

export type HermesAgentId = (typeof HERMES_AGENT_ROSTER)[number];

export const HERMES_AGENT_DISPLAY_NAMES: Record<HermesAgentId, string> = {
  default: 'Hermes',
  hawk: 'Hawk',
  blitz: 'Blitz',
  aura: 'Aura',
  forge: 'Forge',
  midas: 'Midas',
  orbit: 'Orbit',
  signal: 'Signal',
  helm: 'Helm',
  scops: 'SC Ops',
};

/** Runtime truth at the current cutover: these profiles are live/running. */
export const DEFAULT_RUNNING_HERMES_AGENT_IDS = ['default', 'hawk', 'blitz'] as const;

export const STALE_HISTORICAL_AGENT_LABELS = [
  'ops',
  'qa',
  'bolt',
  'spark',
  'rex',
  'scout',
  'dan',
  'link',
  'sage',
  'marshal',
] as const;

export function isHermesAgentId(value: string): value is HermesAgentId {
  return (HERMES_AGENT_ROSTER as readonly string[]).includes(value.toLowerCase());
}

export function isCanonicalAssignableAgent(
  value: AgentType | 'auto' | string | undefined
): boolean {
  if (!value || value === 'auto') return true;
  return isHermesAgentId(String(value).trim().toLowerCase());
}
