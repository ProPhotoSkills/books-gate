# books-gate – Tor und Engine vor dem Repo books

Cloudflare-Worker für PPS Books. Liest das Repo **books** aus und baut daraus selbst den Katalog.

## Regel für das Repo books
`<buch>/<sprache>/<datei>.epub` – z. B. `nextlevel/de/PPS_NextLevel_DE.epub`
- mehrere EPUBs in einem Sprachordner → die höchste Version (`_v02` vor `_v01`) wird gezeigt
- alles außerhalb von `<buch>/<sprache>/` wird nicht gezeigt

## Adressen
- `/katalog` – alle Bücher mit Sprachen (für die App)
- `/cover/<buch>/<sprache>` – Titelbild aus dem EPUB
- `/buch/<buch>/<sprache>` – die EPUB-Datei – **nur mit Konto (Beginner) oder gekauft**, sonst 401 (nicht angemeldet) / 403 (nicht gekauft)
- `/meine` – was der angemeldete Nutzer lesen darf
- `/pruefung` – öffnet alle EPUBs und meldet Auffälligkeiten (für Eric nach dem Hochladen)

## Variablen in Cloudflare
- `GITHUB_OWNER` = ProPhotoSkills
- `GITHUB_REPO` = books
- `GITHUB_TOKEN` = GitHub-Schlüssel nur für Repo books, „Contents: Read-only“ (als Geheimnis)
- `ALLOWED_ORIGINS` = https://books.prophotoskills.workers.dev,http://localhost:5173
- `SUPABASE_URL` = https://rkgjuqdkwaaymkruyhvy.supabase.co (Projekt „Web Login“) – neu in v3
- `SUPABASE_ANON_KEY` = öffentlicher anon-Schlüssel dieses Projekts – neu in v3 (nie den service_role-Schlüssel!)
- `KONTO_BUECHER` = beginner (optional, Standard: für jedes angemeldete Konto)
- `FREIE_BUECHER` = (optional, Standard leer: ganz ohne Anmeldung)

v4: Beginner nur mit kostenlosem Konto (KONTO_BUECHER), nicht mehr ganz ohne Anmeldung.

v3: Freischaltung je Buch – Anmelde-Token aus Supabase „Web Login“, Rechte über `public.meine_buecher()` (Tabellen aus web_v7). Beginner frei, Next Level/On Location nur nach Kauf, MemberAbo beide.

v2: Variablen bereinigt + Standardwerte (ProPhotoSkills / books / main), klarere Fehlermeldungen.
