-- SUPABASE MEALIO uniquement. Après 1.2.20.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cookiwiki_recipe_checks(
 user_id text NOT NULL CHECK(user_id='KH'),
 recipe_id uuid NOT NULL,
 tested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,recipe_id)
);
ALTER TABLE public.cookiwiki_recipe_checks ENABLE ROW LEVEL SECURITY;
-- Les 56 recettes du rapport du 8 octobre ont déjà été analysées, même si
-- certaines estimations demandent confirmation. Ce registre ne signifie pas « validé OK ».
INSERT INTO public.cookiwiki_recipe_checks(user_id,recipe_id,tested_at) VALUES
('KH','08788652-f0cc-4140-be73-495ee4ebb2ad','2026-10-08T13:55:24.925Z'::timestamptz),
('KH','e0a837b2-6012-4f5a-867c-68c17d823c0c','2026-10-08T13:55:29.705Z'::timestamptz),
('KH','96b805d2-75fe-4f9c-ac6f-a7bd98f21756','2026-10-08T13:55:35.012Z'::timestamptz),
('KH','70e831d1-cf92-4ca9-b566-ce3e86c65d88','2026-10-08T13:55:40.591Z'::timestamptz),
('KH','b9497dc8-897c-4387-8ca8-41ce2e771e92','2026-10-08T13:55:44.342Z'::timestamptz),
('KH','e416b5ea-5ef1-4c76-9172-b4f6207720b8','2026-10-08T13:55:48.773Z'::timestamptz),
('KH','19305dab-f838-4477-a330-89f4ad5757d8','2026-10-08T13:55:51.916Z'::timestamptz),
('KH','c36b54b2-4f83-488c-b3db-4b465df01e6f','2026-10-08T13:55:57.484Z'::timestamptz),
('KH','055ac3ce-22b3-4724-8772-3f40521d8b8f','2026-10-08T13:56:00.904Z'::timestamptz),
('KH','302c03dc-da58-48e7-8284-36f9a38cf982','2026-10-08T13:56:04.032Z'::timestamptz),
('KH','99728d24-9fe2-4941-919e-1a39704a22a3','2026-10-08T13:56:07.807Z'::timestamptz),
('KH','b291e0a3-15ad-4c90-8db3-6097150b4781','2026-10-08T13:56:11.189Z'::timestamptz),
('KH','34784d16-6980-4530-96b1-1797fa0e5864','2026-10-08T13:56:15.746Z'::timestamptz),
('KH','14faa023-4542-40e4-b2fb-86ce03b3ae20','2026-10-08T13:56:20.012Z'::timestamptz),
('KH','9428614f-76ad-4fc0-a05a-6db45ec14f84','2026-10-08T13:56:24.156Z'::timestamptz),
('KH','4993b615-7302-4683-b38d-6e82b3ed5ffb','2026-10-08T13:56:27.248Z'::timestamptz),
('KH','50391f36-35dd-4e4e-b6d8-a5d59b51cffa','2026-10-08T13:56:32.635Z'::timestamptz),
('KH','cb58fecb-27a9-4e18-9ddc-cf5f6fed96cd','2026-10-08T13:56:36.529Z'::timestamptz),
('KH','1c7d3210-a7d2-4956-804a-2e893f70eeb5','2026-10-08T13:56:41.510Z'::timestamptz),
('KH','4e93c746-3b57-4374-90d4-bfec92a8b670','2026-10-08T13:56:45.248Z'::timestamptz),
('KH','09603a0f-6dbb-4bf7-a971-281d06cb7fda','2026-10-08T13:56:49.405Z'::timestamptz),
('KH','ea5ec85d-c789-45ba-a311-07562c901537','2026-10-08T13:56:53.904Z'::timestamptz),
('KH','81e08e94-0225-47a2-99aa-58f35040fab3','2026-10-08T13:56:58.843Z'::timestamptz),
('KH','c794f891-2240-41bf-aee2-e32e8df17c6b','2026-10-08T13:57:04.884Z'::timestamptz),
('KH','a70ca0a7-b231-47b7-bc04-58b83ba8025c','2026-10-08T13:57:10.872Z'::timestamptz),
('KH','206d7cfe-5e67-40ba-8db3-5978fe520f5d','2026-10-08T13:57:13.427Z'::timestamptz),
('KH','452a35a5-0962-4002-8075-2bf57a8ddb2e','2026-10-08T13:57:21.069Z'::timestamptz),
('KH','23970d8e-5e26-4c51-a624-71fc1269c94b','2026-10-08T13:57:26.454Z'::timestamptz),
('KH','0dd5a4e1-be8c-4d33-ad36-7480d2963aa7','2026-10-08T13:57:28.776Z'::timestamptz),
('KH','6e02c3f8-1baf-40a2-a0c8-e800686fa169','2026-10-08T13:57:32.357Z'::timestamptz),
('KH','c558eff5-c8fc-4200-ada6-3c05febc6991','2026-10-08T13:57:35.840Z'::timestamptz),
('KH','2b6ecb9a-77d4-4398-9e95-f8fe8cdb6aed','2026-10-08T13:57:41.541Z'::timestamptz),
('KH','83d7443d-30d3-4f51-ad33-a85ef231cd8d','2026-10-08T13:57:47.186Z'::timestamptz),
('KH','a1cfaf0a-c0b8-40c1-a5a5-45ded138315b','2026-10-08T13:57:51.689Z'::timestamptz),
('KH','970eed2f-8df4-4f36-85fa-9e6b65e64e8d','2026-10-08T13:57:59.085Z'::timestamptz),
('KH','3c2f1578-bdc5-4cba-94d4-e46fe87cb382','2026-10-08T13:58:02.201Z'::timestamptz),
('KH','818bb95d-32fd-421c-87a2-192a9582680e','2026-10-08T13:58:07.452Z'::timestamptz),
('KH','9093f24a-ba08-47d6-8f96-8db0bdeec87f','2026-10-08T13:58:12.175Z'::timestamptz),
('KH','be542b36-ca36-411c-ba1c-a188a9133296','2026-10-08T13:58:16.315Z'::timestamptz),
('KH','9b3f1c94-e80d-4894-8953-8e688878750f','2026-10-08T13:58:22.876Z'::timestamptz),
('KH','0876a07b-60b9-4be3-a74c-76183adf4540','2026-10-08T13:58:26.497Z'::timestamptz),
('KH','e0275312-464b-4586-bf84-84258a6946f9','2026-10-08T13:58:31.941Z'::timestamptz),
('KH','f5fa2b24-be9d-477e-bdfb-a10347e21463','2026-10-08T13:58:35.538Z'::timestamptz),
('KH','7a5ced7f-a3ea-4719-b12a-349429c6459c','2026-10-08T13:58:42.013Z'::timestamptz),
('KH','0829e021-fd21-4ef3-8cca-95b2e5487e85','2026-10-08T13:58:49.369Z'::timestamptz),
('KH','41a77930-b1e8-4545-ac0e-ebfa2cd7af7b','2026-10-08T13:58:53.181Z'::timestamptz),
('KH','4b2a51db-0dc5-40e6-aa37-550a56a450af','2026-10-08T13:58:57.535Z'::timestamptz),
('KH','377291a6-cf3c-416e-b927-46b128d650f1','2026-10-08T13:59:01.453Z'::timestamptz),
('KH','a9340473-1f59-4d05-8599-5ff607a48a96','2026-10-08T13:59:06.182Z'::timestamptz),
('KH','30aa216f-0e58-4ac5-bc5d-3d4caa26d069','2026-10-08T13:59:10.601Z'::timestamptz),
('KH','86599d6b-428d-458d-af49-36784456c09f','2026-10-08T13:59:13.983Z'::timestamptz),
('KH','57cb92d4-a44f-41a6-9202-8436f081ccb0','2026-10-08T13:59:18.783Z'::timestamptz),
('KH','458083ef-40d4-41d2-9fa9-b109a07007e9','2026-10-08T13:59:23.186Z'::timestamptz),
('KH','e682d519-3874-4ed7-859b-f68666150282','2026-10-08T13:59:29.209Z'::timestamptz),
('KH','e2035bf0-c847-42e4-9f7a-adeb8059301e','2026-10-08T13:59:34.259Z'::timestamptz),
('KH','65ba7320-a9c2-4cf4-ad08-be7059168734','2026-10-08T13:59:38.026Z'::timestamptz)
ON CONFLICT(user_id,recipe_id) DO NOTHING;
-- Corriger seulement l’ancien format automatique 1 g de Mayonnaise pour KH.
-- Les formats personnalisés et les lignes de courses existantes sont conservés.
UPDATE public.household_pantry_products p SET default_quantity=250,updated_at=now()
FROM public.official_ingredients i
WHERE p.ingredient_id=i.id AND i.nom='Mayonnaise' AND p.user_id='KH'
AND p.default_quantity=1 AND p.default_unit='Gramme';
COMMIT;
