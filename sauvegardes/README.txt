NARCHI — SAUVEGARDES EXTERNES (§113)
====================================

Ce dossier recoit les copies EXTERNES de la base :

    narchi-AAAAMMJJ-HHMMSS.sql.gz   <- copie complete, compressee
    dernier_export.json             <- verite terrain (jamais de succes muet)

Produit par :  5_SAUVEGARDE_EXTERNE.bat  (manuel)
               ou la tache du Planificateur (7_PROGRAMMER_SAUVEGARDE_HEBDO.bat)
Prouve par :   6_VERIFIER_RESTAURATION.bat (rejoue une copie pour de vrai)

CONSERVE ici : les 60 copies les plus recentes (rotation automatique).

CONFIDENTIEL : ces fichiers contiennent TOUTES les donnees NARCHI.
- Ils ne sont JAMAIS envoyes dans le depot git (voir .gitignore).
- Copiez ce dossier sur cle USB / autre PC / NAS (une copie ici reste
  sur le MEME disque que la base : insuffisant contre une panne disque).
