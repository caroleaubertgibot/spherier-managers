// ============================================================================
// CONFIGURATION DU CLUB — le seul fichier à relire pour monter une instance.
// ============================================================================
//
// Le sphérier a trois instances : `b2c` (Les Sommets, club de dev perso), `coachs`
// (club de coachs) et `managers` (club Manager-Coach, B2B). Même socle, contenus et
// référentiels différents, évolutions indépendantes ensuite.
//
// CETTE INSTANCE EST `managers`, et elle vit dans un DÉPÔT SÉPARÉ. Il n'y a aucune
// fusion entre les dépôts, dans aucun sens : une amélioration du moteur se reporte
// à la main. C'est le prix du mur étanche, et il a été choisi délibérément.
//
// Tout ce qui distingue une instance de l'autre est ICI. Le reste du code ne connaît
// aucune dimension, aucun libellé, aucun seuil : il les lit dans ce fichier, et le
// navigateur les reçoit dans la réponse de `/api/referential`.
//
// Ce qui n'est PAS ici, et n'a pas à y être :
//   — le contenu (thématiques, compétences, énoncés, ressources) : il vit dans Notion
//     et se modifie sans déploiement ;
//   — les secrets : ils vivent dans les variables d'environnement ;
//   — la géométrie du ciel (positions X/Y) : elle vit dans Notion aussi.
//
// Une chose IMPORTANTE, vérifiée sur le code : les préfixes des codes de compétences
// (`MOI-01`, `COL-12`…) ne portent AUCUNE logique. Une compétence est rattachée à sa
// dimension par sa thématique, jamais par son code.
//
// Et une autre, vérifiée aussi : une thématique se rattache à sa dimension par le
// `name` ci-dessous (`t.dimension === d.name` côté navigateur), tandis que le ciel se
// configure par l'`id`. Les deux doivent donc être justes, et le `name` doit
// correspondre AU CARACTÈRE PRÈS à l'option du select `Dimension` dans Notion.

// --- Quelle instance ? ------------------------------------------------------------
//
// Garde-fou contre une configuration croisée : si la variable CLUB de l'environnement
// ne correspond pas à ce que ce fichier déclare, c'est que le dépôt d'une instance
// tourne avec les secrets d'une autre. Sans ce contrôle, l'erreur serait silencieuse —
// on lirait le Notion d'un club en écrivant dans le Supabase de l'autre.
const CLUB = 'managers';

const CLUBS_CONNUS = ['b2c', 'coachs', 'managers'];

function verifierClub() {
  const attendu = CLUB;
  const declare = process.env.CLUB;
  if (!CLUBS_CONNUS.includes(attendu)) {
    throw new Error(`club.config.js : CLUB « ${attendu} » inconnu (attendus : ${CLUBS_CONNUS.join(', ')})`);
  }
  // La variable d'environnement est facultative en local ; si elle est posée, elle doit
  // correspondre. C'est en production qu'elle compte, où les trois instances existent.
  if (declare && declare !== attendu) {
    throw new Error(
      `CONFIGURATION CROISÉE : le code est celui du club « ${attendu} » mais la variable `
      + `d'environnement CLUB vaut « ${declare} ». Les secrets Notion et Supabase sont `
      + `probablement ceux d'une autre instance. On s'arrête plutôt que d'écrire au mauvais endroit.`
    );
  }
  return attendu;
}

// --- Version du référentiel -------------------------------------------------------
//
// À ne pas confondre avec le « v2 » des noms de fichiers, qui désigne la réécriture de
// l'application. Un snapshot d'une autre version est IGNORÉ et non relu : sans ce
// garde-fou, ses codes seraient tous filtrés comme inconnus et le membre apparaîtrait
// remis à zéro sans que rien ne le signale.
//
// Instance neuve : on part de 1. À incrémenter à chaque changement de SENS des codes.
//
// Attention au faux ami : les préfixes `MOI-` existent aussi dans le club de dev et
// n'y désignent pas les mêmes compétences. Les bases étant séparées, aucun snapshot ne
// peut traverser — c'est `CLUB` qui le garantit, pas ce numéro.
const VERSION_REFERENTIEL = 1;

