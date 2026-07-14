import { useStore } from "../store";

// Town journal overlay (opened from the Panel building): every action performed IN
// town — gate toggles, well draws, bank deposits, builds/repairs, town crafts —
// newest first, recorded server-side and shared by all players.
export function TownJournal() {
  const open = useStore((s) => s.townJournalOpen);
  const game = useStore((s) => s.game);
  const close = useStore((s) => s.toggleTownJournal);
  if (!open || !game) return null;

  const entries = game.town.log ?? [];
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="settings" onClick={() => close(false)}>
      <div className="panel-card" onClick={(e) => e.stopPropagation()}>
        <div className="banner">📋 Journal de la ville</div>

        {entries.length === 0 ? (
          <div className="tj-empty">
            Rien à signaler pour l'instant — les actions faites en ville (porte, puits, Banque,
            chantiers…) s'inscrivent ici.
          </div>
        ) : (
          <div className="tj-list">
            {entries.map((e, i) => (
              <div className="tj-row" key={`${e.at}-${i}`}>
                <span className="tj-when">
                  J{e.day} · {hhmm(e.at)}
                </span>
                <span className="tj-text">{e.text}</span>
              </div>
            ))}
          </div>
        )}

        <button className="pill red" style={{ marginTop: 12 }} onClick={() => close(false)}>
          Fermer
        </button>
      </div>
    </div>
  );
}
