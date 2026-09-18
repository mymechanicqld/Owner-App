# Owner App Work Log

This file records completed owner-app changes, production updates and important verification details. Add new entries at the top.

## 17 September 2026: Inspection image and report performance overhaul

Status: Resolved, migrated and deployed

### Problem

Inspection photos were stored as base64 strings inside `inspection_reports.state`. The reports list selected every column, so opening the list downloaded every embedded photo even though the screen only needed names, regos and report numbers. Report edits also created a new PDF without removing the previous file.

Live audit before the fix:

- 10 inspection report rows.
- 268 embedded JPEG photos across five reports.
- 56.31 MB transferred when the ten full rows were fetched individually in 22.5 seconds.
- A normal full-table request could exceed the Supabase statement timeout.
- 39 PDFs occupied 146,684,296 bytes in the `inspections` bucket.
- 29 of those PDFs were no longer referenced by any report and occupied 93,413,644 bytes.

### Application changes

- The reports list now selects summary fields only.
- New photos are prepared as a 1024 px JPEG master at quality 0.60 and a 320 px thumbnail at quality 0.55.
- Master images and thumbnails are stored in the existing `inspections` bucket under an `images/<report-folder>/` prefix.
- The database state stores image paths, dimensions, byte size, MIME type and captions, not base64 image bodies.
- Existing and legacy image formats remain readable while reports are being migrated.
- The report editor renders 24 lazy-loaded thumbnails at a time with Previous and Next controls.
- PDF generation downloads report-quality masters only when the owner opens, saves or sends that report.
- Inspection drafts now use IndexedDB instead of synchronous localStorage, avoiding the small localStorage quota and main-thread blocking.
- Saving an edited report removes the superseded PDF after the replacement is verified.
- Removing an image deletes its master and thumbnail after the report saves.
- Deleting a report now removes its PDF, master images and thumbnails in small batches.
- Storage requests continue to use the Supabase `apikey` header without an invalid Bearer token.

### Existing-data migration

The five image-heavy reports were migrated in place with a resumable migration script at `scripts/migrate-inspection-images.py`.

- 268 masters and 268 thumbnails were uploaded and read back for SHA-256 verification.
- Original decoded photos totalled 44,210,376 bytes.
- New masters total 16,556,837 bytes.
- New thumbnails total 2,240,156 bytes.
- Combined image storage is 18,796,993 bytes, a 57.5 percent reduction.
- All five affected PDFs were regenerated through the deployed Save flow.
- All 29 unreferenced PDFs were removed only after backup and hash verification.

The rollback backup is stored outside the repository at `~/Documents/MyMechanicQLD Backups/inspection-images-20260917-155339`. It contains the ten original full database rows, all 39 original PDFs, hashes and migration manifests. The removed PDFs are recoverable from that backup.

### Verification after migration

- Full ten-row payload: 206,086 bytes, down from 56.31 MB.
- Full ten-row request: 0.56 seconds.
- Reports-list payload: 4,051 bytes.
- Live Reports screen: ten rows displayed in 0.39 seconds with no browser errors.
- Database image references: 268.
- Remaining embedded base64 images: 0.
- Stored image objects: 536, exactly matching 268 masters plus 268 thumbnails.
- Missing or unreferenced image objects: 0.
- Stored PDFs: 10, one per report.
- Missing or unreferenced PDFs: 0.
- Current PDFs occupy 27,483,683 bytes.
- Total inspection bucket data now occupies 46,280,676 bytes, down 68.4 percent from the previous PDF-only footprint.
- The 69-image report PDF is 5,432,196 bytes, down from 8.78 MB.
- The 53-image report PDF is 5,265,723 bytes, down from about 11 MB.
- A regenerated 36-page A4 report was rendered to images and visually inspected. Photos remained clear at report size and the largest embedded source dimension was 1024 px.
- A 47-image report rendered only 24 storage-backed thumbnails in the editor DOM.

### Release

- Main implementation: `6584496`
- Asset lifecycle safeguards and migration tooling: `81acb92`
- Repository: `mymechanicqld/Owner-App`
- Branch: `main`
- Deployment: `https://mmqld-app.vercel.app/`

## 17 September 2026: Invoice notes PDF overflow

Status: Resolved and deployed

### Problem

Invoices containing long notes could break across two PDF pages incorrectly. The notes were rendered inside the left side of a two-column notes and totals section. When pdfmake split that container, the continued notes could cover the second page header and make the document look broken.

The issue was confirmed using the saved Nolan Murray invoice, `INV_20260916_0151`.

### Fix

- Kept the totals block together as an unbreakable section.
- Moved notes into a separate full-width section below the totals.
- Split entered notes into small text blocks.
- Limited each generated block to approximately 240 characters.
- Made each block unbreakable so page breaks occur only between safe blocks.
- Preserved paragraph spacing from the notes field.

Changed file: `invoice/app.js`

### Verification

- Regenerated the Nolan Murray invoice from its saved Supabase state.
- Rendered both PDF pages to images and inspected them visually.
- Confirmed a two-page A4 PDF.
- Confirmed the page-two business header and contact details remain visible.
- Confirmed notes start below the page header and do not overlap it.
- Confirmed the payment status, payment table, sign-off and footer remain clear.
- Confirmed JavaScript syntax and repository diff checks pass.

### Supabase update

The existing Nolan Murray PDF was replaced at its original Supabase Storage path. The invoice database row and its metadata were not changed.

- Record ID: `6c0d34da-af70-42a7-80ce-f4f66df0ab7b`
- Invoice number: `INV_20260916_0151`
- Storage path: `2026-09-16_210CZ3_INV202609160151_155600.pdf`
- Verified live PDF size: `191142` bytes
- Verified SHA-256: `a747b6c452e0ca955eebddc4547e58a1ef4d8a03b127ddcd52d080ec6d49e343`

The original PDF was preserved in the Mac Trash as `MMQLD-INV_20260916_0151-original-before-notes-fix-20260917.pdf` and remains recoverable until Trash is emptied.

### Release

- Git commit: `12e1fb6bc6213c376264a8c24a4a5292eef3b8bc`
- Repository: `mymechanicqld/Owner-App`
- Branch: `main`
- Deployment: Verified live on `https://mmqld-app.vercel.app/`

Future invoices generated after the deployment use the corrected notes layout. Previously generated PDFs remain unchanged unless they are regenerated or replaced manually.
