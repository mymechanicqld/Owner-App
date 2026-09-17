# Owner App Work Log

This file records completed owner-app changes, production updates and important verification details. Add new entries at the top.

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
