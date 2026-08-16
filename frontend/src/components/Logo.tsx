import { useT } from "../i18n/useT";

// Wordmark — « Echo » encre, « Terra » rouge brique (design Claude).
// ⚠ « EchoTerra » est un NOM PROPRE : il ne se traduit dans aucune langue. Seule la
// signature en dessous est du texte.
export function Logo() {
  const { t } = useT();
  return (
    <div>
      <div className="logo">
        Echo<span className="terra">Terra</span>
      </div>
      <div className="tagline">{t("CHAQUE ACTE COMPTE")}</div>
    </div>
  );
}
