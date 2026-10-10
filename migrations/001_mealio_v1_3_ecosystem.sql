-- Mealio V1.3. Apply once to Mealio after the Frosti V1.3 / Cellio V1.2 migrations.
BEGIN;
CREATE TABLE IF NOT EXISTS public.meal_consumption_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL,meal_plan_id uuid NOT NULL,
 recipe_id uuid NOT NULL,recipe_nom text NOT NULL,scheduled_date date NOT NULL,servings numeric NOT NULL,
 status text NOT NULL CHECK(status IN('processing','confirmed','skipped')),
 consumed_items jsonb NOT NULL DEFAULT '[]',shortages jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,meal_plan_id)
);
ALTER TABLE public.meal_consumption_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meal_consumption_events FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.meal_consumption_events TO service_role;
ALTER TABLE public.meal_consumption_events ADD COLUMN IF NOT EXISTS ecosystem_version integer;
CREATE TABLE IF NOT EXISTS public.ecosystem_jobs (
 id uuid PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK(kind IN('transfer','preparation','consumption')),
 request_hash text NOT NULL, request jsonb NOT NULL, actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array'),
 result jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','blocked','completed')),
 error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ecosystem_jobs_household ON public.ecosystem_jobs(user_id,created_at DESC);
ALTER TABLE public.ecosystem_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ecosystem_jobs FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.ecosystem_jobs TO service_role;
COMMIT;
