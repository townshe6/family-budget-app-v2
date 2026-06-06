-- Run this entire file in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner','member')) default 'member',
  created_at timestamptz not null default now()
);

create table if not exists public.budget_buckets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  cadence text not null check (cadence in ('weekly','monthly')),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists one_primary_bucket_per_household on public.budget_buckets(household_id) where is_primary;
create index if not exists profiles_household_idx on public.profiles(household_id);
create index if not exists buckets_household_idx on public.budget_buckets(household_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bucket_id uuid not null references public.budget_buckets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  description text,
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transactions_household_date_idx on public.transactions(household_id, spent_on desc);

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.budget_buckets enable row level security;
alter table public.transactions enable row level security;

create or replace function public.current_household_id() returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where id = auth.uid()
$$;
create or replace function public.current_user_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create policy "household members read household" on public.households for select using (id = public.current_household_id());
create policy "members read profiles" on public.profiles for select using (household_id = public.current_household_id());
create policy "members read buckets" on public.budget_buckets for select using (household_id = public.current_household_id());
create policy "owners insert buckets" on public.budget_buckets for insert with check (household_id = public.current_household_id() and public.current_user_role() = 'owner');
create policy "owners update buckets" on public.budget_buckets for update using (household_id = public.current_household_id() and public.current_user_role() = 'owner');
create policy "members read transactions" on public.transactions for select using (household_id = public.current_household_id());
create policy "members insert transactions" on public.transactions for insert with check (household_id = public.current_household_id() and user_id = auth.uid());
create policy "owner or creator deletes transactions" on public.transactions for delete using (household_id = public.current_household_id() and (user_id = auth.uid() or public.current_user_role() = 'owner'));

-- Creates either a new household owner or joins an existing household by invite code.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_household_id uuid;
  requested_code text;
  requested_name text;
  household_name text;
begin
  requested_code := upper(coalesce(new.raw_user_meta_data->>'invite_code',''));
  requested_name := coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1));
  household_name := coalesce(nullif(new.raw_user_meta_data->>'household_name',''), requested_name || ' Household');

  if requested_code <> '' then
    select id into new_household_id from public.households where invite_code = requested_code;
    if new_household_id is null then raise exception 'Invalid household invite code'; end if;
    insert into public.profiles(id,household_id,display_name,role) values(new.id,new_household_id,requested_name,'member');
  else
    insert into public.households(name,created_by) values(household_name,new.id) returning id into new_household_id;
    insert into public.profiles(id,household_id,display_name,role) values(new.id,new_household_id,requested_name,'owner');
    insert into public.budget_buckets(household_id,name,amount,cadence,is_primary,sort_order,created_by)
      values(new_household_id,'Weekly spending',0,'weekly',true,0,new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
