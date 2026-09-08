-- =====================================================================
-- FoodTab Marketing AI — data katalogu poskytovatelů
--
-- PRAVDIVOST PŘED HEZKOSTÍ. `implementation_status = 'implemented'`
-- smí mít jen nástroj, pro který v kódu existuje adaptér
-- (lib/providers/<klic>.ts) a test. Položka `planned` je informace pro
-- zákazníka, ne slib — v rozhraní se ukazuje jako „Připravujeme“ a nejde
-- připojit.
--
-- Ceny jsou ORIENTAČNÍ, s datem poslední kontroly. Aktualizuje je
-- administrátor přes obrazovku Integrace, ne nový release.
--
-- Odkazy na dokumentaci nešlo z vývojového prostředí ověřit (síť blokuje
-- developers.facebook.com, shotstack.io, docs.n8n.io) — jsou to
-- ustálené vstupní adresy dokumentace; před ostrým nasazením je
-- kontrola v docs/PROVIDER_CATALOG.md.
-- =====================================================================

insert into marketing.provider_catalog
  (key, category, name, vendor, description, recommendation, implementation_status, connection_modes,
   auth_type, billing, docs_url, pricing_url, pricing_note, pricing_checked_at,
   score_cost, score_simplicity, score_quality, score_speed, score_automation, setup_complexity,
   benefits, limitations, sort_order)
