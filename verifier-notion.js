require('dotenv').config({ quiet: true });

const fs = require('fs');
const { Client } = require('@notionhq/client');
const { DIMENSIONS, DIFFICULTES, NOM_PAR_NOTION, NOTION_PAR_NOM,
        VERSION_REFERENTIEL, NIVEAU_MAX } = require('./club.config.js');

// ===========================================================================
// Contrôle du référentiel dans Notion — LECTURE SEULE.
// ===========================================================================
//
// À lancer après un import, après une modification manuelle dans Notion, ou
// simplement pour savoir où en est le référentiel. Il n'écrit RIEN, nulle part :
// on peut le relancer autant qu'on veut.
//
// Il répond à la question que l'interface ne pose pas : « ce que Notion contient
// est-il ce que l'application saura lire ? » Les deux peuvent diverger en silence —
// une compétence rattachée à une thématique inactive, une option de Dimension créée
// par une faute de frappe, un énoncé vide : rien de tout cela ne provoque d'erreur,
// ça fait seulement disparaître des choses du ciel.
//
//   node verifier-notion.js                     -> contrôles internes
//   node verifier-notion.js referentiel-managers.json   -> en plus, comparaison à l'export

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const txt = (page, nom) => {
  const p = page.properties[nom];
  return ((p?.rich_text ?? p?.title ?? []).map((s) => s.plain_text).join('')).trim();
};
const coche = (page, nom) => page.properties[nom]?.checkbox === true;
const rel = (page, nom) => (page.properties[nom]?.relation ?? []).map((r) => r.id);