// --- Les dimensions ---------------------------------------------------------------
//
// Ces définitions n'existent PAS dans Notion : elles sont câblées ici. L'ordre du
// tableau est l'ORDRE CANONIQUE — celui de l'API, de la vue d'ensemble, de l'accordéon
// et des parcours d'évaluation. Le ciel a son propre ordre visuel (plus bas).
//
// Deux définitions par dimension :
//   definition     — version longue, reprise du classeur Manager-Coach de Thomas
//   definition_ui  — version courte et au TUTOIEMENT, pour l'interface
// Le tutoiement est la règle dans tout ce qui s'adresse au membre.
//
// `couleur` est la teinte de la dimension. Elle voyage jusqu'au navigateur, qui en
// fabrique ses variables CSS : aucun identifiant de dimension n'est écrit dans la
// feuille de style. `--d-accent`, utilisée par le logo, est la teinte de la PREMIÈRE.
//
// ⚠️ TEINTES PROVISOIRES — à trancher avant le lancement. Elles sont lisibles sur le
// fond nuit et distinctes entre elles, mais elles n'ont pas été choisies : elles ont
// été posées pour que l'instance tourne.
//
// Les `name` ci-dessous sont EXACTEMENT ceux de la colonne `Dimension` du classeur, y
// compris la virgule de « Moi, manager ». Les modifier casse le rattachement des
// thématiques, en silence.
const DIMENSIONS = [
  {
    id: 'MOI',
    name: 'Moi, manager',
    // Notion REFUSE la virgule dans le nom d'une option de select. Ce nom-ci ne
    // peut donc pas être stocké tel quel — voir NOM_PAR_NOTION plus bas.
    nom_notion: 'Moi manager',
    definition: "La dimension Moi, manager réunit ce qui se travaille sur soi pour pouvoir coacher : croire en la capacité de l'autre, tenir le cadre et l'éthique d'un manager qui coache, être présent, se réguler, choisir sa casquette, et continuer à apprendre le geste.",
    definition_ui: "Ce qui se travaille sur toi avant de pouvoir coacher : croire en la capacité de l'autre, tenir ton cadre, être vraiment là, te réguler, et choisir la casquette que tu portes.",
    couleur: '#c98a5e',
  },
  {
    id: 'COL',
    name: 'Moi et mon collaborateur',
    definition: "La dimension Moi et mon collaborateur réunit le processus d'une conversation de coaching menée par un manager : contracter, créer la sécurité, écouter activement, questionner, faire émerger une prise de conscience, la transformer en action, donner un feedback qui ouvre, et tenir le geste quand c'est difficile.",
    definition_ui: "Le déroulé d'une conversation de coaching que tu mènes : contracter, créer la sécurité, écouter, questionner, faire émerger la prise de conscience, la transformer en action — et tenir le geste quand ça devient difficile.",
    couleur: '#6f93b8',
  },
  {
    id: 'EQU',
    name: 'Moi et mon équipe',
    definition: "La dimension Moi et mon équipe réunit la façon dont le geste de coaching s'installe hors de l'entretien formel : dans le flux du travail, dans les rituels, dans la délégation, face au collectif, et dans une culture qui ne dépend plus d'une seule personne.",
    definition_ui: "La façon dont le geste s'installe hors de l'entretien formel : dans le flux du travail, dans tes rituels, dans la délégation, face au collectif, et dans une culture qui ne dépend plus de toi seul.",
    couleur: '#87a06a',
  },
];

// --- Le nom côté Notion -----------------------------------------------------------
//
// Jusqu'ici une seule chaîne servait à deux choses : ce que le membre LIT, et la
// valeur par laquelle une thématique se RATTACHE à sa dimension (l'option du select
// `Dimension` dans Notion). Or Notion interdit la virgule dans le nom d'une option
// de select, et « Moi, manager » est le libellé voulu côté membre.
//
// D'où ce dédoublement, déclaré ICI et nulle part ailleurs :
//   `name`       — ce qu'on affiche, et l'identifiant canonique dans tout le code ;
//   `nom_notion` — ce qu'on stocke. Absent, c'est `name` qui est stocké.
//
// `referentiel-v2.js` retraduit à la LECTURE, `importer-classeur.js` traduit à
// l'ÉCRITURE. Rien d'autre dans le code ne connaît le nom Notion : le navigateur ne
// voit jamais que les `name`.
const NOTION_PAR_NOM = new Map(DIMENSIONS.map((d) => [d.name, d.nom_notion ?? d.name]));
const NOM_PAR_NOTION = new Map(DIMENSIONS.map((d) => [d.nom_notion ?? d.name, d.name]));

