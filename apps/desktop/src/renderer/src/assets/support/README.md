# Supplied donation QR images

Provided by the GLEECH creator on 2026-10-10. These PNGs are direct RGB pixel
crops of the supplied JPEG screenshots. No resizing, interpolation, recoloring
or regeneration was performed. Original files retain their natural dimensions;
the UI displays them at 40% size following the creator's 2026-10-10 revision.

- `venmo-qr.png`: 640×646; source `venmo.jpg`, 1178×2560,
  crop `(270, 934, 910, 1580)` in left/top/right/bottom coordinates.
- `cashapp-qr.png`: 1028×1028; source `cashapp.jpg`, 1178×2560,
  crop `(75, 810, 1103, 1838)`.
- `bitcoin-qr.png`: 1224×1224; source `bitcoin.jpg`, 1320×1482,
  crop `(48, 56, 1272, 1280)`.

All destinations were decoded locally. Venmo encodes user ID
`3372960886816768909`; Cash App encodes `https://cash.app/$Pixhell?qr=1`.
Bitcoin encodes address `bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p` plus a
Lightning invoice. The original QR is preserved; the app's wallet link and
clipboard action use the plain on-chain address without the invoice.

The original screenshots remain outside the repository. Decoder tooling is
verification-only and adds no runtime dependency.
