import { useEffect, useRef, useState } from 'react';
import { unwrap } from '../../shared/image-api';
import {
  BITCOIN_ADDRESS,
  SUPPORT_LINKS,
  type PaymentId,
  type SupportLinkId,
} from '../../shared/support';
import cashappQr from './assets/support/cashapp-qr.png';
import venmoQr from './assets/support/venmo-qr.png';
import bitcoinQr from './assets/support/bitcoin-qr.png';

const PAYMENTS = [
  { id: 'cashapp', name: 'Cash App', handle: '$Pixhell', qr: cashappQr, width: 1028, height: 1028 },
  { id: 'venmo', name: 'Venmo', handle: '@pixhell', qr: venmoQr, width: 640, height: 646 },
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    handle: BITCOIN_ADDRESS,
    qr: bitcoinQr,
    width: 1224,
    height: 1224,
  },
] as const;

export function SupportDialog({ onClose }: { onClose(): void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [payment, setPayment] = useState<PaymentId | null>(null);
  const [feedback, setFeedback] = useState('');
  const selected = PAYMENTS.find((item) => item.id === payment);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    modal.current
      ?.querySelector<HTMLButtonElement>(
        payment ? '.support-payment-actions button' : '.support-payments button',
      )
      ?.focus();
  }, [payment]);
  const openLink = async (id: SupportLinkId) => {
    try {
      unwrap(await window.gleech.openSupportLink(id));
      setFeedback('');
    } catch (failure) {
      setFeedback(failure instanceof Error ? failure.message : 'Could not open this link.');
    }
  };
  const copy = async (id: PaymentId) => {
    try {
      unwrap(await window.gleech.copySupportDestination(id));
      setFeedback(id === 'bitcoin' ? 'Copied Bitcoin address' : 'Copied payment link');
    } catch (failure) {
      setFeedback(failure instanceof Error ? failure.message : 'Could not copy this destination.');
    }
  };
  return (
    <dialog
      ref={modal}
      className={`stage-dialog support-dialog${selected ? ' support-qr-dialog' : ''}`}
      aria-labelledby="support-title"
      onCancel={(event) => {
        event.preventDefault();
        if (selected) {
          setPayment(null);
          setFeedback('');
        } else onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="support-heading">
        <h2 id="support-title">
          {selected ? `${selected.name} · Support GLEECH` : 'Support GLEECH'}
        </h2>
        <button type="button" aria-label="Close support panel" onClick={onClose}>
          ×
        </button>
      </div>
      {selected ? (
        <>
          <div className="support-payment-actions">
            <button
              type="button"
              onClick={() => {
                setPayment(null);
                setFeedback('');
              }}
            >
              Back
            </button>
            <a
              href={SUPPORT_LINKS[selected.id]}
              onClick={(event) => {
                event.preventDefault();
                void openLink(selected.id);
              }}
            >
              {selected.id === 'bitcoin' ? 'Open Bitcoin wallet' : `Open ${selected.name}`}
            </a>
            <button type="button" onClick={() => void copy(selected.id)}>
              {selected.id === 'bitcoin' ? 'Copy Address' : 'Copy Link'}
            </button>
          </div>
          <p className="support-destination">{selected.handle}</p>
          <p className="support-qr-caption">Scan to support GLEECH.</p>
          <div
            className="support-qr-viewport"
            tabIndex={0}
            role="region"
            aria-label={`${selected.name} QR code`}
          >
            <img
              src={selected.qr}
              width={selected.width}
              height={selected.height}
              style={{ width: selected.width * 0.4 }}
              alt={`${selected.name} donation QR code`}
            />
          </div>
        </>
      ) : (
        <>
          <p>
            Help keep GLEECH growing and improving. Any contribution is appreciated. Follows and
            reposts on X, subscribing and liking on YouTube, and giving stars on GitHub all help.
            Thank you for your support!
          </p>
          <div className="support-payments">
            {PAYMENTS.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setPayment(item.id);
                  setFeedback('');
                }}
              >
                <strong>{item.name}</strong>
                <span>{item.id === 'bitcoin' ? 'Scan or copy address' : item.handle}</span>
              </button>
            ))}
          </div>
          <div className="support-socials">
            <section>
              <h3>Follow & support</h3>
              {(
                [
                  ['x', 'X · @pixhell'],
                  ['github', 'GitHub · Pixhell42'],
                  ['repository', 'Star GLEECH on GitHub'],
                ] as const
              ).map(([id, label]) => (
                <a
                  key={id}
                  href={SUPPORT_LINKS[id]}
                  onClick={(event) => {
                    event.preventDefault();
                    void openLink(id);
                  }}
                >
                  {label}
                </a>
              ))}
            </section>
            <section>
              <h3>Music</h3>
              {(
                [
                  ['musicX', 'X · @mjestichooligan'],
                  ['musicYouTube', 'YouTube · @majestichooligan'],
                ] as const
              ).map(([id, label]) => (
                <a
                  key={id}
                  href={SUPPORT_LINKS[id]}
                  onClick={(event) => {
                    event.preventDefault();
                    void openLink(id);
                  }}
                >
                  {label}
                </a>
              ))}
              <div className="support-music-promo">
                <p>
                  Make your own AI Music Videos with slopcannon at{' '}
                  <a
                    href={SUPPORT_LINKS.slopcannon}
                    onClick={(event) => {
                      event.preventDefault();
                      void openLink('slopcannon');
                    }}
                  >
                    slop.cc
                  </a>
                  .
                </p>
                <p>Get in the cannon!</p>
              </div>
            </section>
          </div>
        </>
      )}
      <p className="support-feedback" role="status" aria-live="polite">
        {feedback}
      </p>
    </dialog>
  );
}

export function SupportIcon({ kind }: { kind: 'bug' | 'feature' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'bug' ? (
        <>
          <path d="M9 7V6a3 3 0 0 1 6 0v1M8 8h8v7a4 4 0 0 1-8 0zM12 8v10M5 5l3 3M19 5l-3 3M3 12h5M16 12h5M5 20l3-4M19 20l-3-4" />
        </>
      ) : (
        <>
          <path d="M8 16c0-3-3-3.5-3-7a7 7 0 0 1 14 0c0 3.5-3 4-3 7M8 16h8M9 19h6M10 22h4M12 5v7M9 8h6" />
        </>
      )}
    </svg>
  );
}
