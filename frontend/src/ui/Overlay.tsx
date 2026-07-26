import { useEffect, useId, useRef, type ReactNode } from "react";

// Overlay unique — modale centrée OU feuille du bas.
//
// Avant, ce motif était copié-collé dans 7 fichiers :
//   <div className="settings" onClick={close}>
//     <div className="panel-card" onClick={(e) => e.stopPropagation()}>
// avec deux variantes de backdrop en plus (.hm-backdrop, .menu-backdrop). Aucun
// des sept n'avait de fermeture par Échap, de piège à focus, de retour du focus
// ni de verrou de défilement. Tout est ici, une fois.
export type OverlayVariant = "modal" | "sheet";

export function Overlay({
  open = true,
  variant = "modal",
  onClose,
  title,
  labelledBy,
  className = "",
  cardClassName = "",
  closeOnBackdrop = true,
  children,
}: {
  open?: boolean;
  variant?: OverlayVariant;
  onClose?: () => void;
  /** Titre accessible quand le contenu n'en fournit pas déjà un. */
  title?: string;
  /** id d'un titre déjà présent dans `children` (prioritaire sur `title`). */
  labelledBy?: string;
  className?: string;
  cardClassName?: string;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const fallbackId = useId();
  const titleId = labelledBy ?? (title ? fallbackId : undefined);

  // Échap ferme, et le focus ne peut pas sortir de la carte au Tab.
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        cardRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Donne le focus à la carte pour que le premier Tab parte de l'intérieur.
    const first = focusables()[0];
    (first ?? cardRef.current)?.focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === firstEl || !cardRef.current?.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Rend le focus à ce qui a ouvert l'overlay — sinon il repart au <body>
      // et la navigation clavier recommence du début de la page.
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`settings${variant === "sheet" ? " sheet" : ""}${className ? ` ${className}` : ""}`}
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`panel-card${cardClassName ? ` ${cardClassName}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={titleId} className="ov-title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