async function toutes(dsId) {
  let cursor, pages = [];
  do {
    const r = await notion.dataSources.query({ data_source_id: dsId, start_cursor: cursor, page_size: 100 });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return pages;
}

async function dsDe(variable) {
  if (!process.env[variable]) throw new Error(`${variable} manquant`);
  const db = await notion.databases.retrieve({ database_id: process.env[variable] });
  return { ds: db.data_sources[0].id, titre: (db.title ?? []).map((s) => s.plain_text).join('') };
}

const ECARTS = [];
function chk(libelle, condition, detail = '') {
  if (!condition) ECARTS.push(libelle + (detail ? ` — ${detail}` : ''));
  console.log('  ' + (condition ? 'OK    ' : 'ÉCART ') + libelle + (detail ? `  [${detail}]` : ''));
}

async function principal() {
  const [T, C, R] = await Promise.all([dsDe('DB_THEMES'), dsDe('DB_COMPETENCES'), dsDe('DB_RESSOURCES')]);
  const [pagesT, pagesC, pagesR] = await Promise.all([toutes(T.ds), toutes(C.ds), toutes(R.ds)]);

  const actifsT = pagesT.filter((p) => coche(p, 'Actif'));
  const actifsC = pagesC.filter((p) => coche(p, 'Actif'));
  const idsThemesActifs = new Set(actifsT.map((p) => p.id));

  console.log(`référentiel v${VERSION_REFERENTIEL} · ${T.titre} / ${C.titre} / ${R.titre}\n`);
  console.log(`  ${pagesT.length} thématiques dont ${actifsT.length} actives`);
  console.log(`  ${pagesC.length} compétences dont ${actifsC.length} actives`);
  console.log(`  ${pagesR.length} ressources dont ${pagesR.filter((p) => coche(p, 'Actif')).length} actives\n`);

  // --- Ce qui fait disparaître des choses en silence ---------------------------
  console.log('=== Les pièges silencieux ===');

  // Une ligne non cochée n'existe pas pour l'application. C'est voulu (les archives),
  // mais une ligne oubliée décochée est indistinguable d'une archive.
  chk('aucune thématique inactive qui traîne', pagesT.length === actifsT.length,
    pagesT.filter((p) => !coche(p, 'Actif')).map((p) => txt(p, 'Name')).slice(0, 5).join(' / '));
  chk('aucune compétence inactive qui traîne', pagesC.length === actifsC.length,
    pagesC.filter((p) => !coche(p, 'Actif')).map((p) => txt(p, 'Code')).slice(0, 8).join(' '));

  // Une compétence sans thématique active est filtrée par referentiel-v2.js : elle
  // n'apparaît NULLE PART, sans message. C'est la signature d'une correspondance ratée.
  const orphelines = actifsC.filter((p) => rel(p, '📚 Thèmes').filter((id) => idsThemesActifs.has(id)).length === 0);
  chk('aucune compétence orpheline de thématique active', orphelines.length === 0,
    orphelines.map((p) => txt(p, 'Code') || '(sans code)').slice(0, 8).join(' '));

  // Une compétence sans code n'est pas identifiable dans un snapshot : écartée aussi.
  const sansCode = actifsC.filter((p) => !txt(p, 'Code'));
  chk('toute compétence active porte un code', sansCode.length === 0,
    sansCode.map((p) => txt(p, 'Name')).slice(0, 5).join(' / '));

  // Les options de Dimension : une de plus que prévu est une faute de frappe, et la
  // thématique qui la porte sort du ciel.
  const schemaT = await notion.dataSources.retrieve({ data_source_id: T.ds });
  const options = schemaT.properties.Dimension.select.options.map((o) => o.name);
  const attenduesNotion = DIMENSIONS.map((d) => NOTION_PAR_NOM.get(d.name));
  chk(`exactement ${attenduesNotion.length} options de Dimension`, options.length === attenduesNotion.length, options.join(' · '));
  chk('les options correspondent à club.config.js',
    attenduesNotion.every((d) => options.includes(d)),
    options.filter((o) => !attenduesNotion.includes(o)).join(' · '));

  // Une dimension que club.config.js ne connaît pas = thématique invisible.
  const dimsInconnues = [...new Set(actifsT.map((p) => p.properties.Dimension?.select?.name ?? '(vide)'))]
    .filter((d) => !NOM_PAR_NOTION.has(d));
  chk('aucune thématique sur une dimension inconnue', dimsInconnues.length === 0, dimsInconnues.join(' · '));

  // Trois énoncés : sans eux la compétence est inévaluable.
  const sansEnonce = actifsC.filter((p) => ['Énoncé N1', 'Énoncé N2', 'Énoncé N3'].some((k) => !txt(p, k)));
  chk('trois énoncés non vides par compétence', sansEnonce.length === 0,
    sansEnonce.map((p) => txt(p, 'Code')).slice(0, 8).join(' '));

  // Difficulté : sert à la pastille ; une valeur hors liste ne s'affiche pas.
  const diffs = DIFFICULTES.map((d) => d.nom);
  const mauvaiseDiff = actifsC.filter((p) => !diffs.includes(p.properties['Difficulté']?.select?.name));
  chk('difficulté conforme à club.config.js partout', mauvaiseDiff.length === 0,
    mauvaiseDiff.map((p) => txt(p, 'Code') + '=' + (p.properties['Difficulté']?.select?.name ?? 'vide')).slice(0, 6).join(' '));

  // Un code en double fait partager un niveau à deux compétences.
  const dblC = actifsC.map((p) => txt(p, 'Code')).filter((v, i, a) => a.indexOf(v) !== i);
  chk('aucun code de compétence en double', dblC.length === 0, [...new Set(dblC)].slice(0, 6).join(' '));
  const dblT = actifsT.map((p) => txt(p, 'Code')).filter((v, i, a) => a.indexOf(v) !== i);
  chk('aucun code de thématique en double', dblT.length === 0, [...new Set(dblT)].slice(0, 6).join(' '));

  // Une filiation vers une thématique archivée est une arête morte dans le graphe.
  const filMortes = actifsT.flatMap((p) => rel(p, 'Nourrit').filter((id) => !idsThemesActifs.has(id)).map(() => txt(p, 'Code')));
  chk('aucune filiation vers une thématique inactive', filMortes.length === 0, filMortes.slice(0, 6).join(' '));

  // Position : sans coordonnées, la thématique se dessine sur l'origine.
  const sansPos = actifsT.filter((p) => p.properties['Position X']?.number == null || p.properties['Position Y']?.number == null);
  chk('position X/Y renseignée partout', sansPos.length === 0, sansPos.map((p) => txt(p, 'Code')).slice(0, 6).join(' '));

  // --- Ce que ça donne, thématique par thématique ------------------------------
  console.log('\n=== Répartition ===');
  const parDim = new Map();
  for (const d of DIMENSIONS) parDim.set(d.name, []);
  for (const p of actifsT) {
    const nom = NOM_PAR_NOTION.get(p.properties.Dimension?.select?.name) ?? '(inconnue)';
    if (!parDim.has(nom)) parDim.set(nom, []);
    parDim.get(nom).push(p);
  }
  const compParTheme = new Map();
  for (const p of actifsC) {
    for (const id of rel(p, '📚 Thèmes')) compParTheme.set(id, (compParTheme.get(id) ?? 0) + 1);
  }
  for (const [dim, themes] of parDim) {
    const n = themes.reduce((s, t) => s + (compParTheme.get(t.id) ?? 0), 0);
    console.log(`  ${dim.padEnd(26)} ${String(themes.length).padStart(2)} thématiques · ${String(n).padStart(3)} compétences`);
    for (const t of themes.sort((a, b) => (a.properties.Ordre?.number ?? 99) - (b.properties.Ordre?.number ?? 99))) {
      const c = compParTheme.get(t.id) ?? 0;
      console.log(`      ${String(c)} comp. · ${txt(t, 'Code').padEnd(18)} ${txt(t, 'Name')}`
        + (c === 0 ? '   ⚠️ VIDE : s affichera éteinte et inévaluable' : ''));
    }
  }

  // Rappel utile : avec n compétences, une thématique vaut n × NIVEAU_MAX points.
  const tailles = [...compParTheme.values()];
  if (tailles.length) {
    const min = Math.min(...tailles), max = Math.max(...tailles);
    console.log(`\n  compétences par thématique : de ${min} à ${max}`);
    console.log(`  une thématique de ${min} vaut ${min * NIVEAU_MAX} points de lumière, une de ${max} en vaut ${max * NIVEAU_MAX}`);
  }

  // --- Comparaison à l'export, si on en donne un ------------------------------
  const source = process.argv[2];
  if (source && fs.existsSync(source)) {
    console.log(`\n=== Comparaison à ${source} ===`);
    const x = JSON.parse(fs.readFileSync(source, 'utf8'));
    chk('même nombre de thématiques', actifsT.length === x.themes.length, `Notion ${actifsT.length} / export ${x.themes.length}`);
    chk('même nombre de compétences', actifsC.length === x.competences.length, `Notion ${actifsC.length} / export ${x.competences.length}`);
    const codesNotion = new Set(actifsC.map((p) => txt(p, 'Code')));
    const manquants = x.competences.map((c) => c.code).filter((c) => !codesNotion.has(c));
    chk('aucun code de l export absent de Notion', manquants.length === 0, manquants.slice(0, 8).join(' '));
    const enTrop = [...codesNotion].filter((c) => !x.competences.some((k) => k.code === c));
    chk('aucun code dans Notion absent de l export', enTrop.length === 0, enTrop.slice(0, 8).join(' '));
  }

  console.log('');
  if (ECARTS.length === 0) console.log('Tous les contrôles passent.');
  else {
    console.log(`${ECARTS.length} écart(s) :`);
    ECARTS.forEach((e) => console.log('  · ' + e));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  principal().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
} else {
  console.error('verifier-notion.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { principal };
