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

export function SupportPanel() {
  const panel = useRef<HTMLDivElement>(null);
  const [payment, setPayment] = useState<PaymentId | null>(null);
  const [feedback, setFeedback] = useState('');
  const selected = PAYMENTS.find((item) => item.id === payment);
  useEffect(() => {
    panel.current
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
    <div
      ref={panel}
      className={`support-panel${selected ? ' support-payment-panel' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected) {
          event.preventDefault();
          event.stopPropagation();
          setPayment(null);
          setFeedback('');
        }
      }}
    >
      <div className="support-heading">
        <h4>{selected ? `${selected.name} · Support GLEECH` : 'Support GLEECH'}</h4>
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
    </div>
  );
}
