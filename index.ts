// books-gate – Tor und Engine vor dem Repo books (v2)
// v2 (14.11.): Variablen werden bereinigt (Leerzeichen, „ProPhotoSkills/books“ usw.), feste
//     Standardwerte ProPhotoSkills / books / main, und Fehlermeldungen zeigen, welches Repo
//     gefragt wurde und ob ein Schlüssel gesetzt ist (Eric 14.11.: /katalog → HTTP 404).
// Ablage: Repo books-gate · Brain 1_web/18_books-gate/dateien/books-gate_vN
//
// Was die Engine macht:
//   Sie liest das Repo books aus und baut daraus selbst den Katalog für PPS Books.
//   Regel (Eric 13.11., Variante A): <buch>/<sprache>/<datei>.epub
//     z. B. nextlevel/de/PPS_NextLevel_DE.epub · onlocation/ja/PPS_OnLocation_JA.epub
//   - Buch    = erster Ordner (nextlevel, onlocation, beginner …)
//   - Sprache = zweiter Ordner (de, en, fr, es, pt, it, el, ja …)
//   - Cover   = Titelbild aus dem EPUB selbst
//   - Titel   = aus dem Ordnernamen (nextlevel → „Next Level“)
//   - Liegen mehrere EPUBs in einem Sprachordner, gilt die höchste Version (_v02 vor _v01),
//     bei gleicher Version die alphabetisch letzte – und es gibt eine Warnung.
//   - Alles, was nicht in <buch>/<sprache>/ liegt, wird nicht angezeigt (Warnung).
//
// Adressen:
//   GET /katalog                 → JSON: alle Bücher mit Sprachen, Cover- und Buch-Adressen, Warnungen
//                                  (liest nur die Dateiliste – schnell, 1 Abruf bei GitHub)
//   GET /cover/<buch>/<sprache>  → Titelbild aus dem EPUB
//   GET /buch/<buch>/<sprache>   → die EPUB-Datei
//   GET /pruefung                → öffnet ALLE EPUBs und prüft sie (Sprache im EPUB ↔ Ordner, Titelbild,
//                                  Titel) – für Eric nach dem Hochladen, nicht für die App
//
// Warum kein Zwischenspeicher: Auf *.workers.dev-Adressen speichert Cloudflare nichts
// zwischen (Cache API wirkt erst mit eigener Domain). Darum öffnet der Katalog die EPUBs
// nicht, sondern nur die Dateiliste – jede Anfrage bleibt so klein.
//
// v1: noch OHNE Login – jeder, der die Adresse kennt, bekommt die Bücher.
//     Nächste Stufe: Token aus Web Login + Berechtigung je Buch (Supabase „Web Login“).
//
// Variablen in Cloudflare (Einstellungen → Variablen und Geheimnisse):
//   GITHUB_OWNER     = ProPhotoSkills
//   GITHUB_REPO      = books
//   GITHUB_BRANCH    = main                (optional, Standard main)
//   GITHUB_TOKEN     = Fine-grained GitHub-Schlüssel, nur Repo books, „Contents: Read-only“ (als Geheimnis!)
//   ALLOWED_ORIGINS  = https://books.prophotoskills.workers.dev,http://localhost:5173

import { unzipSync, strFromU8 } from "fflate";

export interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH?: string;
  GITHUB_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

// ---------- Typen ----------

type TreeEntry = { path: string; type: string; sha: string; size?: number };

type Ausgabe = {
  sprache: string; // aus dem Ordner
  datei: string; // Pfad im Repo
  cover: string; // Adresse beim Tor
  epub: string; // Adresse beim Tor
  groesse: number | null;
};

type Buch = { id: string; titel: string; ausgaben: Ausgabe[] };

type Katalog = { stand: string; buecher: Buch[]; warnungen: string[] };

type EpubInfo = { titel: string | null; sprache: string | null; coverPfad: string | null };

