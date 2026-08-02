import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { heroesInTown } from "../townUtils";

// La messagerie de la ville.
//
// La règle qui lui donne sa forme est POSITIONNELLE : un héros en ville est
// devant le panneau d'affichage et écrit librement ; en expédition, on est hors
// de portée — sauf si la ville a bâti la POSTE, qui remet toute l'équipe en
// contact. Le serveur est seul juge (game/chat.go) ; on redérive la même
// condition ici uniquement pour afficher un panneau qui EXPLIQUE le blocage au
// lieu d'un champ de saisie mort.
export function TownChat() {
  const open = useStore((s) => s.chatOpen);
  const close = useStore((s) => s.toggleChat);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const chat = useStore((s) => s.chat);
  const locked = useStore((s) => s.chatLocked);
  const busy = useStore((s) => s.busy);
  const sendChat = useStore((s) => s.sendChat);
  const setTab = useStore((s) => s.setTab);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Un fil de discussion se lit par le BAS : on colle au dernier message à
  // chaque arrivée (et à l'ouverture).
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, chat.length]);

  if (!open || !game) return null;

  const posteBuilt = !!game.town.buildings?.find((b) => b.id === "poste" && b.built && b.durability > 0);
  const inTown = heroesInTown(game, playerId).length > 0;
  const canWrite = inTown || posteBuilt || !game.players?.length;

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await sendChat(text);
  };

  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <Overlay variant="sheet" onClose={() => close(false)} title={`✉️ Messages de ${game.town.name}`}>
      <>
        {!canWrite ? (
          <div className="chat-locked">
            <div className="cl-icon">📮</div>
            <p>
              <strong>Aucun de tes héros n'est en ville.</strong> Depuis le terrain, le courrier
              n'arrive que si la ville a bâti la <strong>Poste</strong>.
            </p>
            <p className="cl-hint">
              {posteBuilt
                ? "La Poste est en ruine — répare-la pour rétablir le courrier."
                : "Ramène un héros en ville, ou trouve le « Plan de la Poste » et lance le chantier."}
            </p>
            <button
              className="pill"
              onClick={() => {
                close(false);
                setTab("structure");
              }}
            >
              🏗️ Ouvrir Bâtir
            </button>
          </div>
        ) : (
          <>
            <div className="chat-list" ref={listRef}>
              {chat.length === 0 ? (
                <div className="tj-empty">
                  {locked ?? "Personne n'a encore écrit. Lance la conversation."}
                </div>
              ) : (
                chat.map((m) => (
                  <div className={`chat-msg ${m.playerId === playerId ? "mine" : ""}`} key={m.id}>
                    <div className="cm-head">
                      <span className="cm-who">{m.author}</span>
                      <span className="cm-when">
                        {m.remote && <span title="Envoyé du terrain, via la Poste">📮 </span>}J{m.day} ·{" "}
                        {hhmm(m.at)}
                      </span>
                    </div>
                    <div className="cm-text">{m.text}</div>
                  </div>
                ))
              )}
            </div>

            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                className="chat-input"
                value={draft}
                maxLength={240}
                placeholder={posteBuilt && !inTown ? "Écrire du terrain (Poste)…" : "Écrire un message…"}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Votre message"
              />
              <button className="pill" type="submit" disabled={busy || !draft.trim()}>
                Envoyer
              </button>
            </form>
            <div className="chat-note">
              Les messages sont partagés par toute la ville et passent par un filtre de modération.
            </div>
          </>
        )}

        <button className="pill red ov-close" onClick={() => close(false)}>
          Fermer
        </button>
      </>
    </Overlay>
  );
}
