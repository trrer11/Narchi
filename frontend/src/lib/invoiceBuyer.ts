/** Destinataire facture depuis le projet — rien d'inventé. */

export function invoiceBuyerFromProject(p: {
  client?: string;
  name?: string;
  location?: string;
  clientStreet?: string;
  clientZip?: string;
  clientCity?: string;
  clientLeitweg?: string;
}): {
  buyer_name: string;
  buyer_street?: string;
  buyer_zip?: string;
  buyer_city?: string;
  buyer_reference?: string;
  note: string;
} {
  const name = (p.client || "").trim() || (p.name || "").trim() || "Kunde";
  const street = (p.clientStreet || "").trim();
  const zip = (p.clientZip || "").trim();
  const cityExplicit = (p.clientCity || "").trim();
  const loc = (p.location || "").trim();
  const city = cityExplicit || loc.split(",")[0]?.trim() || "";
  const leitweg = (p.clientLeitweg || "").trim();

  const manques: string[] = [];
  if (!street) manques.push("Straße");
  if (!zip) manques.push("PLZ");
  if (!city) manques.push("Ort");
  if (!leitweg) manques.push("Leitweg-ID");

  return {
    buyer_name: name,
    buyer_street: street || undefined,
    buyer_zip: zip || undefined,
    buyer_city: city || undefined,
    buyer_reference: leitweg || undefined,
    note:
      manques.length === 0
        ? `Auftraggeber aus Projekt (« ${name} ») — Beträge prüfen.`
        : `Auftraggeber aus Projekt (« ${name} ») — noch prüfen: ${manques.join(", ")}.`,
  };
}
