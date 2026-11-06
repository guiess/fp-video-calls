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

[fixtures/sanitized-v2.json](fixtures/sanitized-v2.json) records the approved
privacy-redacted capture package. Redacted identity, message, file-label, map,
and coordinate values are intentionally not retained in repository metadata and
must not be reconstructed.

## Screenshot provenance

[screenshots/provenance.json](screenshots/provenance.json) is the authoritative
record for every public PNG. Each entry binds a filename to:

- canonical or historical product identity;
- live URL/revision status or installed APK digest;
- platform and capture environment;
- date, operator, fixture version, and scenario;
- dimensions, byte size, and SHA-256;
- crop/mask/annotation history;
- privacy-redaction, PNG metadata, and human review status;
- caption, alt text, and evidence limitation.

The capture set contains five web app-viewport images from
`https://thankful-moss-0611ddf0f.3.azurestaticapps.net/app` and six Android
images from the exact historical `mobile-v1.0` debug APK. The web deployment
revision is unknown. Historical Android images are not represented as
current-main output.

Both platforms show chats, a conversation, contacts, rooms, and a joined room
with two participants displayed. Android additionally shows the contact-location
surface with map detail and coordinate data obscured. The web location capture
was intentionally skipped.

## Review procedure

1. Use only the owner-approved sanitized capture package.
2. Capture the actual application UI; generated mockups are not runtime
   evidence.
3. Keep the raw capture outside the repository.
4. Preserve opaque redactions and never attempt to recover concealed values.
5. Confirm visually that browser chrome, Copilot UI, personal identity,
   coordinate detail, and private file labels are absent or obscured.
6. Remove EXIF, XMP, IPTC, PNG text chunks, thumbnails, and editor history.
7. Recompute dimensions, size, and SHA-256.
8. Compare every PNG with its caption, alt text, and evidence limitation.
9. Run `node --test scripts/tests/portfolio-docs.test.mjs`.

The owner supplied this package as authoritative sanitized source. Human visual
review and local structure/metadata validation are recorded as complete.

UI captures demonstrate visible surfaces only. They do not prove successful
cross-platform calling, authenticated access, TURN relay selection, backend
health, or current-source compatibility unless a separate test record says so.
