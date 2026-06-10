/**
 * Graph-nav · React — live typed sidebar over graph entities.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TrellisProvider, useTrellis } from 'trellis/react';
import { useEntities, useMutation } from 'trellis/react/typed';
import { API_URL, bootstrapGraphNav, byOrder } from '../bootstrap';
import { FRAMEWORK, FRAMEWORK_LINKS } from '../nav-links';
import {
  NavItem,
  NavSection,
  type NavItemT,
  type NavSectionLoaded,
} from '../schema';
import '../inspector-loader';

function Bootstrap({ children }: { children: React.ReactNode }) {
  const client = useTrellis();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    bootstrapGraphNav(client).finally(() => setReady(true));
  }, [client]);
  return ready ? <>{children}</> : <p className="hint">Booting graph…</p>;
}

function FrameworkNav() {
  return (
    <nav className="fw-switcher" aria-label="Framework">
      {FRAMEWORK_LINKS.map((link) => (
        <a
          key={link.label}
          href={link.href}
          className={link.label === FRAMEWORK ? 'active' : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function Section({ section }: { section: NavSectionLoaded }) {
  const items: NavItemT[] = section.items ?? [];
  const itemMut = useMutation(NavItem);
  const sectionMut = useMutation(NavSection);

  const addItem = () => {
    const label = prompt('New item label')?.trim();
    if (!label) return;
    itemMut.create({ label, order: items.length, section: section.id });
  };

  return (
    <section className="nav-section">
      <header>
        <button
          className="twisty"
          onClick={() =>
            sectionMut.update(section.id, { collapsed: !section.collapsed })
          }
          aria-label={section.collapsed ? 'Expand' : 'Collapse'}
        >
          {section.collapsed ? '▸' : '▾'}
        </button>
        <span className="section-label">{section.label}</span>
        <span className="count">{items.length}</span>
        <button className="ghost" onClick={addItem} title="Add item">
          +
        </button>
        <button
          className="ghost danger"
          onClick={() => sectionMut.remove(section.id)}
          title="Delete section"
        >
          ×
        </button>
      </header>
      {!section.collapsed && (
        <ul>
          {items
            .slice()
            .sort(byOrder)
            .map((it) => (
              <li key={it.id}>
                <a href={it.href ?? '#'}>{it.label}</a>
                <button
                  className="ghost danger"
                  onClick={() => itemMut.remove(it.id)}
                >
                  ×
                </button>
              </li>
            ))}
          {items.length === 0 && <li className="empty">No items yet</li>}
        </ul>
      )}
    </section>
  );
}

function Sidebar() {
  const { data: sections, loading } = useEntities(NavSection, {
    resolve: { items: true },
  });
  const sectionMut = useMutation(NavSection);

  const addSection = () => {
    const label = prompt('New section label')?.trim();
    if (!label) return;
    sectionMut.create({ label, order: sections.length, collapsed: false });
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        {FRAMEWORK} · <em>graph-nav</em>
      </div>
      <FrameworkNav />
      {loading && sections.length === 0 ? (
        <p className="hint">Loading…</p>
      ) : (
        (sections as NavSectionLoaded[])
          .slice()
          .sort(byOrder)
          .map((s) => <Section key={s.id} section={s} />)
      )}
      <button className="add-section" onClick={addSection}>
        + Section
      </button>
      <p className="footnote">
        One subscription loads sections + items (<code>resolve</code>) — no
        per-section queries.
      </p>
    </aside>
  );
}

function App() {
  return (
    <TrellisProvider url={API_URL}>
      <Bootstrap>
        <div className="layout">
          <Sidebar />
          <main className="canvas">
            <h1>Graph-resident navigation</h1>
            <p>
              Typed entities via <code>defineType</code>, live reads with{' '}
              <code>{'resolve: { items: true }'}</code> from{' '}
              <code>trellis/react/typed</code>.
            </p>
          </main>
        </div>
      </Bootstrap>
    </TrellisProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