values
  -- AI text a storyboard ------------------------------------------------
  ('anthropic_claude', 'ai_generation', 'Claude (Anthropic)', 'Anthropic',
   'Texty příspěvků, hooky, hashtagy, storyboardy a rozpoznání menu z fotografie. Doporučený první AI adaptér.',
   'foodtab_recommended', 'implemented', array['customer_managed', 'foodtab_managed'],
   'api_key', 'customer_pays_provider',
   'https://docs.anthropic.com/', 'https://www.anthropic.com/pricing',
   'Účtuje se za tokeny; běžný návrh příspěvku vyjde na jednotky haléřů až korun.', '2026-09-08',
   2, 4, 5, 4, 5, 2,
   array['Strukturovaný výstup validovaný schématem', 'Umí česky včetně diakritiky', 'Rozumí fotografii menu'],
   array['Vyžaduje vlastní API klíč', 'Bez klíče běží interní mock'], 10),

  ('internal_mock_ai', 'ai_generation', 'Interní návrhář (demo)', 'FoodTab',
   'Deterministický návrh bez externí služby. Jen pro vyzkoušení aplikace — vždy viditelně označený jako demo.',
   'supported', 'implemented', array['mock'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 2, 5, 3, 1,
   array['Funguje bez klíčů', 'Vhodné pro školení a testy'],
   array['Texty jsou šablonové, ne kreativní', 'Nerozpozná menu z fotografie'], 20),

  -- Grafika ---------------------------------------------------------------
  ('internal_svg_renderer', 'image_rendering', 'Interní vykreslení obrázků', 'FoodTab',
   'Statické obrázky (feed, story, cover, náhled) a tisková PDF z datových gastro šablon přímo v aplikaci, bez externí služby.',
   'foodtab_recommended', 'implemented', array['foodtab_managed'],
   'none', 'included', null, null, 'V ceně aplikace.', '2026-09-08',
   1, 5, 3, 5, 5, 1,
   array['Bez nastavení', 'Brand kit se dosazuje automaticky', 'České písmo a diakritika'],
   array['Neumí video', 'Bez pohybu a přechodů'], 10),

  -- Video -----------------------------------------------------------------
  ('shotstack', 'video_rendering', 'Shotstack', 'Shotstack',
   'Cloudový render videí a obrázků z JSON časové osy: Reels z fotografií, střih klipů, titulky, hudba, intro/outro.',
   'foodtab_recommended', 'implemented', array['customer_managed', 'foodtab_managed'],
   'api_key', 'customer_pays_provider',
   'https://shotstack.io/docs/guide/', 'https://shotstack.io/pricing/',
   'Bezplatný sandbox (stage) s vodoznakem; produkce podle minut renderu.', '2026-09-08',
   3, 3, 4, 4, 5, 3,
   array['Asynchronní render s callbackem', 'Sandbox zdarma na vyzkoušení', 'Ořezy do všech poměrů stran'],
   array['Vyžaduje vlastní klíč', 'Voice-over přes další službu'], 10),

  ('internal_mock_video', 'video_rendering', 'Interní video (demo)', 'FoodTab',
   'Sandbox render: vytvoří sledovatelnou úlohu a storyboard s náhledovým snímkem, ale žádné skutečné video.',
   'supported', 'implemented', array['mock', 'manual_export'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 1, 5, 3, 1,
   array['Bez klíčů', 'Ukáže celý proces schválení a publikace'],
   array['Nevytvoří skutečné video — k ručnímu zpracování vrátí storyboard'], 20),

  -- Voice-over --------------------------------------------------------------
  ('elevenlabs', 'voiceover', 'ElevenLabs', 'ElevenLabs',
   'Český voice-over pro Reels.',
   'planned', 'planned', array['customer_managed'],
   'api_key', 'customer_pays_provider', 'https://elevenlabs.io/docs', 'https://elevenlabs.io/pricing',
   null, null, 3, 4, 5, 4, 4, 2,
   array[]::text[], array['Adaptér zatím není implementovaný'], 10),

  -- Automatizace ----------------------------------------------------------
  ('n8n', 'workflow_automation', 'n8n', 'n8n GmbH',
   'Dlouhé asynchronní procesy a napojení na další systémy. Volitelné — jádro aplikace na n8n nezávisí.',
   'foodtab_recommended', 'implemented', array['customer_managed', 'foodtab_managed'],
   'webhook_secret', 'customer_pays_provider',
   'https://docs.n8n.io/', 'https://n8n.io/pricing/',
   'Self-hosted zdarma; cloud podle tarifu.', '2026-09-08',
   2, 3, 4, 4, 5, 3,
   array['Importovatelná workflow v repozitáři', 'Podepsané webhooky oběma směry'],
   array['Bez n8n běží interní fronta úloh'], 10),

  ('internal_queue', 'workflow_automation', 'Interní fronta úloh', 'FoodTab',
   'Vestavěná fronta pro render, publikaci a retry. Funguje vždy, i bez n8n.',
   'supported', 'implemented', array['foodtab_managed'],
   'none', 'included', null, null, 'V ceně aplikace.', '2026-09-08',
   1, 5, 3, 4, 3, 1,
   array['Bez nastavení'], array['Bez napojení na cizí systémy'], 20),

  -- Publikování -----------------------------------------------------------
  ('meta_graph', 'social_publishing', 'Instagram + Facebook (Meta API)', 'Meta',
   'Přímé publikování na Facebook Page a profesionální Instagram účet přes Meta Graph API. Doporučená cesta.',
   'foodtab_recommended', 'implemented', array['customer_managed'],
   'oauth', 'free',
   'https://developers.facebook.com/docs/instagram-platform/', null,
   'Zdarma; vyžaduje Meta aplikaci a schválená oprávnění.', '2026-09-08',
   1, 2, 5, 5, 5, 4,
   array['Skutečný stav publikace z API', 'Reels, Story, feed, carousel i Page post', 'Plánování a metriky'],
   array['Vyžaduje Business/Creator účet na Instagramu propojený s Facebook Page',
         'Oprávnění podléhají App Review', 'Story přes API jen pro profesionální účty'], 10),

  ('mock_publisher', 'social_publishing', 'Mock publikace (demo)', 'FoodTab',
   'Předstíraná publikace s výsledným stavem published_mock. Nikdy nic nezveřejní.',
   'supported', 'implemented', array['mock'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 1, 5, 5, 1,
   array['Bezpečné pro vývoj a školení'], array['Nic nezveřejní — stav je vždy označený jako mock'], 20),

  ('manual_export', 'social_publishing', 'Ruční publikace (stažení souboru)', 'FoodTab',
   'Bez připojení: stáhnete hotový obrázek/video a text a zveřejníte sami. Funguje vždy.',
   'supported', 'implemented', array['manual_export'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 3, 3, 1, 1,
   array['Žádná oprávnění ani App Review', 'Funguje s libovolným účtem'],
   array['Stav publikace se nezjistí automaticky', 'Bez metrik'], 30),

  ('buffer', 'social_publishing', 'Buffer', 'Buffer',
   'Plánovač příspěvků pro více sítí.',
   'planned', 'planned', array['customer_managed'],
   'oauth', 'customer_pays_provider', 'https://buffer.com/developers', 'https://buffer.com/pricing',
   null, null, 3, 4, 4, 4, 4, 2,
   array[]::text[], array['Adaptér zatím není implementovaný'], 40),

  -- Analytika -------------------------------------------------------------
  ('meta_insights', 'analytics', 'Meta Insights', 'Meta',
   'Dosah, zobrazení, reakce a uložení z Instagramu a Facebooku podle dostupných oprávnění.',
   'foodtab_recommended', 'implemented', array['customer_managed'],
   'oauth', 'free', 'https://developers.facebook.com/docs/instagram-platform/insights', null,
   'Zdarma v rámci připojení Meta.', '2026-09-08',
   1, 3, 4, 4, 5, 3,
   array['Používá totéž připojení jako publikování'],
   array['Jen metriky, které API a typ účtu poskytují'], 10),

  ('mock_metrics', 'analytics', 'Ukázkové metriky (demo)', 'FoodTab',
   'Odhadované hodnoty jasně označené jako odhad — pro ukázku obrazovek.',
   'supported', 'implemented', array['mock'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 1, 5, 5, 1,
   array[]::text[], array['Čísla nejsou skutečná'], 20),

  -- Notifikace -----------------------------------------------------------
  ('internal_notifications', 'notifications', 'Upozornění v aplikaci', 'FoodTab',
   'Zvonek v aplikaci: žádost o schválení, vrácení, schválení, selhání publikace.',
   'foodtab_recommended', 'implemented', array['foodtab_managed'],
   'none', 'included', null, null, 'V ceně aplikace.', '2026-09-08',
   1, 5, 3, 5, 4, 1, array['Bez nastavení'], array['Jen uvnitř aplikace'], 10),

  ('resend_email', 'notifications', 'E-mail (Resend)', 'Resend',
   'E-mailová upozornění; FoodTab používá Resend i pro přihlašovací kódy.',
   'supported', 'planned', array['foodtab_managed', 'customer_managed'],
   'api_key', 'customer_pays_provider', 'https://resend.com/docs', 'https://resend.com/pricing',
   null, null, 2, 4, 4, 5, 4, 2, array[]::text[], array['Adaptér zatím není implementovaný'], 20),

  -- Úložiště ---------------------------------------------------------------
  ('supabase_storage', 'external_storage', 'Supabase Storage', 'Supabase',
   'Výchozí úložiště médií aplikace (podepsané adresy s omezenou platností).',
   'foodtab_recommended', 'implemented', array['foodtab_managed'],
   'none', 'included', 'https://supabase.com/docs/guides/storage', null,
   'V ceně infrastruktury FoodTabu.', '2026-09-08',
   1, 5, 4, 5, 5, 1, array['Bez nastavení'], array[]::text[], 10),

  ('local_storage', 'external_storage', 'Lokální disk (vývoj)', 'FoodTab',
   'Soubory v .data/storage — jen pro lokální běh a demo.',
   'supported', 'implemented', array['mock'],
   'none', 'free', null, null, 'Zdarma.', '2026-09-08',
   1, 5, 2, 5, 3, 1, array[]::text[], array['Ne pro produkci'], 20),

  -- Zdroj menu -----------------------------------------------------------
  ('foodtab_menu', 'menu_source', 'FoodTab Řízení — jídelní lístky', 'FoodTab',
   'Automatické načtení schváleného denního, týdenního a víkendového menu z FoodTabu (etapa 3).',
   'foodtab_recommended', 'planned', array['foodtab_managed'],
   'webhook_secret', 'included', null, null, null, null,
   1, 5, 5, 5, 5, 1, array['Bez ručního zadávání'], array['Čeká na propojení s FoodTabem'], 10),

  ('manual_menu', 'menu_source', 'Ruční zadání a import', 'FoodTab',
   'Formulář, vložený text, fotografie nebo PDF s potvrzením rozpoznaných dat.',
   'supported', 'implemented', array['foodtab_managed'],
   'none', 'included', null, null, 'V ceně aplikace.', '2026-09-08',
   1, 4, 4, 3, 2, 1, array['Funguje vždy'], array[]::text[], 20);


insert into marketing.provider_capabilities (provider_key, capability, status, note) values
  ('anthropic_claude', 'text.caption', 'available', null),
  ('anthropic_claude', 'text.storyboard', 'available', null),
  ('anthropic_claude', 'text.variants', 'available', null),
  ('anthropic_claude', 'text.revise', 'available', null),
  ('anthropic_claude', 'menu.ocr', 'available', 'Fotografie a PDF menu jako obrázek'),
  ('internal_mock_ai', 'text.caption', 'available', 'Šablonový text'),
  ('internal_mock_ai', 'text.storyboard', 'available', null),
  ('internal_mock_ai', 'text.variants', 'available', null),
  ('internal_mock_ai', 'text.revise', 'partial', 'Jen zkrácení, tón a výměna fotky'),
  ('internal_mock_ai', 'menu.ocr', 'partial', 'Jen z vloženého textu, ne z fotografie'),
  ('internal_svg_renderer', 'render.image', 'available', null),
  ('internal_svg_renderer', 'render.pdf', 'available', 'A4/A5 jako SVG k tisku'),
  ('shotstack', 'render.video', 'available', null),
  ('shotstack', 'render.image', 'available', null),
  ('shotstack', 'render.subtitles', 'partial', 'Titulky z textu storyboardu, ne z řeči'),
  ('shotstack', 'render.audio_mix', 'available', null),
  ('internal_mock_video', 'render.video', 'partial', 'Jen storyboard a náhledový snímek, žádné video'),
  ('elevenlabs', 'voice.cs', 'planned', null),
  ('n8n', 'workflow.trigger', 'available', null),
  ('n8n', 'workflow.callback', 'available', null),
  ('internal_queue', 'workflow.trigger', 'available', null),
  ('internal_queue', 'workflow.callback', 'available', null),
  ('meta_graph', 'publish.instagram.feed', 'available', null),
  ('meta_graph', 'publish.instagram.carousel', 'available', null),
  ('meta_graph', 'publish.instagram.reel', 'available', null),
  ('meta_graph', 'publish.instagram.story', 'available', 'Jen profesionální účty'),
  ('meta_graph', 'publish.facebook.post', 'available', null),
  ('meta_graph', 'publish.facebook.reel', 'partial', 'Reels na Page přes video upload'),
  ('meta_graph', 'publish.schedule', 'partial', 'Plánování drží aplikace; FB Page umí i vlastní'),
  ('mock_publisher', 'publish.instagram.feed', 'available', 'Mock'),
  ('mock_publisher', 'publish.instagram.carousel', 'available', 'Mock'),
  ('mock_publisher', 'publish.instagram.reel', 'available', 'Mock'),
  ('mock_publisher', 'publish.instagram.story', 'available', 'Mock'),
  ('mock_publisher', 'publish.facebook.post', 'available', 'Mock'),
  ('mock_publisher', 'publish.facebook.reel', 'available', 'Mock'),
  ('mock_publisher', 'publish.schedule', 'available', 'Mock'),
  ('manual_export', 'publish.instagram.feed', 'partial', 'Stažení souboru a textu'),
  ('manual_export', 'publish.instagram.carousel', 'partial', 'Stažení souborů'),
  ('manual_export', 'publish.instagram.reel', 'partial', 'Stažení videa/storyboardu'),
  ('manual_export', 'publish.instagram.story', 'partial', 'Stažení souboru'),
  ('manual_export', 'publish.facebook.post', 'partial', 'Stažení souboru a textu'),
  ('manual_export', 'publish.facebook.reel', 'partial', 'Stažení videa'),
  ('buffer', 'publish.instagram.feed', 'planned', null),
  ('buffer', 'publish.facebook.post', 'planned', null),
  ('meta_insights', 'metrics.basic', 'available', null),
  ('meta_insights', 'metrics.video', 'partial', 'Podle typu účtu'),
  ('mock_metrics', 'metrics.basic', 'available', 'Odhad'),
  ('internal_notifications', 'notify.push', 'available', 'Zvonek v aplikaci'),
  ('resend_email', 'notify.email', 'planned', null),
  ('supabase_storage', 'storage.external', 'available', null),
  ('local_storage', 'storage.external', 'available', 'Vývoj'),
  ('foodtab_menu', 'menu.source', 'planned', null),
  ('manual_menu', 'menu.source', 'available', null);
