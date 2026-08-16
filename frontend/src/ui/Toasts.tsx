import { useStore } from "../store";
import { useT } from "../i18n/useT";

// Pile de toasts, en bas de l'écran, au-dessus de la barre de navigation.
//
// `aria-live="polite"` : les échecs d'action (« Pas assez de PA », « Aucun de tes
// héros en ville ») étaient jusqu'ici soit invisibles, soit cachés dans un
// `title=` que le doigt ne peut pas survoler. Ils sont maintenant lus.
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const { t } = useT();

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {/* ⚠ la variable de boucle NE PEUT PLUS s'appeler `t` : c'est le nom de la
          fonction de traduction, et l'ombrer ici la rendrait inappelable. */}
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`toast-item ${toast.tone}`}
          onClick={() => dismiss(toast.id)}
          title={t("Masquer")}
        >
          <span className="ti-ic" aria-hidden="true">
            {toast.tone === "error" ? "⚠️" : toast.tone === "ok" ? "✅" : toast.tone === "warn" ? "🔔" : "💬"}
          </span>
          <span className="ti-msg">{toast.msg}</span>
        </button>
      ))}
    </div>
  );
}
