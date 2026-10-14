import type { RecentProject } from '../../shared/image-api';
import { MenuFlyout } from './MenuFlyout';

export function RecentProjectsMenu({
  projects,
  loading,
  error,
  onOpen,
  onRetry,
  onClear,
}: {
  projects: readonly RecentProject[];
  loading: boolean;
  error: string | null;
  onOpen(id: string): void;
  onRetry(): void;
  onClear(): void;
}) {
  return (
    <MenuFlyout label="Recents" popupLabel="Recent projects" className="recent-projects-menu" menu>
      {loading ? (
        <p role="status">Loading Recents…</p>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <button role="menuitem" onClick={onRetry}>
            Retry
          </button>
        </>
      ) : projects.length ? (
        projects.map((project) => (
          <button
            role="menuitem"
            key={project.id}
            title={project.path}
            onClick={() => onOpen(project.id)}
          >
            <strong>{project.name}</strong>
          </button>
        ))
      ) : (
        <p>No recent projects yet.</p>
      )}
      <hr />
      <button role="menuitem" disabled={loading || (!projects.length && !error)} onClick={onClear}>
        Clear Recents
      </button>
    </MenuFlyout>
  );
}