// ---------- Hilfen ----------

const SPRACHE_RE = /^[a-z]{2}(-[a-z]{2})?$/i;

// Saubere Namen für die Buch-Ordner
const BUCH_NAMEN: Record<string, string> = {
  nextlevel: "Next Level",
  onlocation: "On Location",
  beginner: "Beginner",
};

function buchName(id: string): string {
  return BUCH_NAMEN[id] ?? id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function versionVon(datei: string): number {
  const m = datei.match(/_v(\d+)\.epub$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function corsHeaders(request: Request, env: Env): Headers {
  const h = new Headers();
  const origin = request.headers.get("Origin");
  const erlaubt = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (origin && (erlaubt.includes(origin) || erlaubt.includes("*"))) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

function json(data: unknown, status: number, extra: Headers): Response {
  const h = new Headers(extra);
  h.set("Content-Type", "application/json; charset=utf-8");
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data, null, 2), { status, headers: h });
}

// Werte aus Cloudflare bereinigen – fehlt etwas, gelten die festen Standardwerte
function repo(env: Env): { owner: string; name: string; branch: string } {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  let owner = clean(env.GITHUB_OWNER) || "ProPhotoSkills";
  let name = clean(env.GITHUB_REPO) || "books";
  // Falls jemand „ProPhotoSkills/books“ oder eine ganze GitHub-Adresse einträgt
  const voll = name.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").split("/").filter(Boolean);
  if (voll.length >= 2) {
    owner = voll[0];
    name = voll[1];
  }
  const branch = clean(env.GITHUB_BRANCH) || "main";
  return { owner, name, branch };
}

function ghHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "prophotoskills-books-gate" };
  const token = (env.GITHUB_TOKEN ?? "").trim();
  if (token) h.Authorization = `token ${token}`;
  return h;
}

// ---------- GitHub lesen ----------

async function holeBaum(env: Env): Promise<TreeEntry[]> {
  const r = repo(env);
  const url = `https://api.github.com/repos/${r.owner}/${r.name}/git/trees/${r.branch}?recursive=1`;
  const res = await fetch(url, { headers: { ...ghHeaders(env), Accept: "application/vnd.github+json" } });
  if (!res.ok) {
    const schluessel = (env.GITHUB_TOKEN ?? "").trim() ? "Schlüssel gesetzt" : "kein Schlüssel";
    let hinweis = "";
    if (res.status === 404) hinweis = " – Repo/Branch nicht gefunden oder Schlüssel hat keinen Zugriff auf dieses Repo";
    if (res.status === 401) hinweis = " – Schlüssel ungültig oder abgelaufen";
    if (res.status === 403) hinweis = " – Abruf-Limit erreicht oder Schlüssel ohne Leserecht";
    throw new Error(`GitHub-Dateiliste: HTTP ${res.status} für ${r.owner}/${r.name} (Branch ${r.branch}, ${schluessel})${hinweis}`);
  }
  const data = (await res.json()) as { tree: TreeEntry[] };
  return data.tree;
}

