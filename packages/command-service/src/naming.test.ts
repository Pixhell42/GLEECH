import { describe, expect, it } from 'vitest';
import { createProject } from '@gleech/project-model';
import { createCommandService } from './index';

describe('project naming', () => {
  const source = {
    id: 'image',
    name: 'photo.png',
    width: 1,
    height: 1,
    format: 'png' as const,
    hasAlpha: true,
  };
  it('groups renaming into an undoable edit and preserves a custom name when importing another image', () => {
    const commands = createCommandService(createProject('Untitled'));
    commands.setSource(source);
    expect(commands.getState().name).toBe('photo.png');
    const before = commands.getState();
    commands.renameProject(' My work ');
    expect(commands.getState().name).toBe('My work');
    const renamed = commands.getState();
    commands.renameProject('My work');
    expect(commands.getState()).toBe(renamed);
    commands.undo();
    expect(commands.getState()).toBe(before);
    commands.redo();
    expect(commands.getState()).toBe(renamed);
    commands.setSource({ ...source, id: 'next', name: 'next.png' });
    expect(commands.getState().name).toBe('My work');
    expect(() => commands.renameProject(' ')).toThrow();
    expect(() => commands.renameProject('x'.repeat(121))).toThrow();
  });
  it('keeps automatic image naming until the user chooses a name', () => {
    const commands = createCommandService(createProject('Untitled'));
    commands.setSource(source);
    commands.setSource({ ...source, id: 'next', name: 'next.png' });
    expect(commands.getState().name).toBe('next.png');
  });
});
