import { describe, expect, it } from 'vitest';
import {
  INSTITUTIONAL_DOCS,
  ME,
  PERSONAL_ROOT,
  assertScope,
  canMoveInto,
  canMutate,
  descendantIds,
  initialPersonalNodes,
  pathTo,
  uniqueName,
} from '@/features/documents/lib/documentsData';

describe('the two document scopes stay apart', () => {
  it('every institutional document is institutional and owner-less', () => {
    expect(INSTITUTIONAL_DOCS.length).toBeGreaterThan(0);
    for (const d of INSTITUTIONAL_DOCS) {
      expect(d.scope).toBe('institutional');
      expect(d.ownerId).toBeUndefined();
      expect(d.publishedBy).toBeTruthy();
    }
  });

  it('every personal node is personal and owned by the signed-in staff member', () => {
    for (const n of initialPersonalNodes()) {
      expect(n.scope).toBe('personal');
      expect(n.ownerId).toBe(ME.id);
      expect(n.publishedBy).toBeUndefined();
    }
  });

  it('assertScope keeps the other scope out of a collection', () => {
    const mixed = [...INSTITUTIONAL_DOCS, ...initialPersonalNodes()];
    expect(assertScope(mixed, 'personal').every((n) => n.scope === 'personal')).toBe(true);
    expect(assertScope(mixed, 'institutional').every((n) => n.scope === 'institutional')).toBe(true);
    expect(assertScope(mixed, 'personal')).toHaveLength(initialPersonalNodes().length);
  });
});

describe('staff may never mutate an institutional document', () => {
  it('refuses every institutional document', () => {
    for (const d of INSTITUTIONAL_DOCS) expect(canMutate(d)).toBe(false);
  });

  it('allows the owner to mutate their own personal nodes', () => {
    for (const n of initialPersonalNodes()) expect(canMutate(n, ME.id)).toBe(true);
  });

  it("refuses another staff member's personal node", () => {
    const [node] = initialPersonalNodes();
    expect(canMutate({ ...node, ownerId: 'staff-other' }, ME.id)).toBe(false);
  });
});

describe('folder navigation and moves', () => {
  const nodes = initialPersonalNodes();

  it('builds a breadcrumb trail from the root down', () => {
    const trail = pathTo(nodes, 'p-sem3');
    expect(trail.map((t) => t.name)).toEqual(['Personal documents', 'Teaching materials', 'Sem 3']);
    expect(trail[0].id).toBe(PERSONAL_ROOT);
  });

  it('never moves a folder into itself or its own subtree', () => {
    expect(descendantIds(nodes, 'p-teaching').has('p-sem3')).toBe(true);
    expect(canMoveInto(nodes, 'p-teaching', 'p-teaching')).toBe(false);
    expect(canMoveInto(nodes, 'p-teaching', 'p-sem3')).toBe(false);
    expect(canMoveInto(nodes, 'p-teaching', 'p-research')).toBe(true);
  });

  it('does not offer a move to the folder an item is already in', () => {
    expect(canMoveInto(nodes, 'p-f01', 'p-sem3')).toBe(false);
    expect(canMoveInto(nodes, 'p-f01', 'p-sem5')).toBe(true);
  });
});

describe('name collisions', () => {
  it('leaves a free name alone', () => {
    expect(uniqueName([{ name: 'Notes.pdf' }], 'Report.pdf')).toBe('Report.pdf');
  });

  it('suffixes before the extension, and keeps counting', () => {
    const siblings = [{ name: 'Report.pdf' }, { name: 'Report (2).pdf' }];
    expect(uniqueName(siblings, 'Report.pdf')).toBe('Report (3).pdf');
  });

  it('handles an extension-less folder name', () => {
    expect(uniqueName([{ name: 'Sem 3' }], 'Sem 3')).toBe('Sem 3 (2)');
  });
});
