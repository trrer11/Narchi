# Fixtures dorées — factures XML acceptées par le validateur OFFICIEL KoSIT

Ces deux fichiers ne sont **pas** écrits à la main. Ils ont été générés par
NOTRE code (`app.services.xrechnung.construire_cii`, à partir de la fixture
`facture_ok()` de `backend/tests/test_xrechnung.py`) puis soumis au logiciel
de validation publie par l'Etat allemand :

- **Programme** : KoSIT Validator **v1.6.2**
  (`validator-1.6.2-standalone.jar`, 10 618 475 octets,
  SHA-256 `244978514ad48f67c7573acfffc8f4fd73d81feda6f276710033f9913579857e`,
  <https://github.com/itplr-kosit/validator/releases/tag/v1.6.2>)
- **Configuration** : **XRechnung 3.0.2**, parution officielle **31/01/2026**
  (`xrechnung-3.0.2-validator-configuration-2026-01-31.zip`, 487 782 octets,
  SHA-256 `6a5a5911a421b25fbc423f62f93f894df7b236f5d73ca4f84bb222a945082704`,
  <https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-01-31>)
- **Validation mesurée le 13/08/2026** : verdict « **ACCEPTABLE** » (Schema Y,
  Schematron Y) pour les DEUX profils, « Validation successful! » en fin de
  course, zéro avertissement.
- Le XML du chemin API complet (création → émission → téléchargement,
  facture RE-2026-0001) a aussi été accepté le même jour. Il n'est pas gardé
  ici : sa date d'émission = le jour courant, donc non déterministe — une
  fixture qui bouge toute seule serait un faux repère.

## Règle d'or

Le test `test_octets_exactement_ceux_acceptes_par_le_validateur_kosit`
(`backend/tests/test_xrechnung.py`) régénère le XML depuis le code et le
compare **octet par octet** à ces fichiers. Si une retouche du service change
ne serait-ce qu'UN octet, le test tombe — c'est voulu : le document n'est
alors PLUS celui que le validateur officiel a accepté.

Dans ce cas, OBLIGATOIRE et dans cet ordre :

1. `bash scripts/valider-xrechnung-kosit.sh` — rejoue le validateur officiel
   sur les NOUVEAUX octets (Java requis ; URLs et empreintes épinglées dans
   le script) ;
2. seulement si le verdict est « ACCEPTABLE » (Validation successful!),
   recopier les nouveaux échantillons ici et mettre à jour date + versions
   dans CET en-tête ;
3. consigner la revalidation dans `CHANGELOG_NARCHI_V6.md`.

Rafraîchir ces fichiers sans revalidation officielle mesurée = fabriquer une
preuve = interdit absolu dans ce dépôt.
