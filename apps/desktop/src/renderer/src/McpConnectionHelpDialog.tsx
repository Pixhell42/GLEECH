import { useEffect, useRef, useState } from 'react';
import { mcpClient, type McpClientId } from '../../shared/mcp-clients';

export function McpConnectionHelpDialog({
  client,
  enabled,
  onClose,
}: {
  client: McpClientId;
  enabled: boolean;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const selected = mcpClient(client);
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    let active = true;
    void window.gleech
      .getMcpSetupPrompt(client)
      .then((value) => {
        if (active) setPrompt(value);
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
      dialog.close();
    };
  }, [client]);
  return (
    <dialog
      ref={modal}
      className="stage-dialog mcp-connection-help"
      aria-labelledby="mcp-connection-help-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="support-heading">
        <h2 id="mcp-connection-help-title">Connect {selected.name}</h2>
        <button aria-label="Close connection help" onClick={onClose}>
          ×
        </button>
      </div>
      <ol className="mcp-connection-steps">
        <li>Keep GLEECH open. Choose Observe to inspect, or Edit to change the project.</li>
        <li>
          Copy the setup prompt below and paste it into your {selected.name} agent. Allow it to
          update your local MCP settings.
        </li>
        <li>
          If the agent cannot edit local files, use Copy Configuration in the MCP panel and merge
          only GLEECH into <strong>{selected.destination}</strong>.
        </li>
        <li>{selected.instructions}</li>
        <li>
          Close GLEECH’s MCP panel, then ask the agent to inspect the project and show a preview.
          Test Connection checks the bundled launcher; the agent must also connect successfully.
        </li>
      </ol>
      <label className="mcp-prompt-label" htmlFor="mcp-setup-prompt">
        Setup prompt · includes your GLEECH configuration
      </label>
      <textarea
        id="mcp-setup-prompt"
        className="mcp-setup-prompt"
        value={prompt}
        readOnly
        spellCheck={false}
        rows={10}
        placeholder="Loading setup prompt…"
      />
      <div className="mcp-configuration-actions">
        <button
          disabled={!prompt || pending}
          onClick={() => {
            setPending(true);
            void window.gleech
              .copyMcpSetupPrompt(client)
              .then(() => setMessage(`Copied ${selected.name} setup prompt`))
              .catch((error) => setMessage(String(error)))
              .finally(() => setPending(false));
          }}
        >
          Copy Setup Prompt
        </button>
      </div>
      {!enabled && (
        <p className="mcp-help">
          You can copy the prompt now. Choose Observe or Edit in GLEECH when you’re ready to
          connect.
        </p>
      )}
      <p className="mcp-help">
        The prompt contains launcher paths, not the connection token. Full Control and folder access
        are only needed for opening, saving or exporting files. Approve those in GLEECH when you
        need them.
      </p>
      {message && <p role="status">{message}</p>}
    </dialog>
  );
}
