# books-gate – Tor und Engine vor dem Repo books

Cloudflare-Worker für PPS Books. Liest das Repo **books** aus und baut daraus selbst den Katalog.

## Regel für das Repo books
`<buch>/<sprache>/<datei>.epub` – z. B. `nextlevel/de/PPS_NextLevel_DE.epub`
- mehrere EPUBs in einem Sprachordner → die höchste Version (`_v02` vor `_v01`) wird gezeigt
- alles außerhalb von `<buch>/<sprache>/` wird nicht gezeigt

## Adressen
- `/katalog` – alle Bücher mit Sprachen (für die App)
- `/cover/<buch>/<sprache>` – Titelbild aus dem EPUB
- `/buch/<buch>/<sprache>` – die EPUB-Datei
- `/pruefung` – öffnet alle EPUBs und meldet Auffälligkeiten (für Eric nach dem Hochladen)

## Variablen in Cloudflare
- `GITHUB_OWNER` = ProPhotoSkills
- `GITHUB_REPO` = books
- `GITHUB_TOKEN` = GitHub-Schlüssel nur für Repo books, „Contents: Read-only“ (als Geheimnis)
- `ALLOWED_ORIGINS` = https://books.prophotoskills.workers.dev,http://localhost:5173

v1: noch ohne Login. Nächste Stufe: Ausweis aus Web Login + Berechtigung je Buch.