// --- L'échelle d'auto-évaluation --------------------------------------------------
//
// Les trois énoncés d'une compétence SONT l'échelle : le membre lit trois phrases en
// escalier et coche la plus haute qui est vraie pour lui. Le niveau 0 n'y figure pas :
// c'est l'absence d'énoncé coché, pas un palier nommé.
//
// Identique au club de dev — la feuille `_Listes` du classeur les reprend mot pour mot.
// Elle donne en plus un « sens » par palier, que le code ne lit pas et qui reste de la
// bonne matière pour une page d'accueil :
//   1 — je comprends de quoi il s'agit et je le repère chez moi
//   2 — je le fais parfois, à froid ou dans des situations simples
//   3 — je le fais en situation, sous pression, et dans la durée
const ECHELLE = {
  1: 'Je découvre',
  2: "J'expérimente",
  3: "J'incarne",
};

// --- La difficulté d'une compétence -----------------------------------------------
//
// Propriété `Difficulté` dans Notion. Les NOMS doivent correspondre exactement aux
// options du select Notion : c'est la clé de correspondance.
//
// Vocabulaire PROPRE AUX MANAGERS — « Accessible / Exigeant » là où le club de dev dit
// « Fondamental / Avancé ». Les deux listes ne sont pas interchangeables : les options
// Notion de cette instance portent ces noms-là.
//
// Le mot qualifie la COMPÉTENCE, pas la personne. Le vert et l'orange sont sémantiques
// et repris du classeur, qui les demande explicitement.
const DIFFICULTES = [
  { nom: 'Accessible', couleur: '#7c9c6e' },
  { nom: 'Exigeant', couleur: '#d08b3f' },
];

// --- Règles de progression --------------------------------------------------------
//
// MAX_CIBLES_MAINTENANT : plafond des compétences travaillées « ce mois ». Contrainte
// pédagogique, appliquée par le SERVEUR autant que par l'interface. « Plus tard » n'a
// pas de plafond.
//
// À NOTER pour cette instance : le référentiel Manager-Coach porte exactement TROIS
// compétences par thématique. Un plafond de 3 permet donc de cibler une thématique
// entière d'un coup — propriété plutôt heureuse, mais qui n'existait pas dans le club
// de dev où les thématiques en portent 4 à 14.
//
// Il n'y a pas de règle d'ouverture : toute thématique est accessible dès le premier
// jour. La lumière d'une thématique se calcule à partir de NIVEAU_MAX — voir
// illumination-v2.js. Les propriétés Notion `Nourrit`, `Nourri par` et `Seuil` restent
// en base ; `Seuil` n'est plus lu.
//
// Conséquence directe de ces trois compétences par thématique : une thématique vaut au
// plus 9 points, contre 21 pour une thématique de 7. Elle s'allume deux fois plus vite,
// et AJOUTER une compétence après le lancement retire 25 % de lumière à tous les
// membres, d'un coup. Le référentiel doit donc être considéré comme fermé au lancement.
const NIVEAU_MIN = 0;
const NIVEAU_MAX = 3;
const MAX_CIBLES_MAINTENANT = 3;

