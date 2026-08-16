// LE CATALOGUE ANGLAIS, en trois morceaux parce qu'ils ne se maintiennent pas pareil :
//
//   ui.ts     — l'interface : ce qui s'écrit dans les composants React ;
//   server.ts — les phrases COMPOSÉES par le serveur (gabarits fmt de Go) ;
//   data.ts   — les NOMS DE JEU et les phrases de catalogue, préfixés `data:`/`desc:`.
//
// Ajouter une langue = copier ce dossier, traduire, et l'inscrire dans LANGS
// (i18n/index.ts) et dans game.Langs (backend/internal/game/i18n.go). Rien d'autre :
// aucun changement de protocole, aucune migration de base.

import { UI } from "./ui";
import { SERVER } from "./server";
import { DATA } from "./data";

export const EN: Record<string, string> = { ...UI, ...SERVER, ...DATA };
