/**
 * MCP Sprint Tools — Unit Tests
 *
 * Tests tool definitions, Zod validation, and mocked API calls.
 * Does NOT require a running server — all API calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSprintTool, sprintTools } from '../tools/sprints.js';

vi.mock('../utils/api.js', () => ({
  api: vi.fn(),
}));

import { api } from '../utils/api.js';
const mockApi = vi.mocked(api);

function parseToolResponse(result: any): any {
  const text = result.content[0].text;
  const jsonStart = text.indexOf('{');
  const jsonArrayStart = text.indexOf('[');
  const start =
    jsonStart === -1
      ? jsonArrayStart
      : jsonArrayStart === -1
        ? jsonStart
        : Math.min(jsonStart, jsonArrayStart);
  if (start === -1) return text;
  return JSON.parse(text.substring(start));
}

describe('Sprint MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool definitions', () => {
    it('should export 9 sprint tools', () => {
      expect(sprintTools).toHaveLength(9);
    });

    it('should have correct tool names', () => {
      const names = sprintTools.map((t) => t.name);
      expect(names).toContain('list_sprints');
      expect(names).toContain('get_sprint');
      expect(names).toContain('create_sprint');
      expect(names).toContain('update_sprint');
      expect(names).toContain('delete_sprint');
      expect(names).toContain('can_delete_sprint');
      expect(names).toContain('reorder_sprints');
      expect(names).toContain('get_archive_suggestions');
      expect(names).toContain('close_sprint');
    });

    it('should require id for get_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'get_sprint');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require label for create_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'create_sprint');
      expect(tool?.inputSchema.required).toContain('label');
    });

    it('should have force as optional on delete_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'delete_sprint');
      const forceProperty = tool?.inputSchema.properties.force;
      expect(forceProperty).toBeDefined();
      expect(forceProperty?.type).toBe('boolean');
      expect(tool?.inputSchema.required).not.toContain('force');
    });
  });

  describe('list_sprints', () => {
    it('should return an array of sprints', async () => {
      mockApi.mockResolvedValueOnce([{ id: 'sprint-1', label: 'Sprint 1' }] as any);
      const result = await handleSprintTool('list_sprints', {});
      expect(mockApi).toHaveBeenCalledWith('/api/sprints');
      const sprints = parseToolResponse(result);
      expect(Array.isArray(sprints)).toBe(true);
    });

    it('should accept empty args', async () => {
      mockApi.mockResolvedValueOnce([] as any);
      const result = await handleSprintTool('list_sprints', undefined);
      expect(result.content[0].type).toBe('text');
    });

    it('should pass includeHidden query param when true', async () => {
      mockApi.mockResolvedValueOnce([] as any);
      await handleSprintTool('list_sprints', { includeHidden: true });
      expect(mockApi).toHaveBeenCalledWith('/api/sprints?includeHidden=true');
    });
  });

  describe('create_sprint + get_sprint + delete_sprint lifecycle', () => {
    it('should create a sprint', async () => {
      const created = {
        id: 'sprint-created',
        label: '__test_sprint_lifecycle',
        description: 'Integration test sprint — safe to delete',
      };
      mockApi.mockResolvedValueOnce(created as any);

      const result = await handleSprintTool('create_sprint', {
        label: '__test_sprint_lifecycle',
        description: 'Integration test sprint — safe to delete',
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/sprints',
        expect.objectContaining({ method: 'POST' })
      );
      const sprint = parseToolResponse(result);
      expect(sprint.label).toBe('__test_sprint_lifecycle');
      expect(sprint.description).toBe('Integration test sprint — safe to delete');
      expect(sprint.id).toBe('sprint-created');
    });

    it('should get the created sprint', async () => {
      mockApi.mockResolvedValueOnce({
        id: 'sprint-created',
        label: '__test_sprint_lifecycle',
      } as any);
      const result = await handleSprintTool('get_sprint', { id: 'sprint-created' });
      expect(mockApi).toHaveBeenCalledWith('/api/sprints/sprint-created');
      const sprint = parseToolResponse(result);
      expect(sprint.id).toBe('sprint-created');
      expect(sprint.label).toBe('__test_sprint_lifecycle');
    });

    it('should update the sprint', async () => {
      mockApi.mockResolvedValueOnce({
        id: 'sprint-created',
        label: '__test_sprint_updated',
        isHidden: true,
      } as any);
      const result = await handleSprintTool('update_sprint', {
        id: 'sprint-created',
        label: '__test_sprint_updated',
        isHidden: true,
      });
      expect(mockApi).toHaveBeenCalledWith(
        '/api/sprints/sprint-created',
        expect.objectContaining({ method: 'PATCH' })
      );
      const sprint = parseToolResponse(result);
      expect(sprint.label).toBe('__test_sprint_updated');
      expect(sprint.isHidden).toBe(true);
    });

    it('should delete the sprint', async () => {
      mockApi.mockResolvedValueOnce(undefined as any);
      const result = await handleSprintTool('delete_sprint', { id: 'sprint-created' });
      expect(mockApi).toHaveBeenCalledWith('/api/sprints/sprint-created', { method: 'DELETE' });
      expect(result.content[0].text).toContain('deleted');
    });
  });

  describe('can_delete_sprint', () => {
    it('should report whether sprint can be deleted', async () => {
      mockApi.mockResolvedValueOnce({ allowed: true, referenceCount: 0 } as any);
      const result = await handleSprintTool('can_delete_sprint', { id: 'sprint-created' });
      expect(mockApi).toHaveBeenCalledWith('/api/sprints/sprint-created/can-delete');
      const data = parseToolResponse(result);
      const canDelete = data.canDelete ?? data.allowed;
      expect(canDelete).toBeDefined();
      expect(typeof canDelete).toBe('boolean');
    });
  });

  describe('force delete behavior', () => {
    it('should accept force=true flag', async () => {
      mockApi.mockResolvedValueOnce(undefined as any);
      const result = await handleSprintTool('delete_sprint', {
        id: 'sprint-force-delete',
        force: true,
      });
      expect(mockApi).toHaveBeenCalledWith('/api/sprints/sprint-force-delete?force=true', {
        method: 'DELETE',
      });
      expect(result.content[0].text).toContain('deleted');
    });
  });

  describe('get_archive_suggestions', () => {
    it('should return no-suggestions text for an empty array', async () => {
      mockApi.mockResolvedValueOnce([] as any);
      const result = await handleSprintTool('get_archive_suggestions', {});
      expect(mockApi).toHaveBeenCalledWith('/api/tasks/archive/suggestions');
      expect(result.content[0].text).toBe('No sprints ready to archive');
    });

    it('should return a JSON array when suggestions exist', async () => {
      mockApi.mockResolvedValueOnce([{ sprint: 'sprint-1', taskCount: 1, tasks: [] }] as any);
      const result = await handleSprintTool('get_archive_suggestions', {});
      const data = JSON.parse(result.content[0].text);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('close_sprint', () => {
    it('should archive completed tasks in a sprint', async () => {
      mockApi.mockResolvedValueOnce({ archived: 2, taskIds: ['task-1', 'task-2'] } as any);
      const result = await handleSprintTool('close_sprint', { id: 'sprint-created' });
      expect(mockApi).toHaveBeenCalledWith('/api/tasks/archive/sprint/sprint-created', {
        method: 'POST',
      });
      expect(result.content[0].text).toContain('Archived 2 task(s)');
    });
  });

  describe('error handling', () => {
    it('should throw for unknown sprint tool', async () => {
      await expect(handleSprintTool('nonexistent_tool', {})).rejects.toThrow('Unknown sprint tool');
    });

    it('should throw for create_sprint with missing label', async () => {
      await expect(handleSprintTool('create_sprint', {})).rejects.toThrow();
    });

    it('should throw for get_sprint with missing id', async () => {
      await expect(handleSprintTool('get_sprint', {})).rejects.toThrow();
    });
  });
});
