import { useStore } from "../store";

// Pile de toasts, en bas de l'écran, au-dessus de la barre de navigation.
//
// `aria-live="polite"` : les échecs d'action (« Pas assez de PA », « Aucun de tes
// héros en ville ») étaient jusqu'ici soit invisibles, soit cachés dans un
// `title=` que le doigt ne peut pas survoler. Ils sont maintenant lus.
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast-item ${t.tone}`}
          onClick={() => dismiss(t.id)}
          title="Masquer"
        >
          <span className="ti-ic" aria-hidden="true">
            {t.tone === "error" ? "⚠️" : t.tone === "ok" ? "✅" : t.tone === "warn" ? "🔔" : "💬"}
          </span>
          <span className="ti-msg">{t.msg}</span>
        </button>
      ))}
    </div>
  );
}
