require('dotenv').config({ quiet: true });

const fs = require('fs');
const { Client } = require('@notionhq/client');

// ===========================================================================
// Import du référentiel dans un espace Notion NEUF, depuis l'export gelé.
// ===========================================================================
//
// C'est le pendant de `export-notion.js` : celui-ci lit un espace, celui-là en
// remplit un autre. Les deux tiennent par le même principe — toutes les relations
// sont exprimées par `Code`, jamais par identifiant de page. C'est ce qui rend
// l'export utilisable dans un espace qui n'est pas celui d'origine.
//
// Il pose aussi les options du select `Dimension`, déduites des dimensions
// réellement portées par les thématiques de l'export. Les saisir à la main serait
// le maillon faible : une faute de frappe vide la dimension sans message d'erreur,
// puisque c'est par ce NOM que les thématiques s'y rattachent.
//
// Écrit dans les bases désignées par DB_THEMES / DB_COMPETENCES / DB_RESSOURCES.
// Vérifier ces variables avant de lancer : rien n'empêche de viser le mauvais espace.
//
//   SOURCE=... SIMULATION=1 node importer-export.js   -> ne rien écrire
//   SOURCE=... node importer-export.js

const SOURCE = process.env.SOURCE || 'sauvegardes/export-notion-2026-09-04.json';
const PAUSE_MS = 340;

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SIMULATION = process.env.SIMULATION === '1';

// Teintes des dimensions dans Notion. Purement cosmétique côté Notion — l'interface
// du sphérier tient ses couleurs de club.config.js — mais une base lisible aide.
const COULEURS = ['orange', 'blue', 'green', 'purple', 'yellow', 'pink'];

async function avecReprise(action, essais = 5) {
  for (let i = 1; i <= essais; i++) {
    try { return await action(); } catch (err) {
      const recuperable = err.code === 'rate_limited' || err.status === 429 || err.status >= 500;
      if (!recuperable || i === essais) throw err;
      await dormir(1000 * i);
    }
  }
}

const rt = (v) => ({ rich_text: v ? [{ type: 'text', text: { content: String(v).slice(0, 2000) } }] : [] });
const ti = (v) => ({ title: [{ type: 'text', text: { content: String(v ?? '') } }] });
const txt = (page, nom) => {
  const p = page.properties[nom];
  return ((p?.rich_text ?? p?.title ?? []).map((s) => s.plain_text).join('')).trim();
};

async function dsDe(env) {
  if (!process.env[env]) throw new Error(`${env} manquant`);
  const db = await notion.databases.retrieve({ database_id: process.env[env] });
  return db.data_sources[0].id;
}

