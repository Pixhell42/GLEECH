import { useEffect, useRef, useState } from 'react';
import { INITIAL_MCP_STATUS, type McpMode } from '@gleech/mcp/protocol';
import { MCP_CLIENTS, isMcpClient, mcpClient, type McpClientId } from '../../shared/mcp-clients';
import { McpConnectionHelpDialog } from './McpConnectionHelpDialog';

export function McpDialog({ onClose }: { onClose(): void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState(INITIAL_MCP_STATUS);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [client, setClient] = useState<McpClientId>(() => {
    try {
      const saved = localStorage.getItem('gleech.mcp.client');
      return isMcpClient(saved) ? saved : 'codex';
    } catch {
      return 'codex';
    }
  });
  const selectedClient = mcpClient(client, window.gleech.platform);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    let active = true;
    const unsubscribe = window.gleech.onMcpStatusChanged(setStatus);
    void window.gleech
      .mcpStatus()
      .then((status) => {
        if (active) setStatus(status);
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
      unsubscribe();
      dialog.close();
    };
  }, []);
  async function mode(next: McpMode) {
    setPending(true);
    setMessage('');
    try {
      setStatus(await window.gleech.setMcpMode(next));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Could not change MCP settings.');
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={modal}
      className="stage-dialog mcp-dialog"
      aria-labelledby="mcp-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="support-heading">
        <h2 id="mcp-title">MCP · AI control</h2>
        <button aria-label="Close MCP panel" onClick={onClose}>
          ×
        </button>
      </div>
      <p>
        Connect a local AI client to the open GLEECH project. Edits appear here and can be undone.
        Keep GLEECH open while connected.
      </p>
      <div className="mcp-client-selector">
        <label htmlFor="mcp-client">MCP client</label>
        <select
          id="mcp-client"
          value={client}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            if (!isMcpClient(next)) return;
            setClient(next);
            setMessage('');
            try {
              localStorage.setItem('gleech.mcp.client', next);
            } catch {
              /* Optional preference. */
            }
          }}
        >
          {MCP_CLIENTS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mcp-modes" role="group" aria-label="MCP control mode">
        {(['off', 'observe', 'edit', 'full'] as const).map((value) => (
          <button
            key={value}
            disabled={pending}
            aria-pressed={status.mode === value}
            onClick={() => void mode(value)}
          >
            {value === 'off'
              ? 'Off'
              : value === 'observe'
                ? 'Observe'
                : value === 'edit'
                  ? 'Edit'
                  : 'Full Control'}
          </button>
        ))}
      </div>
      <p className="mcp-mode-description">
        {status.mode === 'off'
          ? 'MCP is disabled. Choose Observe or Edit to enable the local connection.'
          : status.mode === 'observe'
            ? 'Inspect the project, browse filters and render previews. The client cannot change the project.'
            : status.mode === 'edit'
              ? 'Inspect, preview and edit the current project. Locked layers require an explicit unlock. Each edit or batch uses Undo.'
              : 'Edit the project and use approved folders to load images/projects, save and export. Existing files require an explicit overwrite request.'}
      </p>
      <div className="mcp-configuration-actions">
        <button disabled={pending} onClick={() => setHelpOpen(true)}>
          Connection Help
        </button>
        <button
          disabled={pending || status.mode === 'off'}
          onClick={() => {
            setPending(true);
            setMessage('Testing local connection…');
            void window.gleech
              .testMcpConnection(client)
              .then((result) => setMessage(result.message))
              .catch((error) => setMessage(String(error)))
              .finally(() => setPending(false));
          }}
        >
          Test Connection
        </button>
        <button
          disabled={pending || status.mode === 'off'}
          onClick={() => {
            void window.gleech
              .copyMcpConfiguration(client)
              .then(() => setMessage(`Copied ${selectedClient.name} configuration`))
              .catch((error) => setMessage(String(error)));
          }}
        >
          Copy Configuration
        </button>
      </div>
      <p className="mcp-help">
        <strong>
          {selectedClient.format} · {selectedClient.destination}
        </strong>
        <br />
        {selectedClient.instructions}
      </p>
      <h3>Approved folders</h3>
      <label className="check-label">
        <input
          type="checkbox"
          checked={status.clipboardAllowed}
          disabled={pending || status.mode === 'off'}
          onChange={(event) => {
            const previous = status;
            const allowed = event.target.checked;
            setStatus({ ...status, clipboardAllowed: allowed });
            setPending(true);
            void window.gleech
              .setMcpClipboardAllowed(allowed)
              .then(setStatus)
              .catch((error) => {
                setStatus(previous);
                setMessage(String(error));
              })
              .finally(() => setPending(false));
          }}
        />
        Allow copying rendered images to the clipboard
      </label>
      <p className="mcp-help">
        Full Control requires a folder grant for each kind of file operation. Projects folders allow
        both opening and saving. Grants last for this app session.
      </p>
      <div className="mcp-configuration-actions">
        {(['imports', 'projects', 'exports'] as const).map((kind) => (
          <button
            key={kind}
            disabled={pending}
            onClick={() => {
              setPending(true);
              void window.gleech
                .addMcpFolder(kind)
                .then(setStatus)
                .catch((error) => setMessage(String(error)))
                .finally(() => setPending(false));
            }}
          >
            Add {kind === 'imports' ? 'Imports' : kind === 'projects' ? 'Projects' : 'Exports'}{' '}
            Folder
          </button>
        ))}
      </div>
      <ul className="mcp-folder-list">
        {status.folders.map((folder) => (
          <li key={folder.id}>
            <span>
              <strong>{folder.kind}</strong>
              <br />
              {folder.path}
            </span>
            <button
              disabled={pending}
              aria-label={`Remove ${folder.kind} folder ${folder.path}`}
              onClick={() => {
                void window.gleech
                  .removeMcpFolder(folder.id)
                  .then(setStatus)
                  .catch((error) => setMessage(String(error)));
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <h3>Connected clients</h3>
      {status.pendingRequests > 1 && <p>{status.pendingRequests - 1} requests queued</p>}
      {status.operation && (
        <p role="status">
          {status.operation.client} · {status.operation.action}
        </p>
      )}
      {status.clients.length ? (
        <ul>
          {status.clients.map((name, index) => (
            <li key={index}>{name}</li>
          ))}
        </ul>
      ) : (
        <p>No clients connected.</p>
      )}
      <h3>Recent operations</h3>
      {status.recent.length ? (
        <ol className="mcp-recent">
          {status.recent.map((operation, index) => (
            <li key={index}>{operation}</li>
          ))}
        </ol>
      ) : (
        <p>No operations yet.</p>
      )}
      {(message || status.error) && <p role="status">{message || status.error}</p>}
      {helpOpen && (
        <McpConnectionHelpDialog
          client={client}
          enabled={status.mode !== 'off'}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </dialog>
  );
}
