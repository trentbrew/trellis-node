import type { TrellisDb } from 'trellis/client/sdk';
import { NavItem, NavSection } from './schema';

export const API_URL =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4200';

export function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order;
}

/** Registers schemas and seeds starter nav graph. Idempotent. */
export async function bootstrapGraphNav(client: TrellisDb): Promise<void> {
  for (const type of [NavSection, NavItem]) {
    await client.registerType(type);
  }

  const sections = await client.query('find ?e where type = "NavSection"');
  const items = await client.query('find ?e where type = "NavItem"');
  if (items.bindings.length > 0) return;

  let ws: string;
  let lib: string;
  if (sections.bindings.length === 0) {
    ws = await client.create('NavSection', {
      label: 'Workspace',
      order: 0,
      collapsed: false,
    });
    lib = await client.create('NavSection', {
      label: 'Library',
      order: 1,
      collapsed: false,
    });
  } else {
    const loaded = await Promise.all(
      sections.bindings.map((b) =>
        client.read<{ id: string; label: string }>(b.e),
      ),
    );
    ws =
      loaded.find((s) => s?.label === 'Workspace')?.id ??
      sections.bindings[0]!.e;
    lib =
      loaded.find((s) => s?.label === 'Library')?.id ??
      sections.bindings[1]?.e ??
      ws;
  }

  await client.create('NavItem', {
    label: 'Overview',
    order: 0,
    section: ws,
    href: '#/overview',
  });
  await client.create('NavItem', {
    label: 'Tasks',
    order: 1,
    section: ws,
    href: '#/tasks',
  });
  await client.create('NavItem', {
    label: 'Notes',
    order: 0,
    section: lib,
    href: '#/notes',
  });
}
