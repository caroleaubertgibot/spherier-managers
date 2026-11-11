-- ===========================================================================
--  SPHÉRIER — SCHÉMA SUPABASE
--  À coller tel quel dans l'éditeur SQL de Supabase, puis cliquer sur « Run ».
-- ===========================================================================
--
--  MODE D'EMPLOI, en trois gestes :
--    1. Dans le projet Supabase, menu de gauche → « SQL Editor » → « New query ».
--    2. Coller TOUT ce fichier, du début à la fin, en une seule fois.
--    3. Cliquer sur « Run ». Un tableau de contrôle s'affiche à la fin :
--       toutes les lignes doivent afficher « OK ».
--
--  Ce script peut être relancé sans risque : il ne crée que ce qui manque et ne
--  supprime aucune donnée. Le relancer après une erreur est donc sans danger.
--
--  Il ne crée AUCUN compte, AUCUNE policy, et n'ouvre rien vers l'extérieur.
--
-- ---------------------------------------------------------------------------
--  CE QU'IL INSTALLE : deux tables, aux régimes d'écriture volontairement opposés.
--
--  `snapshots` — APPEND-ONLY. Chaque enregistrement du membre crée une ligne,
--  jamais de modification. C'est ce qui permet de lui montrer ce qui a bougé
--  entre deux mois.
--
--  `notes` — MODIFIABLE. Une note appartient à la compétence, pas au moment : on
--  la relit et on la complète. D'où une seule note par couple (membre,
--  compétence), garantie par une contrainte d'unicité, et une date de mise à
--  jour entretenue automatiquement.
--
--  RLS ACTIVE SANS AUCUNE POLICY sur les deux tables. Rien n'est donc lisible ni
--  écrivable depuis un navigateur, même avec la clé publique : tout passe par les
--  fonctions serveur, qui utilisent la clé de service. C'est le seul rempart
--  entre les données d'un membre et le reste du monde — ne jamais ajouter de
--  policy « juste pour tester ».
-- ===========================================================================

-- --- 1. snapshots ----------------------------------------------------------
create table if not exists public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid        not null,
  cree_le    timestamptz not null default now(),
  libelle    text,
  blob       jsonb       not null
);

-- La lecture courante est « le dernier point de ce membre » : l'index porte donc
-- sur le couple, en date décroissante.
create index if not exists snapshots_client_recent
  on public.snapshots (client_id, cree_le desc);

-- --- 2. notes --------------------------------------------------------------
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid        not null,
  code       text        not null,
  texte      text        not null,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);

-- La contrainte d'unicité est ajoutée à part plutôt que dans le CREATE TABLE :
-- ainsi elle se pose aussi sur une table déjà existante qui ne l'aurait pas.
-- C'est le pivot de l'écriture des notes — le serveur s'appuie dessus pour
-- remplacer une note au lieu d'en empiler une nouvelle. Sans elle, chaque
-- correction créerait un doublon.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass and conname = 'notes_client_code_unique'
  ) then
    alter table public.notes
      add constraint notes_client_code_unique unique (client_id, code);
  end if;
end $$;

create index if not exists notes_client_id_idx
  on public.notes (client_id);

-- --- 3. La date de mise à jour, entretenue automatiquement ------------------
-- Sans ce déclencheur, `maj_le` garderait la date de CRÉATION : le serveur ne
-- réécrit que le texte de la note, pas ses dates. On verrait donc « modifié le »
-- afficher une date fausse, sans que rien ne le signale.
create or replace function public.notes_touch_maj_le()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists notes_maj_le on public.notes;
create trigger notes_maj_le
  before update on public.notes
  for each row execute function public.notes_touch_maj_le();

-- --- 4. Verrouillage -------------------------------------------------------
alter table public.snapshots enable row level security;
alter table public.notes     enable row level security;

-- ===========================================================================
--  CONTRÔLE — toutes les lignes doivent afficher « OK ».
--  Si l'une d'elles affiche « MANQUE », relancer le script en entier.
-- ===========================================================================
select 'table snapshots' as controle,
       case when to_regclass('public.snapshots') is not null then 'OK' else 'MANQUE' end as resultat
union all
select 'table notes',
       case when to_regclass('public.notes') is not null then 'OK' else 'MANQUE' end
union all
select 'protection RLS sur snapshots',
       case when (select relrowsecurity from pg_class where oid='public.snapshots'::regclass)
            then 'OK' else 'MANQUE' end
union all
select 'protection RLS sur notes',
       case when (select relrowsecurity from pg_class where oid='public.notes'::regclass)
            then 'OK' else 'MANQUE' end
union all
select 'aucune policy (attendu : 0)',
       case when (select count(*) from pg_policies where schemaname='public') = 0
            then 'OK' else 'MANQUE — il ne doit y en avoir aucune' end
union all
select 'unicité des notes (membre + compétence)',
       case when exists (select 1 from pg_constraint
                         where conrelid='public.notes'::regclass
                           and conname='notes_client_code_unique')
            then 'OK' else 'MANQUE' end
union all
select 'mise à jour automatique de maj_le',
       case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                         where c.relname='notes' and t.tgname='notes_maj_le' and not t.tgisinternal)
            then 'OK' else 'MANQUE' end
union all
select 'index de lecture des snapshots',
       case when exists (select 1 from pg_indexes
                         where schemaname='public' and indexname='snapshots_client_recent')
            then 'OK' else 'MANQUE' end
union all
select 'index de lecture des notes',
       case when exists (select 1 from pg_indexes
                         where schemaname='public' and indexname='notes_client_id_idx')
            then 'OK' else 'MANQUE' end;
