-- handle_new_user is SECURITY DEFINER and lives in the PostgREST-exposed public
-- schema, so without this it is callable as an RPC by any anonymous visitor.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
