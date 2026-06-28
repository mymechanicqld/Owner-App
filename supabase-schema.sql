-- ============================================================================
-- My Mechanic QLD - Owner app: calendar + invoice/inspection logging
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/depduvjclelykqcnhlsm/sql/new
-- It adds three tables and two public storage buckets, all readable/writable
-- with the publishable (anon) key, matching how quote_submissions already works.
-- ============================================================================

-- ── Calendar events ────────────────────────────────────────────────────────
create table if not exists public.calendar_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  all_day       boolean not null default false,
  customer_name text,
  customer_phone text,
  vehicle_rego  text,
  suburb        text,
  service       text,
  notes         text,
  status        text not null default 'scheduled',
  submission_id uuid
);
create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);

alter table public.calendar_events enable row level security;
drop policy if exists "cal_all" on public.calendar_events;
create policy "cal_all" on public.calendar_events
  for all to anon, authenticated using (true) with check (true);

-- ── Invoice log (text/searchable; PDF lives in storage) ─────────────────────
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  invoice_number text,
  customer_name  text,
  customer_email text,
  vehicle_rego   text,
  vehicle        text,
  issue_date     date,
  due_date       date,
  status         text,
  subtotal       numeric,
  gst            numeric,
  total          numeric,
  paid           numeric,
  balance        numeric,
  items          jsonb,
  signer_name    text,
  notes          text,
  pdf_path       text,
  submission_id  uuid
);
create index if not exists invoices_rego_idx on public.invoices (vehicle_rego);
create index if not exists invoices_created_idx on public.invoices (created_at desc);

alter table public.invoices enable row level security;
drop policy if exists "inv_all" on public.invoices;
create policy "inv_all" on public.invoices
  for all to anon, authenticated using (true) with check (true);

-- ── Inspection report log ───────────────────────────────────────────────────
create table if not exists public.inspection_reports (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  report_number  text,
  customer_name  text,
  customer_phone text,
  vehicle_rego   text,
  vehicle        text,
  odometer       text,
  overall_rating text,
  inspection_date date,
  sections       jsonb,
  comments       text,
  pdf_path       text,
  submission_id  uuid
);
create index if not exists insp_rego_idx on public.inspection_reports (vehicle_rego);
create index if not exists insp_created_idx on public.inspection_reports (created_at desc);

alter table public.inspection_reports enable row level security;
drop policy if exists "insp_all" on public.inspection_reports;
create policy "insp_all" on public.inspection_reports
  for all to anon, authenticated using (true) with check (true);

-- ── Storage buckets (one per document type) ─────────────────────────────────
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('inspections', 'inspections', true)
  on conflict (id) do nothing;

-- Allow the publishable key to upload + read in those two buckets.
drop policy if exists "docs_insert" on storage.objects;
create policy "docs_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id in ('invoices', 'inspections'));

drop policy if exists "docs_read" on storage.objects;
create policy "docs_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('invoices', 'inspections'));

drop policy if exists "docs_update" on storage.objects;
create policy "docs_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id in ('invoices', 'inspections'))
  with check (bucket_id in ('invoices', 'inspections'));

-- ============================================================================
-- Done. Files are named <date>_<rego>.pdf inside each bucket.
-- ============================================================================
