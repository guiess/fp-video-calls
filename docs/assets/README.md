# M² Calls asset provenance

This directory contains editable architecture source, a reviewed render, safe
capture fixtures, public screenshots, and machine-readable provenance.

## Architecture diagram

- Editable source:
  [architecture/system-overview.mmd](architecture/system-overview.mmd)
- Rendered asset:
  [architecture/system-overview.svg](architecture/system-overview.svg)
- Meaning: see the complete text equivalent in
  [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Source baseline:
  `482a83a83db50d75792610fc009f0fb87d24971d`
- Review date: 2026-11-06
- Rendering rule: diagram meaning cannot depend on color, and no secret values
  may appear.

## Screenshot fixture

[fixtures/v1.json](fixtures/v1.json) defines the approved synthetic identities,
messages, file labels, and simulated coordinates. It contains no real person,
conversation, face, voice, address, workplace, credential, token, signed URL,
or production record.

## Screenshot provenance

[screenshots/provenance.json](screenshots/provenance.json) is the authoritative
record for every public PNG. Each entry binds a filename to:

- canonical or historical product identity;
- source commit or installed APK digest;
- platform and capture environment;
- date, operator, fixture version, and scenario;
- dimensions, byte size, and SHA-256;
- crop/mask/annotation history;
- OCR, PNG metadata, and human review status;
- caption, alt text, and evidence limitation.

The capture set includes at least two web and two Android images. Historical APK
images retain the M2 Video Calls identity and are not represented as current M²
Calls source builds.

The captured surfaces show call setup and transient communication UI. A safe
location screenshot is blocked: the public web location surface requires an
authenticated account, while the historical APK would require Firebase-backed
identity/location setup. No owner-approved authenticated fixture or simulated
location injection was available. Real location data was not used. This
limitation is recorded instead of presenting a mockup as runtime evidence.

## Review procedure

1. Run only the approved synthetic scenario.
2. Capture the actual application UI; generated mockups are not runtime
   evidence.
3. Keep the raw capture outside the repository.
4. Crop only to remove operating-system chrome; record every transformation.
5. Inspect OCR output for personal data, credentials, tokens, private URLs,
   notifications, and real coordinates.
6. Remove EXIF, XMP, IPTC, PNG text chunks, thumbnails, and editor history.
7. Recompute dimensions, size, and SHA-256.
8. Have a human compare the PNG with its caption, alt text, and limitation.
9. Run `node --test scripts/tests/portfolio-docs.test.mjs`.

The current records show `pending-owner-review` for the final human approval.
Automated structure/metadata checks and Developer Guardian visual inspection are
complete, but they do not impersonate a human reviewer.

UI captures demonstrate visible surfaces only. They do not prove successful
cross-platform calling, authenticated access, TURN relay selection, backend
health, or current-source compatibility unless a separate test record says so.
