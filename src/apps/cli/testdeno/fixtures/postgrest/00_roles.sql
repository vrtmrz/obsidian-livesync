do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'livesync_postgrest_anon') then
        create role livesync_postgrest_anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'livesync_postgrest_authenticator') then
        create role livesync_postgrest_authenticator noinherit login password 'integration-password';
    end if;
end
$$;

grant livesync_postgrest_anon to livesync_postgrest_authenticator;