async function holeDatei(env: Env, pfad: string): Promise<Uint8Array> {
  const r = repo(env);
  const url = `https://raw.githubusercontent.com/${r.owner}/${r.name}/${r.branch}/${pfad
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`GitHub-Datei ${pfad}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------- EPUB auslesen ----------

function attr(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : null;
}

export function leseEpub(daten: Uint8Array): EpubInfo {
  // Nur die kleinen Steuerdateien entpacken
  const teil = unzipSync(daten, {
    filter: (f) => f.name === "META-INF/container.xml" || f.name.endsWith(".opf"),
  });
  const container = teil["META-INF/container.xml"] ? strFromU8(teil["META-INF/container.xml"]) : "";
  const rootTag = container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "";
  const opfPfad = attr(rootTag, "full-path") ?? Object.keys(teil).find((n) => n.endsWith(".opf")) ?? "";
  const opf = teil[opfPfad] ? strFromU8(teil[opfPfad]) : "";
  const opfOrdner = opfPfad.includes("/") ? opfPfad.slice(0, opfPfad.lastIndexOf("/") + 1) : "";

  const titel = opf.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i)?.[1]?.trim() ?? null;
  const sprache = opf.match(/<dc:language[^>]*>([^<]*)<\/dc:language>/i)?.[1]?.trim() ?? null;

  // Cover: EPUB 3 (properties="cover-image") oder EPUB 2 (<meta name="cover" content="id">)
  const items = opf.match(/<item\b[^>]*>/gi) ?? [];
  let coverHref: string | null = null;
  for (const it of items) {
    if (/\bproperties\s*=\s*"[^"]*cover-image/i.test(it)) coverHref = attr(it, "href");
  }
  if (!coverHref) {
    const metaTag = opf.match(/<meta\b[^>]*name\s*=\s*"cover"[^>]*>/i)?.[0];
    const id = metaTag ? attr(metaTag, "content") : null;
    if (id) {
      const it = items.find((i) => attr(i, "id") === id);
      if (it) coverHref = attr(it, "href");
    }
  }
  const coverPfad = coverHref ? opfOrdner + decodeURIComponent(coverHref) : null;
  return { titel, sprache, coverPfad };
}

function bildTyp(pfad: string): string {
  const ext = pfad.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
}

// ---------- Katalog (nur aus der Dateiliste) ----------

type Auswahl = { buch: string; sprache: string; eintrag: TreeEntry };

export function waehleDateien(baum: TreeEntry[], warnungen: string[]): Auswahl[] {
  const gruppen = new Map<string, TreeEntry[]>();
  for (const e of baum) {
    if (e.type !== "blob" || !/\.epub$/i.test(e.path)) continue;
    const teile = e.path.split("/");
    if (teile.length !== 3 || !SPRACHE_RE.test(teile[1])) {
      warnungen.push(`Nicht angezeigt (gehört in <buch>/<sprache>/): ${e.path}`);
      continue;
    }
    const key = `${teile[0]}/${teile[1].toLowerCase()}`;
    gruppen.set(key, [...(gruppen.get(key) ?? []), e]);
  }

  const auswahl: Auswahl[] = [];
  for (const [key, liste] of [...gruppen].sort(([a], [b]) => a.localeCompare(b))) {
    const [buch, sprache] = key.split("/");
    liste.sort((a, b) => versionVon(a.path) - versionVon(b.path) || a.path.localeCompare(b.path));
    const gewaehlt = liste[liste.length - 1];
    const dateiname = gewaehlt.path.split("/").pop() ?? "";
    if (liste.length > 1) {
      warnungen.push(
        `${key}: ${liste.length} EPUBs – angezeigt wird ${dateiname} (nicht: ${liste
          .slice(0, -1)
          .map((e) => e.path.split("/").pop())
          .join(", ")})`,
      );
    }
    const kuerzel = dateiname.match(/_([A-Z]{2})(?:_v\d+)?\.epub$/i)?.[1];
    if (kuerzel && kuerzel.toLowerCase() !== sprache.slice(0, 2)) {
      warnungen.push(`${key}: Dateiname sagt ${kuerzel.toUpperCase()}, Ordner sagt ${sprache.toUpperCase()} – ${dateiname}`);
    }
    auswahl.push({ buch, sprache, eintrag: gewaehlt });
  }
  return auswahl;
}

export function baueKatalog(baum: TreeEntry[]): Katalog {
  const warnungen: string[] = [];
  const auswahl = waehleDateien(baum, warnungen);
  const map = new Map<string, Buch>();
  for (const a of auswahl) {
    const b = map.get(a.buch) ?? { id: a.buch, titel: buchName(a.buch), ausgaben: [] };
    b.ausgaben.push({
      sprache: a.sprache,
      datei: a.eintrag.path,
      cover: `/cover/${a.buch}/${a.sprache}`,
      epub: `/buch/${a.buch}/${a.sprache}`,
      groesse: a.eintrag.size ?? null,
    });
    map.set(a.buch, b);
  }
  const buecher = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { stand: new Date().toISOString(), buecher, warnungen };
}