// --- Le ciel (page d'accueil desktop) ---------------------------------------------
//
// `ordre` est l'ordre VISUEL des blocs, et il est DÉLIBÉRÉMENT distinct de l'ordre
// canonique du référentiel. Il ne vaut que pour le ciel : l'API, la vue d'ensemble, le
// parcours « M'évaluer » et la navigation par dimension suivent `DIMENSIONS` et ne sont
// modifiés nulle part.
//
// La disposition est RADIALE, pas linéaire. « Moi, manager » est le centre du modèle :
// les deux autres dimensions sont littéralement nommées par rapport à lui — moi et mon
// collaborateur, moi et mon équipe. Les placer à sa droite en file suggérerait un ordre
// de lecture, donc une progression obligatoire, qui n'existe pas. Autour d'un centre,
// la même géométrie dit la bonne chose : deux cercles qui s'élargissent depuis soi, le
// plus proche à gauche, le plus large à droite. C'est la disposition du club de dev
// (`['AUT', 'MOI', 'MON']`, centre `MOI`), pour les mêmes raisons.
//
// `centre` est le bloc sur lequel le ciel s'ouvre, centré, avec une amorce de chaque
// côté. C'est donc le premier bloc que voit un manager qui arrive.
//
// `largeursFil` règle la largeur du fil décoratif de part et d'autre du bloc centré.
// Le fil ne porte aucun sens : sa largeur est le seul réglage libre, et on la dépense à
// ÉGALISER ce que montre chaque amorce.
//
// ⚠️ ATTENTION AUX CLÉS : `largeursFil` est indexé par la dimension EXTÉRIEURE de
// chaque fil, jamais par le centre. Déplacer `centre` change donc les clés attendues —
// une clé devenue inutile est ignorée SANS ERREUR, et le fil orphelin retombe sur le
// défaut CSS de 96 px. Avec `centre: 'MOI'`, les deux clés sont COL et EQU.
//
// Les valeurs ci-dessous sont MESURÉES sur le rendu réel, pas reprises du club de dev :
// ses 105 / 55 viennent d'une tout autre géométrie et ne veulent rien dire ici.
//
// La piste fait `min(1240px, 100vw - 16px)` : au-delà de 1256 px de fenêtre elle est
// CONSTANTE, donc la mesure vaut pour tous les écrans de bureau usuels. Blocs réels :
// 769 (COL) · 585 (MOI) · 561 (EQU). Centré sur MOI, il reste 327 px par côté.
//
// Deux contraintes, mesurées par balayage de 2 en 2 px :
//
//   1. LES TROIS EN-TÊTES ENTIERS. Un en-tête est collant et se cale au bord, mais ne
//      peut pas être plus étroit que lui-même : sous une certaine amorce il est coupé,
//      et la dimension perd son nom, son compte et son bouton d'entrée. « Moi et mon
//      collaborateur » est le plus long (298 px) et plafonne le fil GAUCHE à 22 px ;
//      « Moi et mon équipe » (225 px) plafonne le fil DROIT à 95 px.
//
//   2. ÉGALISER CE QUE MONTRE CHAQUE AMORCE. Contre toute attente ce n'est pas le bloc
//      le plus fourni qui déborde : le bord DROIT de COL est clairsemé et présente une
//      falaise — à 268 px d'amorce il ne laisse voir qu'une seule thématique, à 278 il
//      en laisse voir quatre d'un coup. Il faut donc passer cette falaise, ce que la
//      contrainte 1 impose de toute façon. Le bord GAUCHE de EQU, lui, est régulier.
//
// Retenu : 16 / 56, avec une marge de sécurité sous chaque plafond (6 px et 39 px) pour
// absorber un rendu de police légèrement différent. Résultat mesuré :
//
//      amorce gauche  312 px · 4 thématiques visibles · 1 libellé entier · en-tête OK
//      amorce droite  272 px · 3 thématiques visibles · 2 libellés entiers · en-tête OK
//
// Sous 1256 px de fenêtre la piste se resserre et les amorces fondent : il n'y a là
// aucun réglage qui tienne, et le ciel disparaît de toute façon sous 640 px.
// À refaire si la police de la constellation, celle des en-têtes, les noms de dimension
// ou les positions changent.
const CIEL = {
  ordre: ['COL', 'MOI', 'EQU'],
  centre: 'MOI',
  largeursFil: { COL: 16, EQU: 56 },
};

// --- Journal de démarrage ---------------------------------------------------------
//
// Chaque fonction Netlify charge ce module, directement ou par le référentiel : cette
// ligne apparaît donc une fois par démarrage à froid, dans les journaux de l'instance.
// C'est la façon la plus directe de répondre à « sur quel club tourne cette fonction ? »
// sans avoir à appeler l'API.
//
// La vérification est faite ICI, au chargement, et non à la première requête : une
// configuration croisée doit échouer tout de suite et bruyamment, pas au moment où un
// membre enregistre.
verifierClub();
console.log(`[sphérier] club = ${CLUB} · référentiel v${VERSION_REFERENTIEL} · ${DIMENSIONS.length} dimensions`);

module.exports = {
  CLUB,
  CLUBS_CONNUS,
  verifierClub,
  VERSION_REFERENTIEL,
  DIMENSIONS,
  NOTION_PAR_NOM,
  NOM_PAR_NOTION,
  ECHELLE,
  DIFFICULTES,
  NIVEAU_MIN,
  NIVEAU_MAX,
  MAX_CIBLES_MAINTENANT,
  CIEL,
};
