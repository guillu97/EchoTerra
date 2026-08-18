import { useState } from "react";
import { useStore } from "../store";
import { HeroActionsMenu } from "./HeroActionsMenu";
import { heroesInTown } from "../townUtils";
import { useWaveRemaining, formatHMS } from "../useWave";
import { damageRange, damageSentence, precisionSentence, besiegingSentence } from "../forecast";
import { assetUrl, type AssetKey } from "../assets";
import { useT } from "../i18n/useT";

// Portrait key for a hero class (same mapping as HeroOverlay).
function portraitKey(classId?: string): AssetKey {
  const map: Record<string, AssetKey> = {
    pionnier: "hero-pionnier",
    chasseur: "hero-chasseur",
    eclaireur: "hero-eclaireur",
    gardien: "hero-gardien",
    recuperateur: "hero-recuperateur",
    herboriste: "hero-herboriste",
  };
  return (classId && map[classId]) || "hero-sans-classe";
}

// Top status bar present on all in-game screens (avatar, town name, town HP,
// team PA, journal, settings). The avatar opens the hero dropdown: roster +
// per-hero actions + character sheets.
export function TopBar() {
  const T = useT();
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleTownJournal = useStore((s) => s.toggleTownJournal);
  const toggleChat = useStore((s) => s.toggleChat);
  const toggleTemple = useStore((s) => s.toggleTemple);
  const chatSeen = useStore((s) => s.chatSeen);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  // Le compteur vient du payload de partie (town.chatCount) : le CONTENU du
  // board ne transite jamais par là — la lecture est gatée par joueur.
  const unread = Math.max(0, (game?.town.chatCount ?? 0) - chatSeen);
  const [heroMenu, setHeroMenu] = useState(false);
  const hpPct = game ? Math.round((game.town.hp / game.town.maxHp) * 100) : 100;
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "alert";
  const inTown = heroesInTown(game, playerId).length > 0;
  const waveRemaining = useWaveRemaining(game);
  const catchingUp = useStore((s) => s.catchingUp);

  // My team's cumulated PA (all heroes in a multi game, every hero in legacy solo).
  const myIds = game?.players?.find((p) => p.id === playerId)?.heroIds;
  const myHeroes = (game?.heroes ?? []).filter((h) => !myIds || myIds.includes(h.id));
  const totalPA = myHeroes.reduce((a, h) => a + h.pa, 0);

  const selHero = game?.heroes.find((h) => h.id === selectedHeroId) ?? myHeroes[0];
  const portrait = assetUrl(portraitKey(selHero?.classId));

  // La prévision de vague, mise en mots par forecast.ts — la MÊME phrase sert la
  // pastille, son aria-label, son title et la feuille « État de la ville ».
  const fc = game?.town.forecast;

  // LA FAVEUR DES DIEUX (mythic.go) : le compteur ⚡ et son seuil viennent du serveur,
  // jamais d'une constante recopiée ici.
  const pantheon = game?.theme?.pantheon;
  const favor = game?.town.favor ?? 0;
  const favorGoal = game?.town.favorGoal ?? 20;
  const templeB = game?.town.buildings?.find((b) => b.id === "temple");
  const templeStanding = !!templeB?.built && templeB.durability > 0;
  const freeSlot = (game?.town.blessings?.length ?? 0) < (game?.town.blessingSlots ?? 0);
  const favorReady = templeStanding && favor >= favorGoal && freeSlot;

  return (
    <header className="topbar">
      <button className="avatar" title={T("topbar.heroes")} onClick={() => setHeroMenu((o) => !o)}>
        {portrait ? <img src={portrait} alt="🙂" /> : "🙂"}
      </button>
      {heroMenu && <HeroActionsMenu onClose={() => setHeroMenu(false)} />}
      {/* NOT className="town": the Home container's `.town { position:absolute;
          inset:0 }` rule stretches it over the avatar and eats its clicks. */}
      {/* Le nom de la VILLE (généré, cf. townnames.go) : c'est lui qui figure au
          classement, donc c'est lui qu'on affiche pour la reconnaître. */}
      <span className="town-name">{game?.town?.name || game?.name || "Echo Terra"}</span>

      {/* PV de la ville et PA d'équipe fusionnés en UN chip. À huit éléments sur
          un écran de 390px la barre débordait et le compteur de PA passait à la
          ligne ; ce sont deux faces du même « état de mon camp », et ils ouvrent
          le même panneau. */}
      <button
        className={`chip status ${hpClass}`}
        onClick={() => toggleTownStatus(true)}
        title={T("topbar.status")}
      >
        <span className="st-hp">🏰 {hpPct}%</span>
        <span className="st-sep" aria-hidden="true" />
        <span className="st-pa">⚡ {totalPA}</span>
      </button>

      {game?.status === "active" && (
        <button
          className={"chip wave" + (fc?.atRisk ? " fatal" : "")}
          onClick={() => toggleTownStatus(true)}
          title={
            fc
              ? `${damageSentence(fc)} ${precisionSentence(fc)} ${besiegingSentence(fc)}`
              : T("topbar.nextWave")
          }
        >
          {/* Le monde est en train de rattraper les vagues de l'absence : le
              minuteur est à 0 par construction et ne veut plus rien dire. On le
              dit, au lieu d'afficher « 00:00 » pendant que la ville se fait
              frapper (voir store.refreshGame / game.CatchUpPending). */}
          {catchingUp ? <>⏳ {T("topbar.catchingUp")}</> : <>🌊 {formatHMS(waveRemaining)}</>}
          {/* Les dégâts ATTENDUS en FOURCHETTE, pas le numéro de vague : c'est le
              chiffre sur lequel le joueur peut agir, et son imprécision est elle-même
              une information (elle se paie en Tour de guet et en observateurs). */}
          {/* ⚠ IL PORTE SON UNITÉ, et son séparateur est « … » : écrit « −0/16 » nu,
              il a été lu comme une fraction (« 0 sur 16 ») par le joueur qui l'a
              rapporté — et le title, seule explication, est invisible au doigt. La
              version longue vit dans la feuille qu'ouvre ce bouton. */}
          {/* Pendant le rattrapage, la prévision porte sur une vague qui n'est pas
              la prochaine que le joueur verra tomber : on la tait (et la barre
              reste courte sur un téléphone). */}
          {!catchingUp && fc && fc.damageMax > 0 && (
            <i className="wave-dmg" aria-label={damageSentence(fc)}>
              {damageRange(fc)} {T("topbar.hp")}
            </i>
          )}
        </button>
      )}

      {/* LA FAVEUR DES DIEUX (backend mythic.go). Affichée seulement quand elle a un
          sens — un Temple debout, ou de la faveur déjà accumulée : sur une barre où le
          ⚙️ sortait déjà de l'écran à 390 px, un compteur à zéro pour une ville sans
          temple ne serait que du bruit. L'icône est celle du PANTHÉON (⚡ grec,
          🔨 nordique, ☥ égyptien), ce qui la distingue au passage des PA, qui portent
          aussi la foudre. */}
      {(favor > 0 || templeStanding) && (
        <button
          className={"chip favor" + (favorReady ? " ready" : "")}
          onClick={() => toggleTemple(true)}
          title={
            templeStanding
              ? T(favorReady ? "topbar.favor.ready" : "topbar.favor.gather", { favor, goal: favorGoal })
              : T("topbar.favor.noTemple", {
                  favor,
                  goal: favorGoal,
                  // ⚠ le nom du temple vient du PANTHÉON servi par le serveur
                  // (« Hof des Ases ») : c'est un nom propre, il ne se traduit
                  // pas. Le générique, lui, oui.
                  temple: pantheon?.temple ?? T("building.temple.name"),
                })
          }
        >
          {pantheon?.favor ?? "⚡"} {favor}
        </button>
      )}
      {inTown && (
        <button className="iconbtn" title={T("topbar.journal")} onClick={() => toggleTownJournal(true)}>
          📋
        </button>
      )}
      {/* La messagerie n'est PAS gatée sur la présence en ville : c'est la
          feuille qui explique le blocage (« construis la Poste »). Un bouton qui
          disparaît n'apprend rien à personne. */}
      <button className="iconbtn chat" title={T("topbar.chat")} onClick={() => toggleChat(true)}>
        ✉️
        {unread > 0 && <span className="pip">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <button className="iconbtn" title={T("topbar.settings")} onClick={() => openSettings("menu")}>
        ⚙️
      </button>
    </header>
  );
}
