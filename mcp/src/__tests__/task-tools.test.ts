/**
 * MCP Task Tools — Unit Tests
 *
 * Tests tool definitions, Zod validation, and mocked API calls.
 * Does NOT require a running server — all API calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTaskTool, taskTools } from '../tools/tasks.js';

vi.mock('../utils/api.js', () => ({
  api: vi.fn(),
}));

vi.mock('../utils/find.js', () => ({
  findTask: vi.fn(),
}));

import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';

const mockApi = vi.mocked(api);
const mockFindTask = vi.mocked(findTask);

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

describe('Task MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool definitions', () => {
    it('should export 6 task tools', () => {
      expect(taskTools).toHaveLength(6);
    });

    it('should have correct tool names', () => {
      const names = taskTools.map((t) => t.name);
      expect(names).toEqual([
        'list_tasks',
        'get_task',
        'create_task',
        'update_task',
        'archive_task',
        'delete_task',
      ]);
    });

    it('should require title for create_task', () => {
      const tool = taskTools.find((t) => t.name === 'create_task');
      expect(tool?.inputSchema.required).toContain('title');
    });

    it('should require id for update_task', () => {
      const tool = taskTools.find((t) => t.name === 'update_task');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should have project filter on list_tasks', () => {
      const tool = taskTools.find((t) => t.name === 'list_tasks');
      expect(tool?.inputSchema.properties.project).toBeDefined();
    });
  });

  describe('list_tasks', () => {
    const mockTasks = [
      { id: 'task-1', status: 'done', type: 'code', project: 'alpha', sprint: 's1' },
      { id: 'task-2', status: 'todo', type: 'research', project: 'beta', sprint: 's2' },
      { id: 'task-3', status: 'done', type: 'research', project: 'alpha', sprint: 's2' },
    ];

    it('should return an array', async () => {
      mockApi.mockResolvedValueOnce(mockTasks as any);
      const result = await handleTaskTool('list_tasks', {});
      expect(mockApi).toHaveBeenCalledWith('/api/tasks');
      const tasks = parseToolResponse(result);
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter by status', async () => {
      mockApi.mockResolvedValueOnce(mockTasks as any);
      const result = await handleTaskTool('list_tasks', { status: 'done' });
      const tasks = parseToolResponse(result);
      expect(tasks).toHaveLength(2);
      for (const task of tasks) {
        expect(task.status).toBe('done');
      }
    });

    it('should filter by type', async () => {
      mockApi.mockResolvedValueOnce(mockTasks as any);
      const result = await handleTaskTool('list_tasks', { type: 'research' });
      const tasks = parseToolResponse(result);
      expect(tasks).toHaveLength(2);
      for (const task of tasks) {
        expect(task.type).toBe('research');
      }
    });

    it('should filter by project', async () => {
      mockApi.mockResolvedValueOnce(mockTasks as any);
      const result = await handleTaskTool('list_tasks', { project: '__nonexistent_project__' });
      const tasks = parseToolResponse(result);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('create + get + update + delete lifecycle', () => {
    it('should create a task', async () => {
      const created = {
        id: 'task-created',
        title: '__mcp_test_task',
        type: 'research',
        priority: 'low',
      };
      mockApi.mockResolvedValueOnce(created as any);

      const result = await handleTaskTool('create_task', {
        title: '__mcp_test_task',
        type: 'research',
        priority: 'low',
        description: 'Integration test task — safe to delete',
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/tasks',
        expect.objectContaining({ method: 'POST' })
      );
      const task = parseToolResponse(result);
      expect(task.title).toBe('__mcp_test_task');
      expect(task.type).toBe('research');
      expect(task.priority).toBe('low');
      expect(task.id).toBe('task-created');
    });

    it('should get the created task', async () => {
      mockFindTask.mockResolvedValueOnce({ id: 'task-created', title: '__mcp_test_task' } as any);
      const result = await handleTaskTool('get_task', { id: 'task-created' });
      expect(mockFindTask).toHaveBeenCalledWith('task-created');
      const task = parseToolResponse(result);
      expect(task.id).toBe('task-created');
      expect(task.title).toBe('__mcp_test_task');
    });

    it('should update the task', async () => {
      mockFindTask.mockResolvedValueOnce({ id: 'task-created', title: '__mcp_test_task' } as any);
      mockApi.mockResolvedValueOnce({
        id: 'task-created',
        status: 'in-progress',
        priority: 'high',
      } as any);

      const result = await handleTaskTool('update_task', {
        id: 'task-created',
        status: 'in-progress',
        priority: 'high',
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/tasks/task-created',
        expect.objectContaining({ method: 'PATCH' })
      );
      const task = parseToolResponse(result);
      expect(task.status).toBe('in-progress');
      expect(task.priority).toBe('high');
    });

    it('should delete the task', async () => {
      mockFindTask.mockResolvedValueOnce({ id: 'task-created', title: '__mcp_test_task' } as any);
      mockApi.mockResolvedValueOnce(undefined as any);
      const result = await handleTaskTool('delete_task', { id: 'task-created' });
      expect(mockApi).toHaveBeenCalledWith('/api/tasks/task-created', { method: 'DELETE' });
      expect(result.content[0].text).toContain('deleted');
    });
  });

  describe('error handling', () => {
    it('should return isError for nonexistent task', async () => {
      mockFindTask.mockResolvedValueOnce(null);
      const result = await handleTaskTool('get_task', { id: 'nonexistent_id_12345' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should throw for unknown tool', async () => {
      await expect(handleTaskTool('fake_tool', {})).rejects.toThrow('Unknown task tool');
    });

    it('should throw for create_task with missing title', async () => {
      await expect(handleTaskTool('create_task', {})).rejects.toThrow();
    });
  });
});