function findeAusgabe(k: Katalog, buch: string, sprache: string): Ausgabe | undefined {
  return k.buecher.find((b) => b.id === buch)?.ausgaben.find((a) => a.sprache === sprache);
}

// ---------- Prüfung (öffnet alle EPUBs) ----------

async function pruefung(env: Env): Promise<unknown> {
  const k = baueKatalog(await holeBaum(env));
  const ergebnisse: unknown[] = [];
  const warnungen = [...k.warnungen];
  for (const b of k.buecher) {
    for (const a of b.ausgaben) {
      try {
        const info = leseEpub(await holeDatei(env, a.datei));
        if (info.sprache && info.sprache.slice(0, 2).toLowerCase() !== a.sprache.slice(0, 2)) {
          warnungen.push(`${b.id}/${a.sprache}: im EPUB steht Sprache „${info.sprache}“ – Ordner sagt ${a.sprache.toUpperCase()}`);
        }
        if (!info.coverPfad) warnungen.push(`${b.id}/${a.sprache}: kein Titelbild im EPUB gefunden`);
        ergebnisse.push({ buch: b.id, sprache: a.sprache, datei: a.datei, epubTitel: info.titel, epubSprache: info.sprache, titelbild: info.coverPfad });
      } catch (err) {
        warnungen.push(`${b.id}/${a.sprache}: EPUB nicht lesbar (${(err as Error).message})`);
      }
    }
  }
  return { stand: new Date().toISOString(), anzahl: ergebnisse.length, warnungen, ergebnisse };
}

// ---------- Worker ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });

    const url = new URL(request.url);
    const teile = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    try {
      if (teile.length === 0) {
        return json(
          { name: "books-gate", version: 2, adressen: ["/katalog", "/cover/<buch>/<sprache>", "/buch/<buch>/<sprache>", "/pruefung"] },
          200,
          cors,
        );
      }

      if (teile[0] === "katalog" && teile.length === 1) {
        return json(baueKatalog(await holeBaum(env)), 200, cors);
      }

      if (teile[0] === "pruefung" && teile.length === 1) {
        return json(await pruefung(env), 200, cors);
      }

      if ((teile[0] === "cover" || teile[0] === "buch") && teile.length === 3) {
        const [art, buch, sprache] = teile;
        const k = baueKatalog(await holeBaum(env));
        const a = findeAusgabe(k, buch, sprache.toLowerCase());
        if (!a) return json({ fehler: "Nicht gefunden" }, 404, cors);
        const daten = await holeDatei(env, a.datei);

        if (art === "buch") {
          const h = new Headers(cors);
          h.set("Content-Type", "application/epub+zip");
          h.set("Cache-Control", "private, no-store");
          return new Response(daten, { status: 200, headers: h });
        }

        const info = leseEpub(daten);
        const bild = info.coverPfad ? unzipSync(daten, { filter: (f) => f.name === info.coverPfad })[info.coverPfad] : undefined;
        if (!info.coverPfad || !bild) return json({ fehler: "Kein Titelbild im EPUB" }, 404, cors);
        const h = new Headers(cors);
        h.set("Content-Type", bildTyp(info.coverPfad));
        h.set("Cache-Control", "public, max-age=3600");
        return new Response(bild, { status: 200, headers: h });
      }

      return json({ fehler: "Nicht gefunden" }, 404, cors);
    } catch (err) {
      console.error("[books-gate]", err);
      return json({ fehler: "Fehler beim Lesen von GitHub", details: (err as Error).message }, 502, cors);
    }
  },
};
