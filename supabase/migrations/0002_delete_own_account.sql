-- Lets a signed-in user delete their own account without the app ever holding
-- a service_role key. auth.users is not writable by the anon role, so this runs
-- as the function owner, and the where clause is what keeps it to the caller.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
-- Empty search_path so a caller cannot shadow a table name and have this
-- resolve somewhere unintended.
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- detectors and examples both cascade from auth.users, so this is the whole
  -- row set. Storage objects are removed client-side first, while the caller
  -- still has a session to authorise them.
  delete from auth.users where id = auth.uid();
end;
$$;

-- Only signed-in callers, never anon.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
