"""§131 — Versand (envoi) : e-mail prêt à l'envoi (.eml) avec la facture hybride jointe.

Dernier jalon du lot E-Rechnung (§123 → §128 CI → §129 ZUGFeRD → §130 UBL →
§131 Versand). La demande client : « Versand per E-Mail/Peppol ».

Ce que ce module FAIT, honnêtement :
  * `generer_email(facture, pdf_zugferd)` → un fichier **.eml** (RFC 5322,
    MIME) PRÊT À L'ENVOI : expéditeur = e-mail du bureau, destinataire =
    e-mail du client, objet + corps en allemand, pièce jointe = la facture
    hybride PDF/A-3 ZUGFeRD (§129 — lisible par un humain ET par une
    machine). L'utilisateur télécharge le .eml, l'ouvre dans son client
    mail (Outlook/Thunderbird/…), et ENVOIE. Le client mail fait le transport
    réel — Narchi ne prétend jamais avoir « envoyé ».
  * zéro dépendance : stdlib `email` + `EmailMessage`.

Ce que ce module ne PRÉTEND PAS :
  * **Pas de SMTP intégré** : envoyer automatiquement exige les identifiants
    du serveur de messagerie du bureau (SMTP) — un réglage par bureau, que
    Narchi ne possède pas. Le .eml délègue l'envoi au client mail du bureau,
    ce qui est à la fois plus simple et plus honnête.
  * **Pas de Peppol** : l'envoi sur le réseau Peppol exige un Access Point +
    un Participant ID (jalon d'infrastructure DIFFÉRÉ, `docs/PEPPOL.md`).
    Ce que ce module produit (l'e-mail) reste le canal humain par défaut.

Pourquoi le PDF hybride comme pièce jointe (et pas le XML seul) : un seul
fichier qui sert les DEUX lecteurs — le destinataire humain le lit, et sa
machine en extrait le XML (factur-x.xml) automatiquement. C'est l'aboutissement
de §129.

Provenance : RFC 5322 / MIME (standards publics), stdlib email. Aucun code
tiers copié (doctrine §114).
"""
from __future__ import annotations

from email.message import EmailMessage

from app.services.xrechnung import Facture, calculer_totaux


def _fmt_eur_de(v: str) -> str:
    """Chaîne décimale (« 4760.00 ») → affichage allemand « 4.760,00 EUR ». """
    ent, dec = (v.split(".", 1) + ["00"])[:2]
    dec = (dec + "00")[:2]
    milliers = f"{int(ent):,}".replace(",", ".")
    return f"{milliers},{dec} EUR"


def generer_email(
    facture: Facture,
    pdf_zugferd: bytes,
) -> EmailMessage:
    """E-mail prêt à l'envoi (RFC 5322/MIME), facture hybride jointe.

    Args:
        facture: le modèle §114 (pour expéditeur/destinataire/numéro/montant).
        pdf_zugferd: les octets du PDF hybride §129 (pièce jointe).

    Returns:
        un EmailMessage (à sérialiser via as_bytes() — l'API le rend en .eml).
    """
    msg = EmailMessage()
    msg["Subject"] = f"Rechnung {facture.numero} — {facture.vendeur.nom}"
    # Expéditeur/destinataire : adresses du modèle (§123, BT-34/49).
    if facture.vendeur.email.strip():
        msg["From"] = facture.vendeur.email.strip()
    if facture.acheteur.email.strip():
        msg["To"] = facture.acheteur.email.strip()
    msg["X-Narchi-Invoice"] = facture.numero

    total = calculer_totaux(facture.lignes)
    brut = _fmt_eur_de(str(total["brut"]))

    corps = (
        "Sehr geehrte Damen und Herren,\n\n"
        f"anbei erhalten Sie unsere Rechnung {facture.numero} "
        f"vom {facture.date_emission} über {brut} (brutto).\n\n"
        "Die Rechnung ist als PDF/A-3 (ZUGFeRD) beigefügt: für Sie lesbar "
        "und für Ihre Buchhaltung maschinenlesbar.\n\n"
    )
    if facture.notes:
        for note in facture.notes:
            corps += f"{note}\n"
        corps += "\n"
    corps += (
        "Mit freundlichen Grüßen\n"
        f"{facture.vendeur.nom}\n"
    )
    msg.set_content(corps)

    # Pièce jointe : la facture hybride (un seul fichier, deux lecteurs).
    nom_fichier = f"{facture.numero.replace(' ', '_')}_zugferd.pdf"
    msg.add_attachment(
        pdf_zugferd,
        maintype="application",
        subtype="pdf",
        filename=nom_fichier,
    )
    return msg


def eml_bytes(facture: Facture, pdf_zugferd: bytes) -> bytes:
    """Serialise l'e-mail en .eml (octets, prêt à télécharger)."""
    return generer_email(facture, pdf_zugferd).as_bytes()