async function toutes(dsId) {
  let cursor, pages = [];
  do {
    const r = await avecReprise(() => notion.dataSources.query({ data_source_id: dsId, start_cursor: cursor, page_size: 100 }));
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return pages;
}

async function principal() {
  const x = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const [dsT, dsC, dsR] = await Promise.all([
    dsDe('DB_THEMES'), dsDe('DB_COMPETENCES'), dsDe('DB_RESSOURCES'),
  ]);

  const tActifs = x.themes.filter((t) => t.actif);
  const cActifs = x.competences.filter((c) => c.actif);
  // Ordre CANONIQUE des dimensions, pas l'ordre de découverte dans l'export : c'est
  // cosmétique côté Notion, mais la base doit se lire comme le référentiel.
  const { DIMENSIONS } = require('./club.config.js');
  const rang = new Map(DIMENSIONS.map((d, i) => [d.name, i]));
  const dimensions = [...new Set(tActifs.map((t) => t.dimension))]
    .sort((a, b) => (rang.get(a) ?? 99) - (rang.get(b) ?? 99));

  console.log(SIMULATION ? '=== SIMULATION — aucune écriture ===\n' : '=== IMPORT ===\n');
  console.log(`source : ${SOURCE}`);
  console.log(`  ${tActifs.length} thématiques · ${cActifs.length} compétences · ${tActifs.reduce((n, t) => n + t.nourrit.length, 0)} filiations`);
  console.log(`  dimensions : ${dimensions.join(' · ')}`);

  // On refuse d'écrire dans une base qui contient déjà quelque chose : cet import
  // crée, il ne réconcilie pas. Deux passages produiraient deux jeux de pages.
  const [dejaT, dejaC] = await Promise.all([toutes(dsT), toutes(dsC)]);
  if (dejaT.length || dejaC.length) {
    throw new Error(`les bases ne sont pas vides (${dejaT.length} thématiques, ${dejaC.length} compétences) — cet import ne sait que remplir un espace neuf`);
  }
  console.log('  bases cibles : vides, prêtes à recevoir\n');

  if (SIMULATION) {
    console.log(`[simulation] options de Dimension : ${dimensions.join(', ')}`);
    console.log(`[simulation] ${tActifs.length} thématiques, dont ${tActifs.filter((t) => t.seuil != null).length} avec un Seuil`);
    console.log(`[simulation] ${tActifs.reduce((n, t) => n + t.nourrit.length, 0)} filiations résolues par code`);
    console.log(`[simulation] ${cActifs.length} compétences avec leurs énoncés`);
    return;
  }

  // 1. Les options du select Dimension, AVANT les thématiques : Notion les créerait
  //    sinon à la volée, mais on veut maîtriser leur ordre et leur couleur.
  await avecReprise(() => notion.dataSources.update({
    data_source_id: dsT,
    properties: {
      Dimension: { select: { options: dimensions.map((d, i) => ({ name: d, color: COULEURS[i % COULEURS.length] })) } },
    },
  }));
  const reluT = await notion.dataSources.retrieve({ data_source_id: dsT });
  const posees = reluT.properties.Dimension.select.options.map((o) => o.name);
  const absentes = dimensions.filter((d) => !posees.includes(d));
  if (absentes.length) throw new Error(`options de Dimension non posées : ${absentes.join(', ')}`);
  console.log(`  options de Dimension posées : ${posees.join(' · ')}`);

  // 2. Les thématiques, SANS filiation : leurs cibles n'existent pas encore.
  const idParCode = new Map();
  let n = 0;
  for (const t of tActifs) {
    const page = await avecReprise(() => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsT },
      properties: {
        Name: ti(t.name),
        Code: rt(t.code),
        DefinitionThematique: rt(t.definition),
        Dimension: { select: { name: t.dimension } },
        'Position X': { number: t.position_x },
        'Position Y': { number: t.position_y },
        Ordre: { number: t.ordre },
        Actif: { checkbox: true },
        ...(t.seuil != null ? { Seuil: { number: t.seuil } } : {}),
      },
    }));
    idParCode.set(t.code, page.id);
    await dormir(PAUSE_MS);
    if (++n % 12 === 0) console.log(`  ${n} / ${tActifs.length} thématiques…`);
  }
  console.log(`  ${n} thématiques créées`);

  // 3. Les filiations, résolues PAR CODE — le principe même de l'export.
  let f = 0;
  for (const t of tActifs) {
    if (!t.nourrit.length) continue;
    const cibles = t.nourrit.map((code) => {
      const id = idParCode.get(code);
      if (!id) throw new Error(`filiation ${t.code} -> ${code} : code introuvable`);
      return { id };
    });
    await avecReprise(() => notion.pages.update({
      page_id: idParCode.get(t.code), properties: { Nourrit: { relation: cibles } },
    }));
    f += cibles.length;
    await dormir(PAUSE_MS);
  }
  console.log(`  ${f} filiations posées`);

  // 4. Les compétences, énoncés compris : une compétence sans ses trois énoncés est
  //    inévaluable, autant ne jamais la créer incomplète.
  let c = 0;
  for (const comp of cActifs) {
    const idTheme = idParCode.get(comp.theme);
    if (!idTheme) throw new Error(`compétence ${comp.code} : thématique ${comp.theme} introuvable`);
    await avecReprise(() => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsC },
      properties: {
        Name: ti(comp.name),
        Code: rt(comp.code),
        Description: rt(comp.description),
        'Difficulté': { select: { name: comp.difficulte } },
        Ordre: { number: comp.ordre },
        Actif: { checkbox: true },
        '📚 Thèmes': { relation: [{ id: idTheme }] },
        'Énoncé N1': rt(comp.enonces['1']),
        'Énoncé N2': rt(comp.enonces['2']),
        'Énoncé N3': rt(comp.enonces['3']),
      },
    }));
    await dormir(PAUSE_MS);
    if (++c % 40 === 0) console.log(`  ${c} / ${cActifs.length} compétences…`);
  }
  console.log(`  ${c} compétences créées, énoncés compris`);

  // 5. Les ressources. Celles de l'espace d'origine n'ont aucun rattachement — elles
  //    l'ont perdu à la refonte V7 — on les recrée telles quelles.
  let r = 0;
  const idCompParCode = new Map((await toutes(dsC)).map((p) => [txt(p, 'Code'), p.id]));
  for (const res of x.ressources) {
    await avecReprise(() => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsR },
      properties: {
        Name: ti(res.name),
        Type: { multi_select: (res.type ?? []).map((t) => ({ name: t })) },
        ...(res.url ? { URL: { url: res.url } } : {}),
        Actif: { checkbox: res.actif },
        '📚 Thèmes': { relation: res.themes.map((code) => ({ id: idParCode.get(code) })).filter((v) => v.id) },
        '⚒️ Compétences': { relation: res.competences.map((code) => ({ id: idCompParCode.get(code) })).filter((v) => v.id) },
      },
    }));
    await dormir(PAUSE_MS);
    r++;
  }
  console.log(`  ${r} ressources créées`);
}

if (require.main === module) {
  principal().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
} else {
  console.error('importer-export.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { principal };
