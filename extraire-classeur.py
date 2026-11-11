#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===========================================================================
 Extraction du classeur Manager-Coach vers referentiel-managers.json
===========================================================================

 Le classeur de Thomas est la SOURCE unique du référentiel. Ce script le lit
 et en produit un JSON, qui est ensuite écrit dans Notion par
 `importer-classeur.js`.

 POURQUOI UN JSON INTERMÉDIAIRE, et non un collage direct dans Notion :
   — un `.xls` ne se compare pas ; un JSON se versionne et se relit en diff,
     ce qui rend visible ce qui a changé entre deux versions du classeur ;
   — toutes les relations y sont exprimées par CODE, jamais par nom. C'est ce
     qui permet à l'import de résoudre les liens par identifiant de page au
     lieu de se fier à une correspondance de titres — laquelle crée
     SILENCIEUSEMENT une page en double à la moindre faute d'accent ;
   — il joue le même rôle que `sauvegardes/export-notion-*.json` pour le club
     de dev : l'état gelé, relisible hors de Notion.

 Ce script N'ÉCRIT RIEN dans Notion. Il est relançable sans risque.

 Dépendance :  pip3 install xlrd        (lecture des .xls hérités)

 Utilisation :
   python3 extraire-classeur.py
   python3 extraire-classeur.py "/chemin/vers/un/autre/classeur.xls"

 Il s'arrête en erreur au premier écart : un référentiel à moitié juste ne
 doit jamais partir dans Notion.
===========================================================================
"""

import io
import json
import os
import sys
from collections import Counter, OrderedDict
from datetime import datetime, timezone

try:
    import xlrd
except ImportError:
    sys.exit("xlrd manquant. Installer avec :  pip3 install xlrd")

CLASSEUR_DEFAUT = "/Users/cyril/Desktop/Coaching/Club Managers/Sphérier Manager-Coach - V2.xls"
SORTIE = "referentiel-managers.json"

# Doivent correspondre AU CARACTÈRE PRÈS aux DIMENSIONS de club.config.js : c'est
# par ce nom qu'une thématique se rattache à sa dimension, côté navigateur comme
# dans l'option du select Notion.
DIMENSIONS_ATTENDUES = [
    "Moi, manager",
    "Moi et mon collaborateur",
    "Moi et mon équipe",
]

# Idem pour DIFFICULTES de club.config.js.
DIFFICULTES_ATTENDUES = {"Accessible", "Exigeant"}

ECARTS = []


def ecart(message):
    ECARTS.append(message)


def controle(libelle, condition, detail=""):
    print(("  OK    " if condition else "  ÉCART ") + libelle + (f"  [{detail}]" if detail else ""))
    if not condition:
        ecart(libelle + (f" — {detail}" if detail else ""))


def feuille(classeur, nom):
    """Lit une feuille en liste de dictionnaires, la première ligne servant d'en-tête."""
    sh = classeur.sheet_by_name(nom)
    colonnes = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
    lignes = []
    for r in range(1, sh.nrows):
        ligne = {}
        for c, cle in enumerate(colonnes):
            v = sh.cell_value(r, c)
            # xlrd rend tous les nombres en float : 3.0 pour un ordre de 3.
            if isinstance(v, float) and v == int(v):
                v = int(v)
            ligne[cle] = v if isinstance(v, (int, float)) else str(v).strip()
        if any(str(v) != "" for v in ligne.values()):
            lignes.append(ligne)
    return lignes


