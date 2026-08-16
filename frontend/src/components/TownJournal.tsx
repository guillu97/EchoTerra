import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { useT } from "../i18n/useT";

// Town journal overlay (opened from the Panel building): every action performed IN
// town — gate toggles, well draws, bank deposits, builds/repairs, town crafts —
// newest first, recorded server-side and shared by all players.
export function TownJournal() {
  const open = useStore((s) => s.townJournalOpen);
  const game = useStore((s) => s.game);
  const close = useStore((s) => s.toggleTownJournal);
  const { t, tServer } = useT();
  if (!open || !game) return null;

  const entries = game.town.log ?? [];
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <Overlay variant="sheet" onClose={() => close(false)} title={"📋 " + t("Journal de la ville")}>
      <>

        {entries.length === 0 ? (
          <div className="tj-empty">
            {t(
              "Rien à signaler pour l'instant — les actions faites en ville (porte, puits, Banque, chantiers…) s'inscrivent ici.",
            )}
          </div>
        ) : (
          <div className="tj-list">
            {entries.map((e, i) => (
              <div className="tj-row" key={`${e.at}-${i}`}>
                <span className="tj-when">
                  {t("J{n}", { n: e.day })} · {hhmm(e.at)}
                </span>
                <span className="tj-text">{tServer(e)}</span>
              </div>
            ))}
          </div>
        )}

        <button className="pill red ov-close" onClick={() => close(false)}>
          {t("Fermer")}
        </button>
      </>
    </Overlay>
  );
}
