const { NIVEAU_MAX } = require('./club.config.js');

// Illumination des thématiques.
//
// Il n'y a plus de verrou : toute thématique est accessible dès le premier jour, et les
// filiations `Nourrit` ne sont plus qu'une indication de parcours. Ce qui remplace
// l'état ouvert/verrouillé, c'est une LUMIÈRE graduée :
//
//     somme des niveaux ÷ (NIVEAU_MAX × nombre de compétences actives)
//
// de 0 (rien d'évalué) à 1 (tout à « J'incarne »). Tout à « Je découvre » donne 1/3.
//
// Fondée sur les NIVEAUX et jamais sur le nombre de compétences évaluées : à
// l'onboarding chaque membre s'évalue sur tout le référentiel, un taux « évaluées /
// total » vaudrait 100 % partout dès le premier jour et ne dirait rien.
//
// Comme l'ouverture avant elle, la lumière n'est jamais stockée : elle se déduit des
// niveaux et du référentiel courant. Ajouter ou archiver une compétence dans Notion la
// recalcule sans migration.
function calculerIllumination({ referentiel, levels = {} }) {
  const parTheme = new Map(referentiel.themes.map((t) => [t.id, { somme: 0, competences: 0 }]));
  referentiel.competencies.forEach((c) => {
    const cumul = parTheme.get(c.theme);
    if (!cumul) return;
    cumul.somme += normaliserNiveau(levels[c.id]);
    cumul.competences += 1;
  });

  const themes = {};
  parTheme.forEach(({ somme, competences }, themeId) => {
    themes[themeId] = {
      // Arrondi à quatre décimales : assez pour comparer deux points, sans bruit de
      // virgule flottante dans la réponse.
      illumination: competences === 0 ? 0 : Math.round((somme / (NIVEAU_MAX * competences)) * 10000) / 10000,
      somme,
      competences,
    };
  });
  return themes;
}

// Niveaux complets : toute compétence du référentiel est présente, à 0 par défaut.
// Le 0 n'est pas un palier nommé, c'est l'étoile éteinte.
function niveauxComplets({ referentiel, levels = {} }) {
  const complets = {};
  referentiel.competencies.forEach((c) => {
    complets[c.id] = normaliserNiveau(levels[c.id]);
  });
  return complets;
}

function normaliserNiveau(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return 0;
  return Math.min(NIVEAU_MAX, Math.max(0, Math.round(n)));
}

module.exports = { calculerIllumination, niveauxComplets, normaliserNiveau };