def principal():
    chemin = sys.argv[1] if len(sys.argv) > 1 else CLASSEUR_DEFAUT
    if not os.path.exists(chemin):
        sys.exit(f"classeur introuvable : {chemin}")

    classeur = xlrd.open_workbook(chemin)
    arch = feuille(classeur, "Architecture")
    comp = feuille(classeur, "Compétences")
    enon = feuille(classeur, "Énoncés")

    print(f"source : {os.path.basename(chemin)}")
    print(f"  {len(arch)} thématiques · {len(comp)} compétences · {len(enon)} énoncés\n")

    # --- Les dimensions, avant tout le reste ------------------------------------
    # Une dimension mal orthographiée ne provoque aucune erreur : Notion crée
    # l'option à la volée et la thématique se retrouve rattachée à une dimension
    # que le navigateur ne connaît pas. Elle disparaît alors du ciel, en silence.
    print("=== Dimensions ===")
    vues = list(OrderedDict.fromkeys(t["Dimension"] for t in arch))
    controle(
        "les dimensions du classeur sont exactement celles de club.config.js",
        vues == DIMENSIONS_ATTENDUES,
        " | ".join(vues),
    )

    # --- Thématiques ------------------------------------------------------------
    print("\n=== Thématiques ===")
    code_par_nom = {t["Thématique"]: t["Code"] for t in arch}
    controle("codes de thématique uniques",
             len(set(code_par_nom.values())) == len(arch))
    controle("noms de thématique uniques",
             len(code_par_nom) == len(arch))
    controle("Position X/Y renseignées partout",
             all(t["Position X"] != "" and t["Position Y"] != "" for t in arch))
    controle("Ordre renseigné partout",
             all(t["Ordre"] != "" for t in arch))
    controle("définition de thématique non vide",
             all(t["Définition de la thématique"] for t in arch))

    # Aucune collision de position DANS une dimension : le ciel dessine un canevas
    # par dimension, deux dimensions peuvent donc partager les mêmes coordonnées.
    for dim in vues:
        pos = Counter((t["Position X"], t["Position Y"]) for t in arch if t["Dimension"] == dim)
        doubles = [p for p, n in pos.items() if n > 1]
        controle(f"aucune collision de position dans « {dim} »", not doubles, str(doubles))

    themes = []
    for t in arch:
        # `Nourrit` est exprimé par NOM dans le classeur, séparé par des « · ».
        # On le convertit en CODES : c'est le principe de ce fichier.
        cibles = []
        for brut in str(t["Nourrit"]).split("·"):
            nom = brut.strip()
            if not nom or "racine" in nom:
                continue
            if nom not in code_par_nom:
                ecart(f"filiation {t['Code']} -> « {nom} » : thématique inconnue")
                continue
            cibles.append(code_par_nom[nom])
        themes.append({
            "name": t["Thématique"],
            "code": t["Code"],
            "definition": t["Définition de la thématique"],
            "dimension": t["Dimension"],
            "ordre": t["Ordre"],
            "position_x": t["Position X"],
            "position_y": t["Position Y"],
            "seuil": None,          # plus lu par l'application
            "actif": True,
            "nourrit": cibles,
            # Non importé dans Notion : aucune propriété ne l'accueille aujourd'hui.
            # Conservé ici pour ne rien perdre de la matière de Thomas.
            "exemples_demandes": t.get("Exemples de demandes", ""),
        })

    filiations = sum(len(t["nourrit"]) for t in themes)
    controle("toutes les filiations résolues par code",
             not [e for e in ECARTS if "filiation" in e], f"{filiations} arêtes")

    # --- Énoncés, pivotés du format long vers trois colonnes --------------------
    print("\n=== Énoncés ===")
    par_code = {}
    for e in enon:
        code = e["Code compétence"]
        # La colonne vaut « 1 · Je découvre » : on ne garde que le chiffre de tête.
        niveau = str(e["Niveau"]).strip()[:1]
        if niveau not in ("1", "2", "3"):
            ecart(f"énoncé {e.get('ID énoncé')} : niveau illisible « {e['Niveau']} »")
            continue
        par_code.setdefault(code, {})[niveau] = e["Énoncé d'auto-évaluation"]

    controle("trois énoncés par compétence, aucun vide",
             all(len(v) == 3 and all(str(x).strip() for x in v.values()) for v in par_code.values()),
             ", ".join(f"{k}={len(v)}" for k, v in par_code.items() if len(v) != 3)[:120])
    controle("aucun énoncé orphelin",
             not (set(par_code) - {c["Code"] for c in comp}),
             str(sorted(set(par_code) - {c["Code"] for c in comp})[:5]))

    # --- Compétences ------------------------------------------------------------
    print("\n=== Compétences ===")
    controle("codes de compétence uniques",
             len({c["Code"] for c in comp}) == len(comp))
    controle("thématique de chaque compétence connue",
             not ({c["Thématique"] for c in comp} - set(code_par_nom)),
             str(sorted({c["Thématique"] for c in comp} - set(code_par_nom))[:3]))
    controle("difficultés conformes à club.config.js",
             {c["Difficulté"] for c in comp} == DIFFICULTES_ATTENDUES,
             " / ".join(sorted({c["Difficulté"] for c in comp})))
    controle("définition de compétence non vide",
             all(c["Définition de la compétence (à la 1re personne)"] for c in comp))
    controle("chaque compétence a ses énoncés",
             not ({c["Code"] for c in comp} - set(par_code)),
             str(sorted({c["Code"] for c in comp} - set(par_code))[:5]))

    # L'ORDRE, absent du classeur. Le code le traite ainsi (vérifié dans
    # referentiel-v2.js) : une compétence sans Ordre passe en FIN de sa thématique,
    # départagée par code alphabétique. Avec des codes séquentiels le résultat
    # tombe juste par accident — mais une compétence insérée plus tard atterrirait
    # en dernier quelle que soit sa place. On pose donc un rang explicite, par pas
    # de 10, dans l'ordre du classeur : il reste de la place pour intercaler.
    rang = {}
    competences = []
    for c in comp:
        code_theme = code_par_nom[c["Thématique"]]
        rang[code_theme] = rang.get(code_theme, 0) + 10
        competences.append({
            "code": c["Code"],
            "name": c["Compétence"],
            "description": c["Définition de la compétence (à la 1re personne)"],
            "difficulte": c["Difficulté"],
            "ordre": rang[code_theme],
            "actif": True,
            "theme": code_theme,
            "dimension": c["Dimension"],
            "enonces": par_code.get(c["Code"], {}),
        })

    # --- Comptes attendus, repris de la feuille Synthèse du classeur ------------
    print("\n=== Comptes ===")
    attendus = {"Moi, manager": (5, 15), "Moi et mon collaborateur": (8, 24), "Moi et mon équipe": (5, 15)}
    for dim, (nt, nc) in attendus.items():
        vt = sum(1 for t in themes if t["dimension"] == dim)
        vc = sum(1 for c in competences if c["dimension"] == dim)
        controle(f"{dim} : {nt} thématiques, {nc} compétences", (vt, vc) == (nt, nc), f"{vt} / {vc}")
    controle("18 thématiques au total", len(themes) == 18, str(len(themes)))
    controle("54 compétences au total", len(competences) == 54, str(len(competences)))
    d = Counter(c["difficulte"] for c in competences)
    controle("28 Accessible / 26 Exigeant",
             d["Accessible"] == 28 and d["Exigeant"] == 26, json.dumps(d))

    # --- Écriture ---------------------------------------------------------------
    if ECARTS:
        print("\n" + "=" * 70)
        print(f"{len(ECARTS)} écart(s) — RIEN N'EST ÉCRIT.")
        for e in ECARTS:
            print("  · " + e)
        sys.exit(1)

    sortie = {
        "extrait_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": os.path.basename(chemin),
        "principe": "Toutes les relations sont exprimées par Code, jamais par nom ni par identifiant de page.",
        "referentiel_version": 1,
        "themes": themes,
        "competences": competences,
        # La base Ressources démarre vide : elle se remplit au fil du programme.
        "ressources": [],
    }
    io.open(SORTIE, "w", encoding="utf-8").write(
        json.dumps(sortie, ensure_ascii=False, indent=1) + "\n"
    )
    print(f"\n{'=' * 70}")
    print(f"Tous les contrôles passent. Écrit : {SORTIE}")
    print(f"  {len(themes)} thématiques · {filiations} filiations · {len(competences)} compétences · {len(enon)} énoncés")


if __name__ == "__main__":
    principal()
